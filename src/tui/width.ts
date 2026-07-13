/**
 * Terminal display-width helpers — East-Asian wide/fullwidth chars occupy
 * two columns, combining marks and zero-width joiners/variation selectors
 * occupy zero. All width-aware placement in the TUI must route through
 * here instead of `.length`, which counts UTF-16 code units, not columns.
 */

// Zero-width ranges: combining marks, joiners, variation selectors, and
// other Unicode "default ignorable" format characters.
const ZERO_WIDTH_RANGES: Array<[number, number]> = [
  [0x0300, 0x036f], // Combining Diacritical Marks
  [0x0483, 0x0489], // Cyrillic combining marks
  [0x0591, 0x05bd],
  [0x05bf, 0x05bf],
  [0x05c1, 0x05c2],
  [0x05c4, 0x05c5],
  [0x05c7, 0x05c7],
  [0x0610, 0x061a],
  [0x064b, 0x065f],
  [0x0670, 0x0670],
  [0x06d6, 0x06dc],
  [0x06df, 0x06e4],
  [0x06e7, 0x06e8],
  [0x06ea, 0x06ed],
  [0x0711, 0x0711],
  [0x0730, 0x074a],
  [0x07a6, 0x07b0],
  [0x0816, 0x0819],
  [0x081b, 0x0823],
  [0x0825, 0x0827],
  [0x0829, 0x082d],
  [0x0900, 0x0902],
  [0x093c, 0x093c],
  [0x0941, 0x0948],
  [0x094d, 0x094d],
  [0x0951, 0x0957],
  [0x0962, 0x0963],
  [0x1ab0, 0x1aff], // Combining Diacritical Marks Extended
  [0x1dc0, 0x1dff], // Combining Diacritical Marks Supplement
  [0x200b, 0x200f], // ZWSP, ZWJ, ZWNJ, direction marks
  [0x2028, 0x202e],
  [0x2060, 0x2064], // word joiner, invisible operators
  [0x20d0, 0x20ff], // Combining Diacritical Marks for Symbols
  [0xfe00, 0xfe0f], // variation selectors
  [0xfe20, 0xfe2f], // combining half marks
  [0xfeff, 0xfeff], // BOM / zero width no-break space
];

// East Asian Wide (W) + Fullwidth (F) ranges, plus the emoji blocks that
// terminals near-universally render at two cells wide.
const WIDE_RANGES: Array<[number, number]> = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x231a, 0x231b], // watch, hourglass
  [0x2329, 0x232a],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653], // zodiac
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f3],
  [0x26f5, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2755],
  [0x2757, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0x303e], // CJK Radicals .. CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana .. CJK Compatibility
  [0x3400, 0x4dbf], // CJK Unified Ideographs Extension A
  [0x4e00, 0x9fff], // CJK Unified Ideographs
  [0xa000, 0xa4cf], // Yi Syllables / Radicals
  [0xac00, 0xd7a3], // Hangul Syllables
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0xfe30, 0xfe4f], // CJK Compatibility Forms
  [0xff00, 0xff60], // Fullwidth Forms
  [0xffe0, 0xffe6],
  [0x16fe0, 0x16fe4],
  [0x17000, 0x18d08], // Tangut
  [0x1f004, 0x1f004],
  [0x1f0cf, 0x1f0cf],
  [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a],
  [0x1f200, 0x1f2ff], // enclosed ideographic supplement
  [0x1f300, 0x1f64f], // misc symbols/pictographs, emoticons
  [0x1f680, 0x1f6ff], // transport & map
  [0x1f900, 0x1faff], // supplemental symbols & pictographs, symbols & pictographs extended-A
  [0x20000, 0x3fffd], // CJK Unified Ideographs Extension B+ and beyond
];

function inRanges(cp: number, ranges: Array<[number, number]>): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [start, end] = ranges[mid];
    if (cp < start) hi = mid - 1;
    else if (cp > end) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Display width (in terminal columns) of a single Unicode code point. */
export function charWidth(cp: number): number {
  // C0/C1 control characters and the deleted char have no visual width.
  if (cp === 0 || (cp < 0x20) || (cp >= 0x7f && cp <= 0x9f)) return 0;
  if (inRanges(cp, ZERO_WIDTH_RANGES)) return 0;
  if (inRanges(cp, WIDE_RANGES)) return 2;
  return 1;
}

/**
 * Splits a string into grapheme clusters (user-perceived characters) using
 * Intl.Segmenter, which is available in both Node >=24 and Bun. Falls back
 * to code-point iteration if Segmenter is somehow unavailable.
 */
export function graphemeClusters(s: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const seg = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    const out: string[] = [];
    for (const { segment } of seg.segment(s)) out.push(segment);
    return out;
  }
  return Array.from(s);
}

/** Display width of a single grapheme cluster: the widest code point it contains. */
function clusterWidth(cluster: string): number {
  let w = 0;
  for (const ch of cluster) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    w = Math.max(w, charWidth(cp));
  }
  return w;
}

/** Total display width of a string, in terminal columns. */
export function stringWidth(s: string): number {
  let total = 0;
  for (const cluster of graphemeClusters(s)) total += clusterWidth(cluster);
  return total;
}

/**
 * Truncates a string to fit within `max` display columns, never splitting a
 * grapheme cluster. Appends `ellipsis` (default "…", width 1) when
 * truncation actually removes content and there's room for it.
 */
export function truncateToWidth(s: string, max: number, ellipsis = "…"): string {
  if (max <= 0) return "";
  const clusters = graphemeClusters(s);
  const fullWidth = clusters.reduce((acc, c) => acc + clusterWidth(c), 0);
  if (fullWidth <= max) return s;

  const ellipsisWidth = stringWidth(ellipsis);
  const budget = Math.max(0, max - ellipsisWidth);

  let width = 0;
  let out = "";
  for (const cluster of clusters) {
    const w = clusterWidth(cluster);
    if (width + w > budget) break;
    out += cluster;
    width += w;
  }
  if (ellipsisWidth <= max - width) return out + ellipsis;
  // Not even room for the ellipsis alongside kept content — drop chars until it fits.
  while (out.length > 0 && width + ellipsisWidth > max) {
    const dropped = graphemeClusters(out).pop();
    if (dropped === undefined) break;
    out = out.slice(0, out.length - dropped.length);
    width -= clusterWidth(dropped);
  }
  return width + ellipsisWidth <= max ? out + ellipsis : out;
}

/** Pads `s` with spaces to exactly `w` display columns. No-ops if already >= w. */
export function padToWidth(s: string, w: number, align: "left" | "right" = "left"): string {
  const current = stringWidth(s);
  if (current >= w) return s;
  const pad = " ".repeat(w - current);
  return align === "right" ? pad + s : s + pad;
}
