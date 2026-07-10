// Deterministic, dependency-free code skeleton extraction (spec 22 phase 3).
//
// Produces a structural outline of source: top-level declarations and the direct
// members of classes/interfaces, with function/method bodies elided to "{ … }".
// It is brace-depth aware (with strings and comments masked so stray braces don't
// desync the depth), which lets it descend into a class to capture method
// signatures while suppressing the statements inside those methods.
//
// This is a heuristic skeleton, not a real parser — Mink stays zero-dependency.
// Because tool-output compression is reversible (the original is cached), a
// slightly imperfect skeleton is harmless: the model can always `mink retrieve`.
// The same extractor is intended to enrich the file index later.

const MAX_SIGNATURES = 80;
const INDENT = "  ";

// Declarations that always anchor the skeleton.
const DECL_ALWAYS =
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|enum|namespace|module|def|fn|func|impl|struct|trait)\b/;
// Variable declarations only matter to the public surface when exported.
const DECL_EXPORTED_VAR = /^\s*export\s+(?:default\s+)?(?:const|let|var)\b/;
// Inside a class/interface body (depth >= 1): method signatures and fields.
const MEMBER =
  /^\s*(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|async\s+|get\s+|set\s+|#)*[\w$]+\??\s*(?:\(|:|=)/;
// Markdown headings (only honoured for markdown files).
const HEADING = /^#{1,6}\s+\S/;
// Keywords whose block we descend into to capture members rather than elide.
const DESCEND = /\b(?:class|interface|enum|namespace|module|struct|trait|impl)\b/;

function countChar(s: string, c: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) if (s[i] === c) n++;
  return n;
}

// Net brace delta for a line, with strings and comments masked so braces inside
// them don't affect depth tracking.
function netBraces(line: string): number {
  let s = line.replace(/\/\/.*$/, "");
  s = s.replace(/\/\*.*?\*\//g, "");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  s = s.replace(/`(?:\\.|[^`\\])*`/g, "``");
  return countChar(s, "{") - countChar(s, "}");
}

function stripOpenBrace(sig: string): string {
  return sig.replace(/\{\s*$/, "").trimEnd();
}

export interface CodeSkeleton {
  lines: string[];
  totalLines: number;
}

// Extract a skeleton, or null when the content has no recognisable structure
// (the caller then falls back to a generic text window).
export function extractCodeSkeleton(
  content: string,
  opts: { markdown?: boolean } = {}
): CodeSkeleton | null {
  const rawLines = content.split("\n");
  const totalLines =
    rawLines.length > 0 && rawLines[rawLines.length - 1] === ""
      ? rawLines.length - 1
      : rawLines.length;

  const out: string[] = [];
  let depth = 0;
  let suppress = Infinity; // suppress lines while inside an elided function body

  for (const line of rawLines) {
    if (out.length >= MAX_SIGNATURES) break;
    const start = depth;
    const net = netBraces(line);

    if (start < suppress) {
      const isHeading = opts.markdown === true && HEADING.test(line);
      const captured =
        isHeading ||
        DECL_ALWAYS.test(line) ||
        DECL_EXPORTED_VAR.test(line) ||
        (start >= 1 && MEMBER.test(line));

      if (captured) {
        // Trim the source indentation; we re-indent by structural depth.
        const sig = line.trim();
        if (net > 0) {
          if (DESCEND.test(line) && !isHeading) {
            out.push(INDENT.repeat(start) + stripOpenBrace(sig) + " {");
            // descend — keep capturing members at the next depth
          } else {
            out.push(INDENT.repeat(start) + stripOpenBrace(sig) + " { … }");
            suppress = start + 1; // skip this body's contents
          }
        } else {
          out.push(INDENT.repeat(start) + sig);
        }
      }
    }

    depth = Math.max(0, depth + net);
    if (depth < suppress) suppress = Infinity; // left the elided body
  }

  if (out.length === 0) return null;
  return { lines: out, totalLines };
}
