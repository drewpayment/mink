/**
 * Pure layout: composes widgets.ts primitives into a `Screen` from an
 * `OverviewModel`. No data fetching, no ANSI, no terminal I/O — a plain
 * `(model, state, cols, rows) => Screen` function so it is snapshot-testable
 * without a real terminal.
 */

import { Screen } from "./screen";
import { drawBox, statTile, sparkline, hbar, stackedBar, drawTable, drawHelpOverlay } from "./widgets";
import { stringWidth, padToWidth } from "./width";
import { fmtNum, fmtDuration, fmtTime, type OverviewModel } from "./overview-model";

export const MIN_COLS = 80;
export const MIN_ROWS = 24;

export interface UiState {
  scrollOffset: number;
  helpOpen: boolean;
  lastRefresh: string; // preformatted time, e.g. "14:32:05"
}

const HELP_KEYS: Array<[string, string]> = [
  ["q, Ctrl-C", "quit"],
  ["?", "toggle this help"],
  ["r", "force refresh"],
  ["j/k, ↓/↑", "scroll session history"],
  ["g/G", "history top/bottom"],
];

/** Centered "terminal too small" message — never renders garbage below the minimum size. */
export function renderTooSmall(cols: number, rows: number): Screen {
  const screen = new Screen(Math.max(cols, 0), Math.max(rows, 0));
  const lines = [
    "Terminal too small",
    `need at least ${MIN_COLS}×${MIN_ROWS}`,
    `(current ${cols}×${rows})`,
  ];
  const startY = Math.max(0, Math.floor((screen.rows - lines.length) / 2));
  lines.forEach((line, i) => {
    const x = Math.max(0, Math.floor((screen.cols - stringWidth(line)) / 2));
    screen.drawText(x, startY + i, line, { fg: "warn", bold: i === 0 });
  });
  return screen;
}

// ── Header ───────────────────────────────────────────────────────────────

function renderHeader(screen: Screen, model: OverviewModel, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: `mink · ${model.project}` });
  const innerX = x + 2;
  const innerW = Math.max(0, w - 4);

  const daemonText = model.daemon.running
    ? `● running${model.daemon.uptimeMs !== null ? " · up " + fmtDuration(model.daemon.uptimeMs) : ""}`
    : "○ stopped";
  screen.drawText(innerX, y + 1, `daemon ${daemonText}`, { fg: model.daemon.running ? "good" : "dim" }, innerW);

  const label = "TOTAL TOKENS SAVED";
  const value = fmtNum(model.savings.total);
  screen.drawText(innerX, y + 2, label, { fg: "dim" });
  const valueX = innerX + stringWidth(label) + 2;
  screen.drawText(valueX, y + 2, value, { fg: "good", bold: true });

  const barX = valueX + stringWidth(value) + 2;
  const legend = ` heuristic ${fmtNum(model.savings.heuristic)} · measured ${fmtNum(model.savings.measured)}`;
  const barW = Math.max(0, Math.min(24, innerW - (barX - innerX) - stringWidth(legend)));
  if (barW > 0) {
    stackedBar(
      screen,
      barX,
      y + 2,
      [
        { value: model.savings.heuristic, styleKey: "accent" },
        { value: model.savings.measured, styleKey: "good" },
      ],
      barW,
    );
    screen.drawText(barX + barW, y + 2, legend, { fg: "dim" }, innerW - (barX + barW - innerX));
  }
}

// ── Lifetime panel ───────────────────────────────────────────────────────

function renderLifetime(screen: Screen, model: OverviewModel, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: "Lifetime" });
  const contentH = h - 2;
  if (contentH < 1) return;
  const innerX = x + 1;
  const innerW = Math.max(0, w - 2);

  if (contentH >= 6) {
    // Full 2x2 grid of 3-line stat tiles (label/value/sub).
    const colW = Math.max(1, Math.floor((w - 3) / 2));
    const col2X = x + 2 + colW;
    statTile(screen, { x: x + 1, y: y + 1, w: colW, label: "TOKENS", value: fmtNum(model.lifetime.totalTokens), sub: "read + write" });
    statTile(screen, { x: col2X, y: y + 1, w: colW, label: "SESSIONS", value: fmtNum(model.lifetime.totalSessions), sub: "total" });
    statTile(screen, { x: x + 1, y: y + 4, w: colW, label: "READ SAVINGS", value: fmtNum(model.lifetime.heuristicSavings), sub: "heuristic" });
    statTile(screen, { x: col2X, y: y + 4, w: colW, label: "COMPRESSION", value: `${model.lifetime.compRatioPct.toFixed(0)}%`, sub: "measured ratio" });
    return;
  }

  // Compact fallback for short panels: one "LABEL  value" line per tile
  // instead of the 3-line statTile stack, so small terminals still see all
  // four figures rather than losing the bottom row.
  const tiles: Array<[string, string]> = [
    ["TOKENS", fmtNum(model.lifetime.totalTokens)],
    ["SESSIONS", fmtNum(model.lifetime.totalSessions)],
    ["READ SAVINGS", fmtNum(model.lifetime.heuristicSavings)],
    ["COMPRESSION", `${model.lifetime.compRatioPct.toFixed(0)}%`],
  ];
  tiles.slice(0, contentH).forEach(([label, value], i) => {
    screen.drawText(innerX, y + 1 + i, `${padToWidth(label, 13)} `, { fg: "dim" }, innerW);
    screen.drawText(innerX + 14, y + 1 + i, value, { fg: "text", bold: true }, innerW - 14);
  });
}

