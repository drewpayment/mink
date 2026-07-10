/**
 * Cell-grid double buffer for the TUI. Widgets render into a `Screen`;
 * `flushDiff` compares against the previously flushed frame and emits only
 * the ANSI needed to repaint changed cells — incremental updates never emit
 * a full-screen clear, which is what causes visible flicker.
 */

import { charWidth, graphemeClusters, truncateToWidth } from "./width";
import { sgr, reset, type Style } from "./style";

interface Cell {
  ch: string; // grapheme cluster; "" for the trailing half of a wide glyph
  style: Style | null;
  cont: boolean; // true for the trailing (already-occupied) cell of a wide glyph
}

function blankCell(): Cell {
  return { ch: " ", style: null, cont: false };
}

function styleEquals(a: Style | null, b: Style | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.fg === b.fg && !!a.bold === !!b.bold && !!a.dim === !!b.dim;
}

function cellEquals(a: Cell, b: Cell): boolean {
  return a.ch === b.ch && a.cont === b.cont && styleEquals(a.style, b.style);
}

function cursorTo(x: number, y: number): string {
  return `\x1b[${y + 1};${x + 1}H`;
}

export class Screen {
  cols: number;
  rows: number;
  private cells: Cell[];

  constructor(cols: number, rows: number) {
    this.cols = Math.max(0, cols);
    this.rows = Math.max(0, rows);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = blankCell();
  }

  private index(x: number, y: number): number {
    return y * this.cols + x;
  }

  private inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.cols && y >= 0 && y < this.rows;
  }

  /**
   * Places a single grapheme cluster at (x, y). Wide glyphs (width 2)
   * consume the next cell as a continuation marker; if that next cell would
   * fall outside the screen, the glyph is dropped rather than clipped in
   * half.
   */
  set(x: number, y: number, char: string, style: Style | null = null): void {
    if (!this.inBounds(x, y)) return;
    const clusters = graphemeClusters(char);
    const cluster = clusters[0] ?? " ";
    let width = 0;
    for (const ch of cluster) {
      const cp = ch.codePointAt(0);
      if (cp !== undefined) width = Math.max(width, charWidth(cp));
    }

    if (width >= 2) {
      if (!this.inBounds(x + 1, y)) return; // no room for the second cell — drop it
      this.cells[this.index(x, y)] = { ch: cluster, style, cont: false };
      this.cells[this.index(x + 1, y)] = { ch: "", style, cont: true };
      return;
    }

    this.cells[this.index(x, y)] = { ch: cluster, style, cont: false };
  }

  /**
   * Draws `text` starting at (x, y), clipped to the screen edge and to
   * `maxWidth` display columns when given. Wide characters are placed
   * whole; a wide glyph that would cross the clip boundary is dropped.
   */
  drawText(x: number, y: number, text: string, style: Style | null = null, maxWidth?: number): void {
    if (!this.inBounds(x, y)) return;
    const available = Math.min(this.cols - x, maxWidth ?? Infinity);
    if (available <= 0) return;
    const clipped = truncateToWidth(text, available, "");

    let cursor = x;
    for (const cluster of graphemeClusters(clipped)) {
      let width = 0;
      for (const ch of cluster) {
        const cp = ch.codePointAt(0);
        if (cp !== undefined) width = Math.max(width, charWidth(cp));
      }
      if (cursor - x + Math.max(width, 1) > available) break;
      this.set(cursor, y, cluster, style);
      cursor += Math.max(width, 1);
    }
  }

  /**
   * Copies this screen's cells into `dest` at (offsetX, offsetY), clipping
   * to `dest`'s bounds. Used by the shell to composite a screen's
   * self-contained render output into the full-frame canvas below the tab
   * bar and above the footer.
   */
  blitInto(dest: Screen, offsetX: number, offsetY: number): void {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const dx = x + offsetX;
        const dy = y + offsetY;
        if (!dest.inBounds(dx, dy)) continue;
        dest.cells[dest.index(dx, dy)] = this.cells[this.index(x, y)];
      }
    }
  }

  resize(cols: number, rows: number): void {
    this.cols = Math.max(0, cols);
    this.rows = Math.max(0, rows);
    this.cells = new Array(this.cols * this.rows);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = blankCell();
  }

  /** Plain-text frame with no ANSI — for snapshot tests. */
  toString(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.rows; y++) {
      let line = "";
      for (let x = 0; x < this.cols; x++) {
        const cell = this.cells[this.index(x, y)];
        if (!cell.cont) line += cell.ch;
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  /**
   * Emits the minimal ANSI needed to turn `prev`'s frame into this one:
   * cursor moves + SGR only for changed cells, coalesced into runs per row.
   * A null `prev` or a size mismatch forces a full repaint (every cell is
   * "changed"), but even that never emits a clear-screen sequence — it's
   * just every cell written via cursor moves, which paints over whatever
   * was already there.
   */
  flushDiff(prev: Screen | null): string {
    const fullRepaint = !prev || prev.cols !== this.cols || prev.rows !== this.rows;
    let out = "";

    for (let y = 0; y < this.rows; y++) {
      let x = 0;
      while (x < this.cols) {
        const cell = this.cells[this.index(x, y)];
        const prevCell = fullRepaint ? null : (prev as Screen).cells[(prev as Screen).index(x, y)];
        const changed = fullRepaint || !cellEquals(cell, prevCell as Cell);

        if (!changed) {
          x += 1;
          continue;
        }

        // Coalesce a run of consecutive changed, non-continuation cells.
        const runStart = x;
        let lastStyle: Style | null | undefined = undefined;
        let run = "";
        while (x < this.cols) {
          const c = this.cells[this.index(x, y)];
          const pc = fullRepaint ? null : (prev as Screen).cells[(prev as Screen).index(x, y)];
          const isChanged = fullRepaint || !cellEquals(c, pc as Cell);
          if (!isChanged) break;
          if (c.cont) {
            // Continuation cell of a wide glyph already emitted — just advance.
            x += 1;
            continue;
          }
          if (!styleEquals(lastStyle ?? null, c.style)) {
            run += c.style ? sgr(c.style) : reset;
            lastStyle = c.style;
          }
          run += c.ch;
          x += 1;
        }

        if (run.length > 0) {
          out += cursorTo(runStart, y) + run + reset;
        }
      }
    }

    return out;
  }
}
