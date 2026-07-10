/**
 * The Compression screen: measured tool-output compression (spec 22) —
 * lifetime savings, the compressed/holdout A/B split, per-content-kind
 * breakdown, and a scrolling recent-events feed. Pure `(model, state, cols,
 * rows) => Screen` composition, same shape as overview-screen.ts, so it is
 * snapshot-testable without a terminal.
 */

import { Screen } from "./screen";
import { drawBox, statTile, stackedBar, drawTable } from "./widgets";
import { fmtNum, fmtTime } from "./overview-model";
import { loadCompressionPanel } from "../core/dashboard-api";
import type { CompressionPayload } from "../types/dashboard";
import type { TuiScreen, ScreenUiState } from "./screen-registry";
import type { Key } from "./term";

const HELP_KEYS: Array<[string, string]> = [
  ["j/k, ↓/↑", "scroll recent events"],
  ["g/G", "events top/bottom"],
];

// ── Model ────────────────────────────────────────────────────────────────

export interface CompressionModel {
  enabled: boolean;
  hasData: boolean;
  lifetime: {
    events: number;
    holdoutEvents: number;
    originalTokens: number;
    compressedTokens: number;
    measuredSavings: number;
    ratioPct: number;
  };
  byKind: Array<{
    key: string;
    events: number;
    originalTokens: number;
    compressedTokens: number;
    savings: number;
    ratioPct: number;
  }>;
  recent: Array<{
    id: string;
    time: string;
    toolName: string;
    contentKind: string;
    originalTokens: number;
    compressedTokens: number;
    savings: number;
    holdout: boolean;
  }>;
}

// Mirrors overview-model.ts's local `pct` helper: ratio as a 0-100 number,
// 0 (not NaN) when the denominator is non-positive.
function pct(n: number, d: number): number {
  return d > 0 ? (n / d) * 100 : 0;
}

/**
 * Pure derivation from the raw dashboard-api payload. Headline figures come
 * from the compressed arm only — the holdout arm passes output through
 * unmodified, so folding it in would dilute the ratio (ported from
 * dashboard/components/panels/compression-panel.tsx).
 */
export function deriveCompressionModel(payload: CompressionPayload): CompressionModel {
  const origC = payload.arms?.compressed.originalTokens ?? 0;
  const compC = payload.arms?.compressed.compressedTokens ?? 0;
  const compEvents = payload.arms?.compressed.events ?? 0;
  const holdoutEvents = payload.lifetime?.totalHoldoutEvents ?? 0;
  const measuredSavings = payload.lifetime?.totalMeasuredSavings ?? Math.max(0, origC - compC);
  const ratioPct = pct(measuredSavings, origC);
  const totalEvents = payload.lifetime?.totalEvents ?? 0;

  const byKind = (payload.byKind ?? []).map((row) => ({
    key: row.key,
    events: row.events,
    originalTokens: row.originalTokens,
    compressedTokens: row.compressedTokens,
    savings: row.savings,
    ratioPct: pct(row.savings, row.originalTokens),
  }));

  const recent = (payload.recent ?? []).map((e) => ({
    id: e.id,
    time: fmtTime(e.createdAt),
    toolName: e.toolName,
    contentKind: e.contentKind,
    originalTokens: e.originalTokens,
    compressedTokens: e.compressedTokens,
    savings: Math.max(0, e.originalTokens - e.compressedTokens),
    holdout: e.holdout,
  }));

  return {
    enabled: payload.enabled ?? false,
    hasData: totalEvents > 0,
    lifetime: {
      events: compEvents,
      holdoutEvents,
      originalTokens: origC,
      compressedTokens: compC,
      measuredSavings,
      ratioPct,
    },
    byKind,
    recent,
  };
}

export function buildCompressionModel(cwd: string): CompressionModel {
  return deriveCompressionModel(loadCompressionPanel(cwd));
}

// ── Header / KPI row ─────────────────────────────────────────────────────

