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

// Tuning constants. Fixed (not config) so output is deterministic and stable.
const SEARCH_MAX_PER_FILE = 5;
const LOG_HEAD = 40;
const LOG_TAIL = 40;
const TEXT_HEAD = 30;
const TEXT_TAIL = 20;
const FILE_MAX_SIGNATURES = 60;
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
// Deterministic line-based signature extraction: declarations, exports, and
// markdown headings. Phase 3 swaps in real AST skeletons behind this function.
const SIGNATURE = new RegExp(
  [
    "^\\s*export\\s+",                              // JS/TS exports
    "^\\s*(?:async\\s+)?function\\s+\\w+",          // functions
    "^\\s*(?:public|private|protected|static|abstract|export)?\\s*class\\s+\\w+",
    "^\\s*interface\\s+\\w+",
    "^\\s*type\\s+\\w+\\s*=",
    "^\\s*enum\\s+\\w+",
    "^\\s*def\\s+\\w+",                             // Python
    "^\\s*(?:pub\\s+)?fn\\s+\\w+",                  // Rust
    "^\\s*func\\s+\\w+",                            // Go
    "^#{1,6}\\s+\\S",                               // markdown headings
  ].join("|")
);

function compressFile(
  filePath: string,
  content: string
): { compressed: string; omittedNote: string } | null {
  const lines = toLines(content);
  const signatures: string[] = [];
  for (const line of lines) {
    if (SIGNATURE.test(line)) {
      signatures.push(line.trimEnd());
      if (signatures.length >= FILE_MAX_SIGNATURES) break;
    }
  }

  if (signatures.length === 0) {
    // No recognisable structure — fall back to a generic text window.
    return compressText(content);
  }

  const header = `${filePath} — structural summary (${signatures.length} signature(s) of ${lines.length} lines)`;
  return {
    compressed: [header, ...signatures].join("\n"),
    omittedNote: `body elided; ${lines.length} lines available via mink retrieve`,
  };
}

// ── Structured data ─────────────────────────────────────────────────────────
// Sample long arrays (top-level, or arrays held directly on a top-level object)
// down to a head+tail, recording how many elements were dropped.
function sampleArray(arr: unknown[]): { sampled: unknown[]; omitted: number } {
  if (arr.length <= JSON_ARRAY_HEAD + JSON_ARRAY_TAIL) return { sampled: arr, omitted: 0 };
  const omitted = arr.length - JSON_ARRAY_HEAD - JSON_ARRAY_TAIL;
  const sampled = [
    ...arr.slice(0, JSON_ARRAY_HEAD),
    `… ${omitted} element(s) omitted — mink retrieve …`,
    ...arr.slice(arr.length - JSON_ARRAY_TAIL),
  ];
  return { sampled, omitted };
}

function compressJson(content: string): { compressed: string; omittedNote: string } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }

  let totalOmitted = 0;
  let transformed: unknown = parsed;

  if (Array.isArray(parsed)) {
    const { sampled, omitted } = sampleArray(parsed);
    transformed = sampled;
    totalOmitted += omitted;
  } else if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v)) {
        const { sampled, omitted } = sampleArray(v);
        next[k] = sampled;
        totalOmitted += omitted;
      } else {
        next[k] = v;
      }
    }
    transformed = next;
  }

  if (totalOmitted === 0) return null;
  return {
    compressed: JSON.stringify(transformed, null, 2),
    omittedNote: `${totalOmitted} array element(s) sampled out`,
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
