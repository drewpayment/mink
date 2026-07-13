/**
 * Sessions drill-down screen: a master-detail view over the token ledger's
 * session history. Unlike Overview's history table (capped at 30, no
 * selection), this screen lists every session and lets the user step
 * through them with j/k/g/G to inspect one in full via the detail panel
 * below the table.
 *
 * Layout is stacked (table on top, detail below) rather than side-by-side —
 * at the 80-column minimum there isn't enough width for two columns and
 * readable session-id text in the detail panel, so vertical stacking wins.
 */

import { Screen } from "./screen";
import { drawBox, drawTable, hbar } from "./widgets";
import { padToWidth } from "./width";
import { fmtNum, fmtDuration, fmtTime } from "./overview-model";
import { loadTokenLedgerPanel } from "../core/dashboard-api";
import type { TuiScreen, ScreenUiState } from "./screen-registry";
import type { Key } from "./term";
import type { TokenLedgerPayload } from "../types/dashboard";
import type { WasteFlag } from "../types/waste-detection";

const HELP_KEYS: Array<[string, string]> = [
  ["j/k, ↓/↑", "select session"],
  ["g/G", "first/last session"],
];

// ── Model ────────────────────────────────────────────────────────────────

export interface SessionRow {
  id: string;
  start: string; // ISO
  end: string | null; // ISO, null when the session is still active
  isActive: boolean;
  durationMs: number;
  reads: number;
  writes: number;
  tokens: number;
  saved: number;
  indexHits: number;
  indexMisses: number;
}

export interface SessionsModel {
  // Newest first, ALL sessions (no 30-entry cap — unlike Overview's history
  // table, this screen exists specifically to drill into the full record).
  sessions: SessionRow[];
  // WasteFlag carries no sessionId (see src/types/waste-detection.ts) — flags
  // are a project-wide signal, not attributable to one session, so the detail
  // panel shows them as a standalone "(project)" list rather than filtering.
  wasteFlags: WasteFlag[];
}

/** Pure derivation from the ledger payload — no I/O, so it's fixture-testable. */
export function deriveSessionsModel(ledger: TokenLedgerPayload, now: number = Date.now()): SessionsModel {
  const sessions = ledger.sessions ?? [];
  const rows: SessionRow[] = [...sessions].reverse().map((s) => {
    const startMs = s.startTimestamp ? new Date(s.startTimestamp).getTime() : NaN;
    const endMs = s.endTimestamp ? new Date(s.endTimestamp).getTime() : now;
    const durationMs = Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : 0;
    return {
      id: s.sessionId,
      start: s.startTimestamp,
      end: s.endTimestamp || null,
      isActive: !s.endTimestamp,
      durationMs,
      reads: s.totals?.readCount ?? 0,
      writes: s.totals?.writeCount ?? 0,
      tokens: s.totals?.estimatedTokens ?? 0,
      saved: s.estimatedSavings ?? 0,
      indexHits: s.totals?.fileIndexHits ?? 0,
      indexMisses: s.totals?.fileIndexMisses ?? 0,
    };
  });
  return { sessions: rows, wasteFlags: ledger.wasteFlags ?? [] };
}

function buildSessionsModel(cwd: string): SessionsModel {
  return deriveSessionsModel(loadTokenLedgerPanel(cwd));
}

// ── Small shared layout constants ───────────────────────────────────────

const LABEL_W = 8;
const NUM_W = 6;

function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(i, len - 1));
}

/** Keeps `selected` inside the visible `[offset, offset+bodyHeight)` window, scrolling the minimum amount needed. */
function followScroll(selected: number, offset: number, bodyHeight: number, total: number): number {
  if (bodyHeight <= 0 || total <= 0) return 0;
  let next = offset;
  if (selected < next) next = selected;
  else if (selected >= next + bodyHeight) next = selected - bodyHeight + 1;
  return Math.max(0, Math.min(next, Math.max(0, total - bodyHeight)));
}

// ── Table (master) ──────────────────────────────────────────────────────

function renderSessionTable(
  screen: Screen,
  model: SessionsModel,
  state: ScreenUiState,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  drawBox(screen, { x, y, w, h, title: "Sessions — newest first", focused: true });
  if (h < 3) return;

  const innerX = x + 1;
  const innerW = Math.max(0, w - 2);
  const selected = clampIndex(state.selectedIndex, model.sessions.length);

  // drawTable's own body height (h passed to it, minus its header row).
  const bodyH = h - 3;
  state.scrollOffset = followScroll(selected, state.scrollOffset, Math.max(0, bodyH), model.sessions.length);

  drawTable(screen, {
    x: innerX,
    y: y + 1,
    w: innerW,
    h: h - 2,
    columns: [
      { label: "START", width: 8 },
      { label: "DUR", width: 8 },
      { label: "READS", width: 6, align: "right" },
      { label: "WRITES", width: 6, align: "right" },
      { label: "TOKENS", width: 8, align: "right" },
      { label: "SAVED", width: 8, align: "right" },
    ],
    rows: model.sessions.map((s) => [
      fmtTime(s.start),
      fmtDuration(s.durationMs),
      String(s.reads),
      String(s.writes),
      fmtNum(s.tokens),
      fmtNum(s.saved),
    ]),
    scrollOffset: state.scrollOffset,
    selectedIndex: selected,
  });
}

// ── Detail panel ─────────────────────────────────────────────────────────

function drawKpi(screen: Screen, x: number, y: number, label: string, value: number, max: number, barW: number): void {
  screen.drawText(x, y, padToWidth(label, LABEL_W), { fg: "dim" });
  screen.drawText(x + LABEL_W, y, hbar(value, max, barW), { fg: "accent" });
  screen.drawText(x + LABEL_W + barW + 1, y, String(value), { fg: "text" }, NUM_W);
}