function renderHeader(screen: Screen, model: CompressionModel, x: number, y: number, w: number, h: number): void {
  const status = model.enabled ? "● enabled" : "○ disabled";
  drawBox(screen, { x, y, w, h, title: `Compression — ${status}` });
  if (h < 3) return;

  const innerW = Math.max(0, w - 2);
  const colW = Math.max(1, Math.floor((w - 5) / 4));
  const col2X = x + 2 + colW;
  const col3X = col2X + colW + 1;
  const col4X = col3X + colW + 1;

  if (h - 2 >= 3) {
    statTile(screen, { x: x + 1, y: y + 1, w: colW, label: "MEASURED SAVINGS", value: fmtNum(model.lifetime.measuredSavings), sub: "tokens" });
    statTile(screen, { x: col2X, y: y + 1, w: colW, label: "RATIO", value: `${model.lifetime.ratioPct.toFixed(0)}%`, sub: "compressed arm" });
    statTile(screen, { x: col3X, y: y + 1, w: colW, label: "EVENTS", value: fmtNum(model.lifetime.events), sub: "compressed" });
    statTile(screen, { x: col4X, y: y + 1, w: colW, label: "HOLDOUT", value: fmtNum(model.lifetime.holdoutEvents), sub: "control" });
  }

  const barY = y + 4;
  if (barY < y + h - 1) {
    const innerX = x + 1;
    const label = "before → after ";
    screen.drawText(innerX, barY, label, { fg: "dim" });
    const barX = innerX + label.length;
    const legend = ` ${fmtNum(model.lifetime.originalTokens)} → ${fmtNum(model.lifetime.compressedTokens)}`;
    const barW = Math.max(0, innerW - label.length - legend.length);
    if (barW > 0) {
      stackedBar(
        screen,
        barX,
        barY,
        [
          { value: model.lifetime.compressedTokens, styleKey: "good" },
          { value: Math.max(0, model.lifetime.originalTokens - model.lifetime.compressedTokens), styleKey: "accent" },
        ],
        barW,
      );
      screen.drawText(barX + barW, barY, legend, { fg: "dim" }, innerW - (barX + barW - innerX));
    }
  }
}

// ── Empty / disabled state ───────────────────────────────────────────────

function renderEmptyState(screen: Screen, model: CompressionModel, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: `Compression — ${model.enabled ? "enabled" : "disabled"}` });
  const innerX = x + 2;
  const innerW = Math.max(0, w - 4);
  let row = y + 1;
  if (row >= y + h - 1) return;

  if (!model.enabled) {
    screen.drawText(innerX, row, "Compression is disabled for this project.", { fg: "dim" }, innerW);
    row += 1;
    if (row < y + h - 1) {
      screen.drawText(innerX, row, "Enable it with:", { fg: "dim" }, innerW);
      row += 1;
    }
    if (row < y + h - 1) {
      screen.drawText(innerX, row, "mink config set compression.enabled true", { fg: "accent" }, innerW);
    }
    return;
  }

  screen.drawText(innerX, row, "No compression events yet.", { fg: "dim" }, innerW);
  row += 1;
  if (row < y + h - 1) {
    screen.drawText(innerX, row, "Large tool outputs (Read / Bash / Grep / MCP) will appear here once compressed.", { fg: "dim" }, innerW);
  }
}

// ── Per-kind breakdown table ─────────────────────────────────────────────

function renderBreakdown(screen: Screen, model: CompressionModel, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: "By content kind" });
  if (h < 3) return;

  if (model.byKind.length === 0) {
    screen.drawText(x + 2, y + 1, "No breakdown data yet.", { fg: "dim" }, w - 4);
    return;
  }

  const innerX = x + 1;
  const innerW = Math.max(0, w - 2);
  const fixedW = 8 + 8 + 8 + 8 + 8; // events, original, compressed, saved, ratio
  const gaps = 5;
  const keyW = Math.max(8, innerW - fixedW - gaps);

  drawTable(screen, {
    x: innerX,
    y: y + 1,
    w: innerW,
    h: h - 2,
    columns: [
      { label: "KIND", width: keyW },
      { label: "EVENTS", width: 8, align: "right" },
      { label: "ORIGINAL", width: 8, align: "right" },
      { label: "COMPRESSED", width: 8, align: "right" },
      { label: "SAVED", width: 8, align: "right" },
      { label: "RATIO", width: 8, align: "right" },
    ],
    rows: model.byKind.map((r) => [
      r.key,
      String(r.events),
      fmtNum(r.originalTokens),
      fmtNum(r.compressedTokens),
      fmtNum(r.savings),
      `${r.ratioPct.toFixed(0)}%`,
    ]),
    scrollOffset: 0,
  });
}

