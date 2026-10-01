// Usage accounting for judge-mode recall (spec 25 phase 3). One JSON line per
// reranked recall in `<minkRoot>/recall-usage.jsonl`; `mink status` renders a
// 7-day summary. Per-machine state: the file is in sync.ts's GITIGNORE_CONTENTS
// and never syncs. Everything here is best-effort and must never throw into
// recall.
//
// Import boundary: only the type of RetrievalSummary is imported (erased at
// compile time), so this module does not pull in the reranker or any judge.

import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { minkRoot } from "./paths";
import type { RetrievalSummary } from "./rerank";

/** USD per 1M input tokens for the Jev judge via the Vercel AI Gateway. */
export const JEV_PRICE_PER_MILLION_INPUT_TOKENS_USD = 0.042;

export const USAGE_FILE_NAME = "recall-usage.jsonl";
export const USAGE_TRIM_THRESHOLD_LINES = 6000;
export const USAGE_TRIM_KEEP_LINES = 5000;
// A serialized entry is well over 80 bytes, so a file smaller than this
// cannot exceed the line threshold and we skip reading it on append.
const MIN_BYTES_PER_LINE = 80;

export interface RecallUsageEntry {
  ts: string;
  candidates: number;
  judged: number;
  cache_hits: number;
  input_tokens: number;
  latency_ms: number;
  fallback_reason: string | null;
  judge_model: string | null;
}

export function recallUsagePath(): string {
  return join(minkRoot(), USAGE_FILE_NAME);
}

export function buildUsageEntry(summary: RetrievalSummary, latencyMs: number, now = new Date()): RecallUsageEntry {
  return {
    ts: now.toISOString(),
    candidates: summary.candidates,
    judged: summary.judged,
    cache_hits: summary.cache_hits,
    input_tokens: summary.input_tokens,
    latency_ms: Math.round(latencyMs),
    fallback_reason: summary.fallback_reason,
    judge_model: summary.judge_model,
  };
}

/** Appends one usage line; trims to the last 5000 lines once past ~6000. Never throws. */
export function appendRecallUsage(
  summary: RetrievalSummary,
  latencyMs: number,
  opts: { path?: string; now?: Date; trimThreshold?: number; keep?: number } = {}
): void {
  try {
    const path = opts.path ?? recallUsagePath();
    const threshold = opts.trimThreshold ?? USAGE_TRIM_THRESHOLD_LINES;
    const keep = opts.keep ?? USAGE_TRIM_KEEP_LINES;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(buildUsageEntry(summary, latencyMs, opts.now)) + "\n");
    if (statSync(path).size < threshold * MIN_BYTES_PER_LINE) return;
    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
    if (lines.length > threshold) writeFileSync(path, lines.slice(-keep).join("\n") + "\n");
  } catch {
    // best-effort accounting
  }
}

export interface RecallUsageSummary {
  windowDays: number;
  queries: number;
  cacheHitRate: number;
  inputTokens: number;
  costUsd: number;
  fallbacks: number;
}

export function summarizeRecallUsage(
  opts: { path?: string; now?: number; windowDays?: number } = {}
): RecallUsageSummary | null {
  const windowDays = opts.windowDays ?? 7;
  try {
    const path = opts.path ?? recallUsagePath();
    if (!existsSync(path)) return null;
    const cutoff = (opts.now ?? Date.now()) - windowDays * 24 * 60 * 60 * 1000;
    let queries = 0;
    let candidates = 0;
    let hits = 0;
    let tokens = 0;
    let fallbacks = 0;
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      let e: Partial<RecallUsageEntry>;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const t = Date.parse(e.ts ?? "");
      if (!Number.isFinite(t) || t < cutoff) continue;
      queries++;
      candidates += Number(e.candidates) || 0;
      hits += Number(e.cache_hits) || 0;
      tokens += Number(e.input_tokens) || 0;
      if (e.fallback_reason) fallbacks++;
    }
    if (queries === 0) return null;
    return {
      windowDays,
      queries,
      cacheHitRate: candidates > 0 ? hits / candidates : 0,
      inputTokens: tokens,
      costUsd: (tokens / 1_000_000) * JEV_PRICE_PER_MILLION_INPUT_TOKENS_USD,
      fallbacks,
    };
  } catch {
    return null;
  }
}

export function formatRecallUsageLine(s: RecallUsageSummary): string {
  const tok = s.inputTokens >= 1_000_000 ? `${(s.inputTokens / 1_000_000).toFixed(1)}M` : s.inputTokens >= 1000 ? `${(s.inputTokens / 1000).toFixed(1)}k` : String(s.inputTokens);
  return (
    `recall rerank (${s.windowDays}d): ${s.queries} queries · ${Math.round(s.cacheHitRate * 100)}% cache hits · ` +
    `${tok} tokens ≈ $${s.costUsd.toFixed(2)} · ${s.fallbacks} fallback${s.fallbacks === 1 ? "" : "s"}`
  );
}
