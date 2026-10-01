// Ranked recall (spec 25): strict, wide, or judge-reranked. This module is
// the ONLY place that wires the relevance judge into recall. It is kept out
// of core/wiki-search.ts on purpose: lifecycle hooks import wiki-search, so
// nothing there may reach the judge. commands/recall.ts imports this module
// dynamically, inside the --rerank path only.

import {
  recall as recallLexical,
  recallCandidates,
  DEFAULT_NEIGHBOUR_CAP,
  DEFAULT_POOL_SIZE,
} from "./wiki-search";
import { resolveConfigValue } from "./global-config";
import { rerank, normalizeQuery, candidateReprHash, type JudgmentCache, type RetrievalSummary } from "./rerank";
import { appendRecallUsage } from "./recall-usage";
import { createJevJudge } from "./judges/jev";
import type { JudgeCandidate, RelevanceJudge } from "./relevance-judge";
import { WikiSearchRepo, judgmentKeyId, type RecallOptions, type RecallResult } from "../repositories/wiki-search-repo";
import type { ConfigKey } from "../types/config";

export type RecallMode = "strict" | "wide" | "judge";

export interface RerankSettings {
  mode: "off" | "jev";
  apiKey: string;
  baseUrl: string;
  model: string;
  minRelevance: number;
  poolSize: number;
  timeoutMs: number;
  concurrency: number;
}

export const RERANK_DEFAULTS = {
  baseUrl: "https://api.typesafe.ai",
  model: "jev-latest",
  minRelevance: 0.7,
  poolSize: 40,
  timeoutMs: 3000,
  concurrency: 8,
} as const;

function numberIn(raw: string, min: number, max: number, fallback: number, integer: boolean): number {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < min || n > max) return fallback;
  return integer ? Math.floor(n) : n;
}

/**
 * Reads the recall.rerank-* config (env > config file > default). The judge
 * key also falls back to JEV_API_KEY. Invalid numeric values (NaN, out of
 * range) resolve to their defaults.
 */
export function resolveRerankSettings(): RerankSettings {
  const get = (k: ConfigKey) => resolveConfigValue(k).value;
  const mode = get("recall.rerank").trim().toLowerCase() === "jev" ? "jev" : "off";
  const apiKey = (get("recall.rerank-api-key").trim() || (process.env.JEV_API_KEY ?? "").trim()) as string;
  return {
    mode,
    apiKey,
    baseUrl: get("recall.rerank-base-url").trim() || RERANK_DEFAULTS.baseUrl,
    model: get("recall.rerank-model").trim() || RERANK_DEFAULTS.model,
    minRelevance: numberIn(get("recall.rerank-min-relevance"), 0, 1, RERANK_DEFAULTS.minRelevance, false),
    poolSize: numberIn(get("recall.rerank-pool-size"), 1, 200, RERANK_DEFAULTS.poolSize, true),
    timeoutMs: numberIn(get("recall.rerank-timeout-ms"), 100, 60_000, RERANK_DEFAULTS.timeoutMs, true),
    concurrency: numberIn(get("recall.rerank-concurrency"), 1, 64, RERANK_DEFAULTS.concurrency, true),
  };
}

let judgeFactoryOverride: ((settings: RerankSettings) => RelevanceJudge | null) | null = null;

/** Test seam: replace the judge built from settings (null restores the real one). */
export function setJudgeFactoryForTests(factory: ((settings: RerankSettings) => RelevanceJudge | null) | null): void {
  judgeFactoryOverride = factory;
}

export function createConfiguredJudge(
  settings: RerankSettings = resolveRerankSettings(),
  fetchImpl?: typeof fetch
): { judge: RelevanceJudge } | { reason: "no_credential" } {
  if (judgeFactoryOverride) {
    const j = judgeFactoryOverride(settings);
    return j ? { judge: j } : { reason: "no_credential" };
  }
  if (!settings.apiKey) return { reason: "no_credential" };
  return {
    judge: createJevJudge({ apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model, fetchImpl }),
  };
}

export interface RecallRankedConfig {
  mode: RecallMode;
  judge?: RelevanceJudge;
  settings?: RerankSettings;
  /** Overrides settings.minRelevance for this call. */
  minRelevance?: number;
}

export interface RecallRankedOutcome {
  results: RecallResult[];
  summary: RetrievalSummary;
}

/** SQLite-backed judgment cache in the vault's search DB. */
export function createSqliteJudgmentCache(repo: WikiSearchRepo): JudgmentCache {
  return {
    get(query, candidates: JudgeCandidate[], judgeKey) {
      const queryNorm = normalizeQuery(query);
      const keys = candidates.map((c) => ({
        queryNorm,
        path: c.path,
        reprHash: candidateReprHash(c),
        judgeKey,
      }));
      const found = repo.getJudgments(keys);
      const out = new Map<string, number>();
      keys.forEach((k) => {
        const rel = found.get(judgmentKeyId(k));
        if (rel !== undefined) out.set(k.path, rel);
      });
      return out;
    },
    put(query, entries, judgeKey) {
      const queryNorm = normalizeQuery(query);
      repo.putJudgments(
        entries.map((e) => ({
          queryNorm,
          path: e.candidate.path,
          reprHash: candidateReprHash(e.candidate),
          judgeKey,
          relevance: e.relevance,
        }))
      );
      repo.pruneJudgments();
    },
  };
}

export async function recallRanked(
  query: string,
  opts: RecallOptions,
  cfg: RecallRankedConfig
): Promise<RecallRankedOutcome> {
  const limit = opts.limit ?? 10;

  if (cfg.mode === "strict") {
    const results = recallLexical(query, opts);
    return {
      results,
      summary: {
        ranker: "lexical",
        candidates: results.length,
        judged: 0,
        empty_reason: results.length === 0 ? "lexical" : null,
        fallback_reason: null,
        judge_model: null,
        input_tokens: 0,
        cache_hits: 0,
      },
    };
  }

  const settings = cfg.settings ?? resolveRerankSettings();
  const pool = recallCandidates(query, opts, {
    poolSize: Math.max(cfg.mode === "judge" ? settings.poolSize : DEFAULT_POOL_SIZE, limit),
    neighbourCap: DEFAULT_NEIGHBOUR_CAP,
  });

  const widePlain = (fallback: string | null): RecallRankedOutcome => {
    const results = pool.slice(0, limit);
    return {
      results,
      summary: {
        ranker: "wide",
        candidates: pool.length,
        judged: 0,
        empty_reason: results.length === 0 ? "lexical" : null,
        fallback_reason: fallback,
        judge_model: null,
        input_tokens: 0,
        cache_hits: 0,
      },
    };
  };

  if (cfg.mode === "wide") return widePlain(null);

  let judge = cfg.judge;
  if (!judge) {
    const made = createConfiguredJudge(settings);
    if (!("judge" in made)) return widePlain(made.reason);
    judge = made.judge;
  }
  if (pool.length === 0) return widePlain(null);

  const repo = WikiSearchRepo.forVault();
  const bodies = repo.getBodies(pool.map((r) => r.path));
  const t0 = Date.now();
  const out = await rerank(query, pool, bodies, judge, {
    budgetMs: settings.timeoutMs,
    concurrency: settings.concurrency,
    minRelevance: cfg.minRelevance ?? settings.minRelevance,
    limit,
    cache: createSqliteJudgmentCache(repo),
  });
  appendRecallUsage(out.summary, Date.now() - t0);
  return out;
}
