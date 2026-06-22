// Tool-output compression engine (spec 21 §Content-Aware Compression).
//
// Pure, deterministic, dependency-free. Each compressor takes a tool output
// string and returns a smaller body plus a note of what was dropped, or null
// when it has nothing worth substituting. No I/O, no DB, no token counting and
// no retrieval-affordance text — the pipeline (compress-tool-output.ts) owns
// eligibility, the holdout, the min-savings gate, the cache, and the
// "mink retrieve" footer. Keeping this layer pure makes every strategy trivially
// testable and prompt-cache-stable (identical input → identical output).
//
// The "file" strategy does line-based signature extraction; spec 21's phase 3
// upgrades it to richer AST skeletons behind this same interface.

import type { ContentKind, CompressionResult } from "../types/compression";
import { extractCodeSkeleton } from "./code-skeleton";

// Tuning constants. Fixed (not config) so output is deterministic and stable.
const SEARCH_MAX_PER_FILE = 5;
const LOG_HEAD = 40;
const LOG_TAIL = 40;
const TEXT_HEAD = 30;
const TEXT_TAIL = 20;
const JSON_ARRAY_HEAD = 20;
const JSON_ARRAY_TAIL = 5;

// Strip ANSI CSI escape sequences (colour, cursor moves) — pure noise in logs.
const ANSI = /\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI, "");
}

function omittedMarker(n: number): string {
  return `  … ${n} line${n === 1 ? "" : "s"} omitted — mink retrieve …`;
}

// Split into lines, dropping a single trailing empty line (from a final newline)
// so counts and windows aren't skewed by it.
function toLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// ── Logs / command output ───────────────────────────────────────────────────
// Strip ANSI, collapse runs of identical lines, then keep a head+tail window.
function compressLog(content: string): { compressed: string; omittedNote: string } | null {
  const lines = toLines(stripAnsi(content));

  // Collapse consecutive duplicates into "<line>  (×N)".
  const collapsed: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let run = 1;
    while (i + run < lines.length && lines[i + run] === lines[i]) run++;
    collapsed.push(run > 1 ? `${lines[i]}  (×${run})` : lines[i]);
    i += run;
  }

  if (collapsed.length <= LOG_HEAD + LOG_TAIL) {
    // Only worth substituting if collapsing actually removed lines.
    if (collapsed.length === lines.length) return null;
    return {
      compressed: collapsed.join("\n"),
      omittedNote: `collapsed ${lines.length - collapsed.length} repeated line(s)`,
    };
  }

  const omitted = collapsed.length - LOG_HEAD - LOG_TAIL;
  const head = collapsed.slice(0, LOG_HEAD);
  const tail = collapsed.slice(collapsed.length - LOG_TAIL);
  return {
    compressed: [...head, omittedMarker(omitted), ...tail].join("\n"),
    omittedNote: `${omitted} of ${collapsed.length} log line(s) omitted (middle)`,
  };
}

// ── Search / match results ──────────────────────────────────────────────────
// Dedup exact lines and cap matches per file (the file prefix before the first
// colon), appending a per-file "+K more" tally.
function compressSearch(content: string): { compressed: string; omittedNote: string } | null {
  const lines = toLines(content);
  const seen = new Set<string>();
  const perFile = new Map<string, number>();
  const omittedByFile = new Map<string, number>();
  const out: string[] = [];

  for (const line of lines) {
    if (seen.has(line)) continue;
    seen.add(line);
    const colon = line.indexOf(":");
    const file = colon > 0 ? line.slice(0, colon) : line;
    const count = perFile.get(file) ?? 0;
    if (count < SEARCH_MAX_PER_FILE) {
      perFile.set(file, count + 1);
      out.push(line);
    } else {
      omittedByFile.set(file, (omittedByFile.get(file) ?? 0) + 1);
    }
  }

  let totalOmitted = 0;
  for (const [file, n] of omittedByFile) {
    totalOmitted += n;
    out.push(`  … +${n} more match(es) in ${file} — mink retrieve …`);
  }
  const dedupRemoved = lines.length - seen.size;

  // Nothing changed → not worth substituting.
  if (totalOmitted === 0 && dedupRemoved === 0) return null;

  const notes: string[] = [];
  if (totalOmitted > 0) notes.push(`${totalOmitted} match(es) capped`);
  if (dedupRemoved > 0) notes.push(`${dedupRemoved} duplicate(s) removed`);
  return { compressed: out.join("\n"), omittedNote: notes.join("; ") };
}