// ── Recent events feed ───────────────────────────────────────────────────

function renderEvents(screen: Screen, model: CompressionModel, state: ScreenUiState, x: number, y: number, w: number, h: number): void {
  drawBox(screen, { x, y, w, h, title: "Recent events — newest first", focused: true });
  if (h < 3) return;

  if (model.recent.length === 0) {
    screen.drawText(x + 2, y + 1, "No events yet.", { fg: "dim" }, w - 4);
    return;
  }

  const innerX = x + 1;
  const innerW = Math.max(0, w - 2);
  const fixedW = 8 + 12 + 8 + 8 + 8 + 8; // time, tool, kind, original, compressed, saved
  const gaps = 6;
  const toolW = Math.max(8, innerW - fixedW - gaps);

  drawTable(screen, {
    x: innerX,
    y: y + 1,
    w: innerW,
    h: h - 2,
    columns: [
      { label: "TIME", width: 8 },
      { label: "TOOL", width: toolW },
      { label: "KIND", width: 8 },
      { label: "ORIGINAL", width: 8, align: "right" },
      { label: "COMPRESSED", width: 8, align: "right" },
      { label: "SAVED", width: 8, align: "right" },
    ],
    rows: model.recent.map((e) => [
      e.time,
      e.holdout ? `${e.toolName} (control)` : e.toolName,
      e.contentKind,
      fmtNum(e.originalTokens),
      fmtNum(e.compressedTokens),
      fmtNum(e.savings),
    ]),
    scrollOffset: state.scrollOffset,
  });
}

// ── Top-level layout ─────────────────────────────────────────────────────

/**
 * Composes the Compression panels (header/breakdown/events) into the
 * `cols`×`rows` canvas the shell hands this screen — no tab bar, footer, or
 * picker/help chrome; those are the shell's job (see shell.ts).
 */
export function renderCompression(model: CompressionModel, state: ScreenUiState, cols: number, rows: number): Screen {
  const screen = new Screen(cols, rows);

  if (!model.enabled || !model.hasData) {
    const headerH = Math.max(6, Math.min(9, Math.floor(rows * 0.35)));
    renderHeader(screen, model, 0, 0, cols, headerH);
    renderEmptyState(screen, model, 0, headerH, cols, rows - headerH);
    return screen;
  }

  const headerH = Math.max(6, Math.min(9, Math.floor(rows * 0.3)));
  const remaining = rows - headerH;
  const breakdownH = Math.max(3, Math.min(10, Math.floor(remaining * 0.4)));
  const eventsH = Math.max(3, remaining - breakdownH);

  let y = 0;
  renderHeader(screen, model, 0, y, cols, headerH);
  y += headerH;

  renderBreakdown(screen, model, 0, y, cols, breakdownH);
  y += breakdownH;

  renderEvents(screen, model, state, 0, y, cols, eventsH);

  return screen;
}

// ── Key handling ─────────────────────────────────────────────────────────

/** Scrolling the recent-events feed — the only interactive element this screen owns. */
function onKey(key: Key, state: ScreenUiState, model: CompressionModel | null): boolean {
  const maxOffset = Math.max(0, (model?.recent.length ?? 0) - 1);
  if (key.name === "j" || key.name === "down") {
    state.scrollOffset = Math.min(state.scrollOffset + 1, maxOffset);
    return true;
  }
  if (key.name === "k" || key.name === "up") {
    state.scrollOffset = Math.max(0, state.scrollOffset - 1);
    return true;
  }
  if (key.name === "g") {
    state.scrollOffset = 0;
    return true;
  }
  if (key.name === "G") {
    state.scrollOffset = maxOffset;
    return true;
  }
  return false;
}

// ── Registry entry ───────────────────────────────────────────────────────

export const compressionScreen: TuiScreen<CompressionModel> = {
  id: "compression",
  title: "Compression",
  hotkey: "3",
  buildModel: buildCompressionModel,
  render: renderCompression,
  onKey,
  helpKeys: HELP_KEYS,
};