// ── Last-7-days panel ────────────────────────────────────────────────────

const SPARK_SERIES: Array<{ key: "saved" | "tokensIn" | "writes"; label: string; style: "good" | "accent" | "warn" }> = [
  { key: "saved", label: "saved", style: "good" },
  { key: "tokensIn", label: "in", style: "accent" },
  { key: "writes", label: "out", style: "warn" },
];

function renderLast7Days(screen: Screen, model: OverviewModel, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: "Token usage — last 7 days" });
  const innerX = x + 2;
  const innerW = Math.max(0, w - 4);
  const labelW = 6;
  const valueW = 8;
  const sparkW = Math.max(0, innerW - labelW - valueW - 2);

  SPARK_SERIES.forEach((series, i) => {
    const rowY = y + 1 + i;
    if (rowY >= y + h - 1) return;
    const values = model.last7Days.map((d) => d[series.key]);
    screen.drawText(innerX, rowY, padToWidth(series.label, labelW), { fg: "dim" });
    screen.drawText(innerX + labelW, rowY, sparkline(values, sparkW), { fg: series.style });
    const last = values[values.length - 1] ?? 0;
    screen.drawText(innerX + labelW + sparkW + 1, rowY, fmtNum(last), { fg: "text" }, valueW);
  });

  const axisY = y + 1 + SPARK_SERIES.length;
  if (axisY < y + h - 1 && model.last7Days.length > 0) {
    const axis = `${model.last7Days[0]!.day} → ${model.last7Days[model.last7Days.length - 1]!.day}`;
    screen.drawText(innerX, axisY, axis, { fg: "dim" }, innerW);
  }
}

// ── Session panel ────────────────────────────────────────────────────────

function renderSession(screen: Screen, model: OverviewModel, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: "Session (most recent)" });
  const innerX = x + 2;
  const innerW = Math.max(0, w - 4);
  const s = model.currentSession;

  if (!s) {
    // Kept short deliberately: this panel sits in the narrower left column
    // (~26 usable columns at the 80-col minimum), and drawText clips
    // silently rather than wrapping.
    screen.drawText(innerX, y + 1, "No sessions yet.", { fg: "dim" }, innerW);
    screen.drawText(innerX, y + 2, "Start working to see it.", { fg: "dim" }, innerW);
    return;
  }

  const status = s.isActive ? "● active" : `○ ended ${fmtTime(s.endedAt ?? "")}`;
  screen.drawText(innerX, y + 1, `${s.id}  ${status}`, { fg: s.isActive ? "good" : "dim" }, innerW);

  const barW = Math.max(1, innerW - labelColW - numColW);
  const scale = Math.max(1, s.reads, s.writes);
  drawKpiBar(screen, innerX, y + 2, "reads", s.reads, scale, barW);
  drawKpiBar(screen, innerX, y + 3, "writes", s.writes, scale, barW);

  const indexTotal = s.indexHits + s.indexMisses;
  const hitRatePct = indexTotal > 0 ? Math.round((s.indexHits / indexTotal) * 100) : 0;
  if (y + 4 < y + h - 1) {
    screen.drawText(innerX, y + 4, padToWidth("idx hit", labelColW), { fg: "dim" });
    screen.drawText(innerX + labelColW, y + 4, hbar(s.indexHits, Math.max(1, indexTotal), barW), { fg: "accent" });
    screen.drawText(innerX + labelColW + barW + 1, y + 4, `${hitRatePct}%`, { fg: "text" }, numColW);
  }
}

const labelColW = 8;
const numColW = 6;

function drawKpiBar(screen: Screen, x: number, y: number, label: string, value: number, max: number, barW: number): void {
  screen.drawText(x, y, padToWidth(label, labelColW), { fg: "dim" });
  screen.drawText(x + labelColW, y, hbar(value, max, barW), { fg: "accent" });
  screen.drawText(x + labelColW + barW + 1, y, String(value), { fg: "text" }, numColW);
}

// ── Compression panel ────────────────────────────────────────────────────

