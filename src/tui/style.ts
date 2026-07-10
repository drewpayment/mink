/**
 * Terminal color-depth detection and the semantic palette used by every
 * widget. Detection is a pure function of an env-like object so it can be
 * unit-tested without touching the real process.env.
 */

export type ColorDepth = "none" | "256" | "truecolor";

export type PaletteKey =
  | "accent"
  | "good"
  | "warn"
  | "error"
  | "dim"
  | "text"
  | "border"
  | "title";

export interface Style {
  fg?: PaletteKey;
  bold?: boolean;
  dim?: boolean;
}

type EnvLike = Record<string, string | undefined>;

/**
 * Resolves the usable color depth from environment variables, in priority
 * order: NO_COLOR always wins (opt-out), then COLORTERM truecolor signal,
 * then TERM-based heuristics, then a dumb/absent-TERM fallback to no color.
 */
export function detectColorDepth(env: EnvLike = process.env): ColorDepth {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return "none";

  const colorterm = (env.COLORTERM ?? "").toLowerCase();
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor";

  const term = (env.TERM ?? "").toLowerCase();
  if (term === "" || term === "dumb") return "none";
  if (term.includes("256color")) return "256";
  if ((term.startsWith("screen") || term.startsWith("tmux")) && !colorterm) return "256";

  // Any other named TERM (xterm, vt100, linux, etc.) — assume at least
  // 256-color support, which is true of essentially every terminal in use
  // today that isn't explicitly "dumb".
  return "256";
}

interface ColorSpec {
  truecolor: string; // "38;2;r;g;b"
  ansi256: string; // "38;5;n"
}

// Tokyo Night–inspired palette: cool dim backgrounds, warm accents.
const PALETTE: Record<PaletteKey, ColorSpec> = {
  accent: { truecolor: "38;2;122;162;247", ansi256: "38;5;75" },
  good: { truecolor: "38;2;158;206;106", ansi256: "38;5;114" },
  warn: { truecolor: "38;2;224;175;104", ansi256: "38;5;179" },
  error: { truecolor: "38;2;247;118;142", ansi256: "38;5;203" },
  dim: { truecolor: "38;2;86;95;137", ansi256: "38;5;60" },
  text: { truecolor: "38;2;192;202;245", ansi256: "38;5;253" },
  border: { truecolor: "38;2;65;72;104", ansi256: "38;5;238" },
  title: { truecolor: "38;2;192;202;245", ansi256: "38;5;253" },
};

/** The raw truecolor/256 SGR codes backing each semantic palette key. */
export function getPalette(): Record<PaletteKey, ColorSpec> {
  return PALETTE;
}

export const reset = "\x1b[0m";

let cachedDepth: ColorDepth | null = null;

/** The color depth resolved once at process startup (cached). */
export function activeDepth(): ColorDepth {
  if (cachedDepth === null) cachedDepth = detectColorDepth();
  return cachedDepth;
}

/** Overrides the cached depth — used by term.ts at startup and by tests. */
export function setActiveDepth(depth: ColorDepth): void {
  cachedDepth = depth;
}

/**
 * Builds the SGR escape sequence for a style at the given (or active) color
 * depth. Returns "" for a no-op style or when depth is "none".
 */
export function sgr(style: Style, depth: ColorDepth = activeDepth()): string {
  if (depth === "none") return "";
  const codes: string[] = [];
  if (style.bold) codes.push("1");
  if (style.dim) codes.push("2");
  if (style.fg) {
    const spec = PALETTE[style.fg];
    codes.push(depth === "truecolor" ? spec.truecolor : spec.ansi256);
  }
  if (codes.length === 0) return "";
  return `\x1b[${codes.join(";")}m`;
}
