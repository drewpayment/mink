/**
 * Pure rendering functions: each one draws into a `Screen` (or, for the
 * character-level primitives, returns a plain string) given a data payload
 * and a rectangle. No layout decisions live here — `overview-screen.ts`
 * decides where things go.
 */

import { Screen } from "./screen";
import { stringWidth, truncateToWidth, padToWidth } from "./width";
import type { PaletteKey, Style } from "./style";

// ── Box ──────────────────────────────────────────────────────────────────

export interface BoxOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  focused?: boolean;
}

/** Draws a titled Unicode box border. The interior is left untouched. */
export function drawBox(screen: Screen, opts: BoxOptions): void {
  const { x, y, w, h, title, focused } = opts;
  if (w < 2 || h < 2) return;

  const borderStyle: Style = { fg: focused ? "accent" : "border" };
  const titleStyle: Style = { fg: "title", bold: !!focused };

  screen.set(x, y, "┌", borderStyle);
  screen.set(x + w - 1, y, "┐", borderStyle);
  screen.set(x, y + h - 1, "└", borderStyle);
  screen.set(x + w - 1, y + h - 1, "┘", borderStyle);
  for (let i = 1; i < w - 1; i++) {
    screen.set(x + i, y, "─", borderStyle);
    screen.set(x + i, y + h - 1, "─", borderStyle);
  }
  for (let j = 1; j < h - 1; j++) {
    screen.set(x, y + j, "│", borderStyle);
    screen.set(x + w - 1, y + j, "│", borderStyle);
  }

  if (title && w > 4) {
    const label = ` ${truncateToWidth(title, w - 4)} `;
    screen.drawText(x + 2, y, label, titleStyle, w - 4);
  }
}

// ── Stat tile ────────────────────────────────────────────────────────────

export interface StatTileOptions {
  x: number;
  y: number;
  w: number;
  label: string;
  value: string;
  sub?: string;
}

/** Draws a compact label/value/sub-value stack, e.g. "TOTAL TOKENS SAVED / 1.23M / heuristic+measured". */
export function statTile(screen: Screen, opts: StatTileOptions): void {
  const { x, y, w, label, value, sub } = opts;
  screen.drawText(x, y, label, { fg: "dim" }, w);
  screen.drawText(x, y + 1, value, { fg: "text", bold: true }, w);
  if (sub) screen.drawText(x, y + 2, sub, { fg: "dim" }, w);
}

// ── Sparkline ────────────────────────────────────────────────────────────

const SPARK_CHARS = "▁▂▃▄▅▆▇█";

/**
 * Renders `values` as a sparkline exactly `width` characters wide,
 * resampling by bucket-averaging when there are more (or fewer) samples
 * than columns. An empty series renders as blank space; an all-zero series
 * renders as a flat baseline (there's data, it's just zero).
 */
export function sparkline(values: number[], width: number): string {
  if (width <= 0) return "";
  if (values.length === 0) return " ".repeat(width);

  // Non-finite samples (corrupt rows) are treated as 0 — one NaN must not
  // poison the min/max pass and blank the whole line.
  const safe = values.map((v) => (Number.isFinite(v) ? v : 0));

  const buckets: number[] = new Array(width);
  for (let i = 0; i < width; i++) {
    const start = Math.floor((i * safe.length) / width);
    const end = Math.max(start + 1, Math.floor(((i + 1) * safe.length) / width));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < safe.length; j++) {
      sum += safe[j];
      count += 1;
    }
    buckets[i] = count > 0 ? sum / count : (safe[Math.min(start, safe.length - 1)] ?? 0);
  }

  const max = Math.max(...buckets);
  const min = Math.min(0, ...buckets);
  if (max === min) return SPARK_CHARS[0].repeat(width);

  return buckets
    .map((v) => {
      const idx = Math.round(((v - min) / (max - min)) * (SPARK_CHARS.length - 1));
      return SPARK_CHARS[Math.max(0, Math.min(SPARK_CHARS.length - 1, idx))];
    })
    .join("");
}

// ── Horizontal bar ───────────────────────────────────────────────────────

/**
 * Renders a `value`/`max` ratio as a `width`-wide bar: █ for filled cells,
 * a single ▓ boundary cell for the fractional remainder, ░ for the rest.
 */
