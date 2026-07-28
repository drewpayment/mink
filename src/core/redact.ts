// Secret / PII redaction (spec 28). A high-precision, low-false-positive pass
// that masks high-confidence secret and PII shapes before content is persisted,
// so nothing sensitive lands in ~/.mink or a synced git remote regardless of the
// caller. Deterministic and dependency-free: the same input always yields the
// same output, so it never perturbs a prompt-cache prefix or a measurement.
//
// `redactSecrets` is the pure engine (optionally honoring a value allowlist).
// `redactForStorage` is the config-aware wrapper applied at persistence
// boundaries: it respects the `redaction.enabled` toggle and `redaction.allowlist`.
//
// Precision over recall by design: patterns match distinctive secret shapes.
// Notably we do NOT mask bare long hex/base64 runs, which would swallow git
// SHAs and content hashes — false positives that would corrupt legitimate data.

import { resolveConfigValue } from "./global-config";

export interface RedactionResult {
  text: string;
  /** Number of distinct matches masked. */
  redactions: number;
}

export interface RedactOptions {
  /** Exact matched values that must never be masked (known-safe). */
  allowlist?: Set<string>;
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
// masked. Value-group rules mask only the captured value so the key/context
// stays legible (e.g. `api_key=[REDACTED:assignment]`).
const RULES: Rule[] = [
  // Private key block — to END if present, else to the next blank line or EOF.
  { kind: "private-key", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|(?=\r?\n\r?\n)|$)/g },
  { kind: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "gcp-api-key", pattern: /\bAIza[0-9A-Za-z_\-]{35}\b/g },
  { kind: "google-oauth", pattern: /\bya29\.[A-Za-z0-9_\-]{20,}/g },
  { kind: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { kind: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: "stripe-key", pattern: /\b[srp]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: "openai-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_\-]{20,}\b/g },
  { kind: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: "bearer", pattern: /\bBearer\s+([A-Za-z0-9._\-]{20,})/g, group: 1 },
  { kind: "email", pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  {
    kind: "assignment",
    // key = "value" | key: value, for secret-ish key names, value ≥ 12 chars.
    pattern:
      /\b(?:api[_-]?key|secret|token|password|passwd|pwd|access[_-]?key|private[_-]?key|client[_-]?secret)\b\s*[:=]\s*["']?([A-Za-z0-9/+_\-.]{12,})["']?/gi,
    group: 1,
  },
];

/**
 * Mask high-confidence secrets/PII in the text. Values present in
 * `opts.allowlist` are left intact. Never throws.
 */
export function redactSecrets(text: string, opts: RedactOptions = {}): RedactionResult {
  if (!text) return { text, redactions: 0 };
  const allow = opts.allowlist;

  let out = text;
  let count = 0;

  for (const rule of RULES) {
    const placeholder = `[REDACTED:${rule.kind}]`;
    out = out.replace(rule.pattern, (match, ...groups) => {
      const groupIdx = rule.group ?? 0;
      const value = groupIdx === 0 ? match : (groups[groupIdx - 1] as string | undefined);
      if (typeof value !== "string" || value.length === 0) return match;
      if (allow && allow.has(value)) return match; // known-safe — keep
      count++;
      return groupIdx === 0 ? placeholder : match.replace(value, placeholder);
    });
  }

  return { text: out, redactions: count };
}

function loadAllowlist(): Set<string> {
  const raw = resolveConfigValue("redaction.allowlist").value;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
}

/**
 * Config-aware redaction for persistence boundaries. When `redaction.enabled`
 * is not "true" the text is returned unchanged; otherwise `redaction.allowlist`
 * values are exempted.
 */
export function redactForStorage(text: string): RedactionResult {
  if (resolveConfigValue("redaction.enabled").value !== "true") {
    return { text, redactions: 0 };
  }
  return redactSecrets(text, { allowlist: loadAllowlist() });
}