// ── Large file reads ────────────────────────────────────────────────────────
// Brace-aware structural skeleton (see code-skeleton.ts): declarations and class
// members with bodies elided. Falls back to a generic text window when the
// content has no recognisable structure.
function compressFile(
  filePath: string,
  content: string
): { compressed: string; omittedNote: string } | null {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const markdown = ext === ".md" || ext === ".mdx" || ext === ".markdown";
  const skeleton = extractCodeSkeleton(content, { markdown });

  if (!skeleton) {
    // No recognisable structure — fall back to a generic text window.
    return compressText(content);
  }

  const header =
    `${filePath} — structural summary ` +
    `(${skeleton.lines.length} signature(s) of ${skeleton.totalLines} lines)`;
  return {
    compressed: [header, ...skeleton.lines].join("\n"),
    omittedNote: `bodies elided; ${skeleton.totalLines} lines available via mink retrieve`,
  };
}

// ── Structured data ─────────────────────────────────────────────────────────
// Recursively "crush" JSON: sample any over-long array (at any depth), recursing
// into the elements that are kept. Records how many elements were dropped.
function crush(value: unknown): { value: unknown; omitted: number } {
  if (Array.isArray(value)) {
    let omitted = 0;
    const mapEl = (el: unknown): unknown => {
      const r = crush(el);
      omitted += r.omitted;
      return r.value;
    };
    if (value.length <= JSON_ARRAY_HEAD + JSON_ARRAY_TAIL) {
      return { value: value.map(mapEl), omitted };
    }
    const dropped = value.length - JSON_ARRAY_HEAD - JSON_ARRAY_TAIL;
    omitted += dropped;
    const out = [
      ...value.slice(0, JSON_ARRAY_HEAD).map(mapEl),
      `… ${dropped} element(s) omitted — mink retrieve …`,
      ...value.slice(value.length - JSON_ARRAY_TAIL).map(mapEl),
    ];
    return { value: out, omitted };
  }
  if (value && typeof value === "object") {
    let omitted = 0;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const r = crush(v);
      omitted += r.omitted;
      out[k] = r.value;
    }
    return { value: out, omitted };
  }
  return { value, omitted: 0 };
}

function compressJson(content: string): { compressed: string; omittedNote: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  const { value, omitted } = crush(parsed);
  if (omitted === 0) return null;
  return {
    compressed: JSON.stringify(value, null, 2),
    omittedNote: `${omitted} array element(s) sampled out`,
  };
}

// ── Generic text ────────────────────────────────────────────────────────────
function compressText(content: string): { compressed: string; omittedNote: string } | null {
  const lines = toLines(content);
  if (lines.length <= TEXT_HEAD + TEXT_TAIL) return null;
  const omitted = lines.length - TEXT_HEAD - TEXT_TAIL;
  const head = lines.slice(0, TEXT_HEAD);
  const tail = lines.slice(lines.length - TEXT_TAIL);
  return {
    compressed: [...head, omittedMarker(omitted), ...tail].join("\n"),
    omittedNote: `${omitted} of ${lines.length} line(s) omitted (middle)`,
  };
}

// ── Routing ─────────────────────────────────────────────────────────────────

export function detectContentKind(
  toolName: string,
  content: string,
  filePath?: string
): ContentKind {
  const t = toolName.toLowerCase();
  if (t === "read") return "file";
  if (t === "grep" || t === "glob") return "search";
  if (t === "bash") return "log";
  // Generic / MCP output — sniff for JSON.
  const head = content.trimStart()[0];
  if (head === "{" || head === "[") {
    try {
      JSON.parse(content);
      return "json";
    } catch {
      // not JSON — fall through
    }
  }
  // A file path with no tool hint still implies a file read.
  if (filePath) return "file";
  return "text";
}

// Compress an output by its detected kind. Returns null when there is nothing
// worth substituting; the caller then passes the original through unchanged.
export function compressOutput(
  toolName: string,
  content: string,
  filePath?: string
): CompressionResult | null {
  const kind = detectContentKind(toolName, content, filePath);
  let result: { compressed: string; omittedNote: string } | null;
  switch (kind) {
    case "search": result = compressSearch(content); break;
    case "log":    result = compressLog(content); break;
    case "file":   result = compressFile(filePath ?? "file", content); break;
    case "json":   result = compressJson(content); break;
    case "text":   result = compressText(content); break;
  }
  if (!result) return null;
  return { kind, compressed: result.compressed, omittedNote: result.omittedNote };
}