function renderCompression(screen: Screen, model: OverviewModel, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: "Compression — measured" });
  const innerX = x + 2;
  const innerW = Math.max(0, w - 4);
  const c = model.compression;

  if (!c.hasData) {
    screen.drawText(innerX, y + 1, "No measured compression data yet.", { fg: "dim" }, innerW);
    screen.drawText(innerX, y + 2, c.enabled ? "Waiting for tool output to compress." : "Compression is disabled for this project.", { fg: "dim" }, innerW);
    return;
  }

  screen.drawText(innerX, y + 1, `ratio ${c.ratioPct.toFixed(0)}%   events ${c.events}   holdout ${c.holdoutEvents}`, { fg: "text" }, innerW);

  const barW = Math.max(1, innerW - labelColW - numColW - 2);
  screen.drawText(innerX, y + 2, padToWidth("before", labelColW), { fg: "dim" });
  screen.drawText(innerX + labelColW, y + 2, fmtNum(c.originalTokens), { fg: "text" }, barW);

  if (y + 3 < y + h - 1) {
    screen.drawText(innerX, y + 3, padToWidth("after", labelColW), { fg: "dim" });
    screen.drawText(innerX + labelColW, y + 3, hbar(c.compressedTokens, Math.max(1, c.originalTokens), barW), { fg: "good" });
    screen.drawText(innerX + labelColW + barW + 1, y + 3, fmtNum(c.compressedTokens), { fg: "text" }, numColW);
  }
}

// ── History table ────────────────────────────────────────────────────────

function renderHistory(screen: Screen, model: OverviewModel, state: UiState, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: "Session history — newest first", focused: true });
  if (h < 3) return;

  if (model.history.length === 0) {
    screen.drawText(x + 2, y + 1, "No sessions yet — history will appear here.", { fg: "dim" }, w - 4);
    return;
  }

  const innerX = x + 1;
  const innerW = Math.max(0, w - 2);
  const fixedW = 8 + 8 + 6 + 6 + 8 + 8; // start, dur, reads, writes, tokens, saved
  const gaps = 6;
  const idW = Math.max(8, innerW - fixedW - gaps);

  drawTable(screen, {
    x: innerX,
    y: y + 1,
    w: innerW,
    h: h - 2,
    columns: [
      { label: "ID", width: idW },
      { label: "START", width: 8 },
      { label: "DUR", width: 8 },
      { label: "READS", width: 6, align: "right" },
      { label: "WRITES", width: 6, align: "right" },
      { label: "TOKENS", width: 8, align: "right" },
      { label: "SAVED", width: 8, align: "right" },
    ],
    rows: model.history.map((s) => [
      s.id,
      fmtTime(s.start),
      fmtDuration(s.durationMs),
      String(s.reads),
      String(s.writes),
      fmtNum(s.tokens),
      fmtNum(s.saved),
    ]),
    scrollOffset: state.scrollOffset,
  });
}

// ── Footer ───────────────────────────────────────────────────────────────

function renderFooter(screen: Screen, state: UiState, x: number, y: number, w: number): void {
  const hints = "q quit · ? help · r refresh · j/k scroll · g/G top/bottom";
  const updated = `updated ${state.lastRefresh}`;
  screen.drawText(x, y, hints, { fg: "dim" }, w);
  const updatedX = x + w - stringWidth(updated);
  if (updatedX > x + stringWidth(hints) + 1) {
    screen.drawText(updatedX, y, updated, { fg: "dim" }, w);
  }
}

// ── Top-level layout ─────────────────────────────────────────────────────

/** Composes the full Overview layout for a `cols`×`rows` terminal. Pure — safe to snapshot-test. */
export function renderOverview(model: OverviewModel, state: UiState, cols: number, rows: number): Screen {
  if (cols < MIN_COLS || rows < MIN_ROWS) return renderTooSmall(cols, rows);

  const screen = new Screen(cols, rows);

  const headerH = 4;
  const footerH = 1;
  const remaining = rows - headerH - footerH;
  const statsRowH = Math.max(6, Math.min(10, Math.floor(remaining * 0.4)));
  const historyH = Math.max(3, remaining - statsRowH * 2);

  const leftW = Math.max(24, Math.min(cols - 24, Math.floor(cols * 0.38)));
  const rightW = cols - leftW;

  let y = 0;
  renderHeader(screen, model, 0, y, cols, headerH);
  y += headerH;

  renderLifetime(screen, model, 0, y, leftW, statsRowH);
  renderLast7Days(screen, model, leftW, y, rightW, statsRowH);
  y += statsRowH;

  renderSession(screen, model, 0, y, leftW, statsRowH);
  renderCompression(screen, model, leftW, y, rightW, statsRowH);
  y += statsRowH;

  renderHistory(screen, model, state, 0, y, cols, historyH);
  y += historyH;

  renderFooter(screen, state, 0, y, cols);

  if (state.helpOpen) drawHelpOverlay(screen, HELP_KEYS);

  return screen;
}
