// Conservative secret redaction (seed for spec 28 — Secret / PII Redaction).
//
// This is a deliberately high-precision, low-recall pass: it masks only
// high-confidence secret shapes so it can run on the write path without
// mangling legitimate prose or code. Spec 28 will expand recall (PII, more
// providers, entropy heuristics, an allowlist) and apply it at every
// persistence boundary. For now it guards the MCP write tools (spec 24), which
// persist model-supplied content to disk and may sync it to a git remote.
//
// Deterministic and dependency-free: the same input always yields the same
// output, so it never perturbs a prompt-cache prefix or a measurement.

export interface RedactionResult {
  text: string;
  /** Number of distinct matches masked. */
  redactions: number;
}

interface Rule {
  kind: string;
  pattern: RegExp;
  /**
   * Which capture group holds the secret value. 0 masks the whole match;
   * a positive index masks only that group (keeping surrounding context).
   */
  group?: number;
}

// Ordered high-confidence rules. Each pattern is global so all occurrences are
// masked. Assignment-style rules mask only the value group so the key stays
// legible (e.g. `api_key=[REDACTED:assignment]`).
const RULES: Rule[] = [
  // Match from the BEGIN header to the END footer when present; otherwise (a
  // truncated/pasted key with no footer) up to the next blank line or EOF, so
  // the key material is still masked without swallowing following prose.
  { kind: "private-key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|(?=\r?\n\r?\n)|$)/g },
  { kind: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "gcp-api-key", pattern: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { kind: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { kind: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "bearer", pattern: /\bBearer\s+([A-Za-z0-9._\-]{20,})/g, group: 1 },
  {
    kind: "assignment",
    // key = "value" | key: value, for secret-ish key names, value ≥ 12 chars.
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?([A-Za-z0-9/+_\-.]{12,})["']?/gi,
    group: 1,
  },
];

/**
 * Mask high-confidence secrets in the given text. Returns the redacted text and
 * the number of masked matches. Never throws.
 */
export function redactSecrets(text: string): RedactionResult {
  if (!text) return { text, redactions: 0 };

  let out = text;
  let count = 0;

  for (const rule of RULES) {
    const placeholder = `[REDACTED:${rule.kind}]`;
    out = out.replace(rule.pattern, (match, ...groups) => {
      const groupIdx = rule.group ?? 0;
      if (groupIdx === 0) {
        count++;
        return placeholder;
      }
      // groups[groupIdx-1] is the captured value; mask only it, keep the rest.
      const value = groups[groupIdx - 1] as string | undefined;
      if (typeof value !== "string" || value.length === 0) return match;
      count++;
      return match.replace(value, placeholder);
    });
  }

  return { text: out, redactions: count };
}
