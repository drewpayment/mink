// Compression pipeline orchestrator (spec 22). Ties together the config/holdout
// decisions, the pure engine, the reversible cache, and the ledger. Returns the
// replacement text to emit, or null to pass the original through unchanged.
//
// Invariants:
// - Enabled by default; the config gate still allows opt-out → no-op when off.
// - Reversible or nothing: the original is stored BEFORE we return a compressed
//   result; if storage fails we pass the original through, so a compressed
//   result is never shown without a retrievable original (spec 22 edge case).
// - Every failure degrades to "no compression" — a hook must never throw.
// - Holdout arms pass the original through but are still measured.

import {
  loadCompressionConfig,
  isEligible,
  meetsMinSavings,
  selectHoldout,
} from "./compression";
import { countTokens } from "./token-estimate";
import { compressOutput, detectContentKind } from "./output-compression";
import type { CompressionResult } from "../types/compression";
import { CompressionCacheRepo } from "../repositories/compression-cache-repo";
import { TokenLedgerRepo } from "../repositories/token-ledger-repo";

// Deterministic FNV-1a → hex, used as a stable per-event key so an identical
// output always lands in the same holdout arm (spec 22 edge case).
function contentKey(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

// Render the replacement: stable compressed body first, volatile retrieval
// footer (random token) last — matching Mink's "volatile at the end" cache
// discipline so the body forms a stable prefix.
function render(result: CompressionResult, token: string): string {
  return (
    result.compressed +
    "\n\n" +
    `— mink: compressed ${result.kind} output (${result.omittedNote}). ` +
    `Full original: mink retrieve ${token}`
  );
}

function safeRecord(
  cwd: string,
  toolName: string,
  contentKind: string,
  originalTokens: number,
  compressedTokens: number,
  holdout: boolean
): void {
  try {
    TokenLedgerRepo.for(cwd).recordCompression({
      toolName,
      contentKind,
      originalTokens,
      compressedTokens,
      holdout,
    });
  } catch {
    // Measurement is best-effort — never block the hook over a ledger write.
  }
}

export interface CompressOutcome {
  updatedToolOutput: string;
  token: string;
}

export function compressToolOutput(
  cwd: string,
  toolName: string,
  output: string,
  filePath?: string
): CompressOutcome | null {
  let cfg;
  try {
    cfg = loadCompressionConfig();
  } catch {
    return null;
  }
  if (!cfg.enabled) return null;
  if (typeof output !== "string" || output.length === 0) return null;

  const originalTokens = countTokens(output);
  if (!isEligible(originalTokens, cfg)) return null;

  const eventKey = contentKey(output);

  // Holdout arm: pass the original through, but record it as a control.
  if (selectHoldout(eventKey, cfg.holdoutFraction)) {
    const kind = detectContentKind(toolName, output, filePath);
    safeRecord(cwd, toolName, kind, originalTokens, originalTokens, true);
    return null;
  }

  const result = compressOutput(toolName, output, filePath);
  if (!result) return null;

  const token = CompressionCacheRepo.newToken();
  const replacement = render(result, token);
  const compressedTokens = countTokens(replacement);

  // Discard a weak compression and pass the original through.
  if (!meetsMinSavings(originalTokens, compressedTokens, cfg)) return null;

  // Store the original FIRST. If we cannot, do not compress — never show a
  // compressed result without a retrievable original.
  try {
    CompressionCacheRepo.for(cwd).store({
      toolName,
      contentKind: result.kind,
      content: output,
      retentionHours: cfg.retentionHours,
      token,
    });
  } catch {
    return null;
  }

  safeRecord(cwd, toolName, result.kind, originalTokens, compressedTokens, false);
  return { updatedToolOutput: replacement, token };
}