function renderWasteFlags(screen: Screen, flags: WasteFlag[], x: number, y: number, w: number, maxRows: number): void {
  if (maxRows <= 0) return;
  screen.drawText(x, y, "Waste flags (project)", { fg: "dim", bold: true }, w);
  if (maxRows === 1) return;
  if (flags.length === 0) {
    screen.drawText(x, y + 1, "none detected", { fg: "dim" }, w);
    return;
  }
  const visible = flags.slice(0, maxRows - 1);
  visible.forEach((f, i) => {
    const line = `• ${f.pattern}: ${f.description} (~${fmtNum(f.estimatedTokensWasted)} tok)`;
    screen.drawText(x, y + 1 + i, line, { fg: "warn" }, w);
  });
}

function renderSessionDetail(
  screen: Screen,
  model: SessionsModel,
  state: ScreenUiState,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  drawBox(screen, { x, y, w, h, title: "Session detail" });
  if (h < 3) return;

  const idx = clampIndex(state.selectedIndex, model.sessions.length);
  const s = model.sessions[idx];
  const innerX = x + 2;
  const innerW = Math.max(0, w - 4);
  const bottom = y + h - 1;
  let row = y + 1;

  if (!s) {
    screen.drawText(innerX, row, "No session selected.", { fg: "dim" }, innerW);
    return;
  }

  const status = s.isActive ? "● active" : `○ ended ${fmtTime(s.end ?? "")}`;
  screen.drawText(innerX, row, `${s.id}  ${status}`, { fg: s.isActive ? "good" : "dim" }, innerW);
  row++;
  if (row >= bottom) return;

  screen.drawText(innerX, row, `start ${fmtTime(s.start)}   dur ${fmtDuration(s.durationMs)}`, { fg: "text" }, innerW);
  row++;
  if (row >= bottom) return;

  const barW = Math.max(1, innerW - LABEL_W - NUM_W);
  const rwScale = Math.max(1, s.reads, s.writes);
  drawKpi(screen, innerX, row, "reads", s.reads, rwScale, barW);
  row++;
  if (row >= bottom) return;

  drawKpi(screen, innerX, row, "writes", s.writes, rwScale, barW);
  row++;
  if (row >= bottom) return;

  screen.drawText(innerX, row, `tokens ${fmtNum(s.tokens)}   saved ${fmtNum(s.saved)}`, { fg: "text" }, innerW);
  row++;
  if (row >= bottom) return;

  const idxTotal = s.indexHits + s.indexMisses;
  const hitPct = idxTotal > 0 ? Math.round((s.indexHits / idxTotal) * 100) : 0;
  screen.drawText(innerX, row, padToWidth("idx hit", LABEL_W), { fg: "dim" });
  screen.drawText(innerX + LABEL_W, row, hbar(s.indexHits, Math.max(1, idxTotal), barW), { fg: "accent" });
  screen.drawText(innerX + LABEL_W + barW + 1, row, `${hitPct}%`, { fg: "text" }, NUM_W);
  row++;
  if (row >= bottom) return;

  renderWasteFlags(screen, model.wasteFlags, innerX, row, innerW, bottom - row);
}

// ── Top-level layout ─────────────────────────────────────────────────────

/**
 * Composes the Sessions master-detail view into the `cols`x`rows` canvas the
 * shell hands this screen. Pure — safe to snapshot-test.
 */
export function renderSessions(model: SessionsModel, state: ScreenUiState, cols: number, rows: number): Screen {
  const screen = new Screen(cols, rows);

  if (model.sessions.length === 0) {
    drawBox(screen, { x: 0, y: 0, w: cols, h: rows, title: "Sessions", focused: true });
    if (rows > 2) screen.drawText(2, 1, "No sessions yet.", { fg: "dim" }, cols - 4);
    if (rows > 3) screen.drawText(2, 2, "Sessions will appear here once you start working.", { fg: "dim" }, cols - 4);
    return screen;
  }

  const tableH = Math.max(3, Math.min(rows - 3, Math.floor(rows * 0.55)));
  const detailH = Math.max(0, rows - tableH);

  renderSessionTable(screen, model, state, 0, 0, cols, tableH);
  renderSessionDetail(screen, model, state, 0, tableH, cols, detailH);

  return screen;
}

// ── Key handling ─────────────────────────────────────────────────────────

/** Moves the selected-session cursor; render() auto-scrolls the table window to keep it visible. */
function onKey(key: Key, state: ScreenUiState, model: SessionsModel | null): boolean {
  const total = model?.sessions.length ?? 0;
  const maxIndex = Math.max(0, total - 1);
  if (key.name === "j" || key.name === "down") {
    state.selectedIndex = Math.min(state.selectedIndex + 1, maxIndex);
    return true;
  }
  if (key.name === "k" || key.name === "up") {
    state.selectedIndex = Math.max(0, state.selectedIndex - 1);
    return true;
  }
  if (key.name === "g") {
    state.selectedIndex = 0;
    return true;
  }
  if (key.name === "G") {
    state.selectedIndex = maxIndex;
    return true;
  }
  return false;
}

// ── Registry entry ───────────────────────────────────────────────────────

export const sessionsScreen: TuiScreen<SessionsModel> = {
  id: "sessions",
  title: "Sessions",
  hotkey: "2",
  buildModel: buildSessionsModel,
  render: renderSessions,
  onKey,
  helpKeys: HELP_KEYS,
};