export function hbar(value: number, max: number, width: number): string {
  if (width <= 0) return "";
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const exact = ratio * width;
  const filled = Math.min(width, Math.floor(exact));
  const remainder = exact - filled;

  let bar = "█".repeat(filled);
  if (bar.length < width && remainder > 0) bar += "▓";
  if (bar.length < width) bar += "░".repeat(width - bar.length);
  return bar;
}

// ── Stacked bar ──────────────────────────────────────────────────────────

export interface StackedBarPart {
  value: number;
  styleKey: PaletteKey;
}

/**
 * Draws a horizontal bar split into differently-styled segments (e.g.
 * heuristic vs. measured savings). Unlike sparkline/hbar this needs
 * per-cell color, so it writes directly into the screen rather than
 * returning a plain string.
 */
export function stackedBar(screen: Screen, x: number, y: number, parts: StackedBarPart[], width: number): void {
  if (width <= 0) return;
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  if (total <= 0) {
    screen.drawText(x, y, "░".repeat(width), { fg: "dim" }, width);
    return;
  }

  let cursor = 0;
  let remaining = width;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;
    const share = isLast ? remaining : Math.min(remaining, Math.round((Math.max(0, part.value) / total) * width));
    for (let k = 0; k < share; k++) {
      screen.set(x + cursor + k, y, "█", { fg: part.styleKey });
    }
    cursor += share;
    remaining -= share;
  }
  if (remaining > 0) {
    for (let k = 0; k < remaining; k++) screen.set(x + cursor + k, y, "░", { fg: "dim" });
  }
}

// ── Table ────────────────────────────────────────────────────────────────

export interface TableColumn {
  label: string;
  width: number;
  align?: "left" | "right";
}

export interface TableOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  columns: TableColumn[];
  rows: string[][];
  scrollOffset: number;
  selectedIndex?: number;
}

/**
 * Draws a header row plus a scrolling window of body rows within a
 * `w`x`h` rectangle (h includes the header). Shows a scroll indicator in
 * the top-right corner of the header when there's more content above or
 * below the visible window.
 */
export function drawTable(screen: Screen, opts: TableOptions): void {
  const { x, y, w, h, columns, rows, scrollOffset, selectedIndex } = opts;
  if (w <= 0 || h <= 0) return;

  let colX = x;
  for (const col of columns) {
    const label = padToWidth(truncateToWidth(col.label, col.width), col.width, col.align ?? "left");
    screen.drawText(colX, y, label, { fg: "dim", bold: true }, Math.min(col.width, x + w - colX));
    colX += col.width + 1;
  }

  const bodyHeight = h - 1;
  if (bodyHeight <= 0) return;

  const clampedOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, rows.length - bodyHeight)));
  const visible = rows.slice(clampedOffset, clampedOffset + bodyHeight);

  for (let i = 0; i < visible.length; i++) {
    const row = visible[i];
    const rowIndex = clampedOffset + i;
    const rowStyle: Style = rowIndex === selectedIndex ? { fg: "accent", bold: true } : { fg: "text" };
    let cx = x;
    for (let c = 0; c < columns.length; c++) {
      const col = columns[c];
      const cell = padToWidth(truncateToWidth(row[c] ?? "", col.width), col.width, col.align ?? "left");
      screen.drawText(cx, y + 1 + i, cell, rowStyle, Math.min(col.width, x + w - cx));
      cx += col.width + 1;
    }
  }

  const hasMoreAbove = clampedOffset > 0;
  const hasMoreBelow = clampedOffset + bodyHeight < rows.length;
  if ((hasMoreAbove || hasMoreBelow) && w > 0) {
    if (hasMoreAbove) screen.set(x + w - 1, y, "▲", { fg: "dim" });
    if (hasMoreBelow) screen.set(x + w - 1, y + h - 1, "▼", { fg: "dim" });
  }
}

// ── List overlay ─────────────────────────────────────────────────────────

export interface ListOverlayOptions {
  title: string;
  items: string[];
  /** -1 means no row is selectable/highlighted (e.g. a placeholder message). */
  selectedIndex: number;
  footerHint?: string;
  /** Dim-styled suffix per item (e.g. a cwd), same length as `items`. */
  subItems?: string[];
}

/**
 * Draws a centered bordered overlay listing selectable items — same
 * centered-box shape as drawHelpOverlay, but with a highlighted selected
 * row (▸ marker, accent style) and a scrolling window when items exceed
 * ~70% of the screen height.
 */
export function drawListOverlay(screen: Screen, opts: ListOverlayOptions): void {
  const { title, items, selectedIndex, footerHint, subItems } = opts;
  if (screen.cols <= 0 || screen.rows <= 0) return;

  const MARKER_W = 2; // "▸ " / "  "
  const itemsWidth = items.reduce((max, item, i) => {
    const sub = subItems?.[i] ? " " + subItems[i] : "";
    return Math.max(max, MARKER_W + stringWidth(item) + stringWidth(sub));
  }, 0);
  const contentWidth = Math.max(20, itemsWidth, footerHint ? stringWidth(footerHint) : 0);
  const w = Math.min(screen.cols, contentWidth + 4);

  const footerRows = footerHint ? 1 : 0;
  const chrome = 3 + footerRows; // top border, blank padding row, bottom border, optional footer
  const maxH = Math.max(6, Math.floor(screen.rows * 0.7));
  const desiredH = chrome + Math.max(1, items.length);
  const h = Math.min(screen.rows, maxH, Math.max(6, desiredH));

  const x = Math.max(0, Math.floor((screen.cols - w) / 2));
  const y = Math.max(0, Math.floor((screen.rows - h) / 2));

  drawBox(screen, { x, y, w, h, title, focused: true });

  const bodyH = Math.max(0, h - chrome);
  if (bodyH <= 0) return;

  const clampedSelected =
    items.length > 0 && selectedIndex >= 0 ? Math.max(0, Math.min(selectedIndex, items.length - 1)) : -1;

  let offset = 0;
  if (clampedSelected >= bodyH) offset = clampedSelected - bodyH + 1;
  offset = Math.max(0, Math.min(offset, Math.max(0, items.length - bodyH)));

  const visible = items.slice(offset, offset + bodyH);
  visible.forEach((item, i) => {
    const rowIndex = offset + i;
    const rowY = y + 2 + i;
    const isSelected = rowIndex === clampedSelected;
    const marker = isSelected ? "▸ " : "  ";
    const style: Style = isSelected ? { fg: "accent", bold: true } : { fg: "text" };
    const label = marker + item;
    screen.drawText(x + 2, rowY, label, style, w - 4);
    const sub = subItems?.[rowIndex];
    if (sub) {
      const usedW = stringWidth(label);
      const subX = x + 2 + usedW + 1;
      const subMaxW = w - 4 - usedW - 1;
      if (subMaxW > 0) screen.drawText(subX, rowY, sub, { fg: "dim" }, subMaxW);
    }
  });

  const hasMoreAbove = offset > 0;
  const hasMoreBelow = offset + bodyH < items.length;
  if (hasMoreAbove) screen.set(x + w - 2, y, "▲", { fg: "dim" });
  if (hasMoreBelow) screen.set(x + w - 2, y + h - 1, "▼", { fg: "dim" });

  if (footerHint) {
    screen.drawText(x + 2, y + h - 2, footerHint, { fg: "dim" }, w - 4);
  }
}

// ── Help overlay ─────────────────────────────────────────────────────────

/** Draws a centered bordered overlay listing key → description pairs. */
export function drawHelpOverlay(screen: Screen, keys: Array<[string, string]>): void {
  const keyColWidth = Math.max(3, ...keys.map(([k]) => stringWidth(k)));
  const descColWidth = Math.max(10, ...keys.map(([, d]) => stringWidth(d)));
  const contentWidth = keyColWidth + 2 + descColWidth;
  const w = Math.min(screen.cols, contentWidth + 4);
  const h = Math.min(screen.rows, keys.length + 4);
  const x = Math.max(0, Math.floor((screen.cols - w) / 2));
  const y = Math.max(0, Math.floor((screen.rows - h) / 2));

  drawBox(screen, { x, y, w, h, title: "Help", focused: true });
  for (let i = 0; i < keys.length && i + 2 < h - 1; i++) {
    const [key, desc] = keys[i];
    const line = `${padToWidth(key, keyColWidth, "left")}  ${desc}`;
    screen.drawText(x + 2, y + 2 + i, line, { fg: "text" }, w - 4);
  }
}
