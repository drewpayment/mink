// Relevance reranking (spec 25): judge every candidate against the query
// under a shared time budget, then order by relevance and drop what falls
// below the threshold. All-or-nothing: if any candidate is left unjudged the
// caller gets the input (lexical) order back, never a mix.
//
// Import boundary: hooks must not reach this module (see the import-graph
// guard test). It is imported only from core/recall-ranked.ts.

import { createHash } from "crypto";
import { estimateTokens } from "./note-index";
import { significantQueryTokens, type RecallResult } from "../repositories/wiki-search-repo";
import { JudgeError, QUESTION_VERSION, type JudgeCandidate, type RelevanceJudge } from "./relevance-judge";

export const EXCERPT_TOKEN_BUDGET = 400;
export const EXCERPT_HARD_CAP_CHARS = 2000;
const CHARS_PER_TOKEN = 3.75; // inverse of estimateTokens()
const INITIAL_BACKOFF_MS = 250;

export interface RetrievalSummary {
  ranker: "lexical" | "wide" | "judge";
  candidates: number;
  judged: number;
  empty_reason: "lexical" | "judged" | null;
  fallback_reason: string | null;
  judge_model: string | null;
  input_tokens: number;
  /** Candidates whose judgment came from the cache instead of a judge call. */
  cache_hits: number;
  /** One actionable, user-facing warning (auth/model problems only). */
  warning?: string;
}

/**
 * Judgment cache seam. Implementations must be cheap and synchronous; the
 * reranker treats any throw as a miss, so a broken cache can never break
 * recall. `get` returns a map of candidate path -> cached relevance.
 */
export interface JudgmentCache {
  get(query: string, candidates: JudgeCandidate[], judgeKey: string): Map<string, number>;
  put(query: string, entries: Array<{ candidate: JudgeCandidate; relevance: number }>, judgeKey: string): void;
}

/** Lowercased, whitespace-collapsed, trimmed. Word order is preserved (it is meaning). */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, " ").trim();
}

/** sha256 of the exact candidate JSON sent to the judge: any change to title/path/tags/excerpt invalidates. */
export function candidateReprHash(c: JudgeCandidate): string {
  return createHash("sha256")
    .update(JSON.stringify({ title: c.title, path: c.path, tags: c.tags, excerpt: c.excerpt }))
    .digest("hex");
}

/** `${model}/${question version}`: the model is the configured name (the gateway floats `jev-latest`). */
export function judgeCacheKey(model: string, questionVersion: string = QUESTION_VERSION): string {
  return `${model}/${questionVersion}`;
}

export interface RerankOptions {
  /** Optional judgment cache (see JudgmentCache). Rerank stays pure without one. */
  cache?: JudgmentCache;
  budgetMs: number;
  concurrency: number;
  minRelevance: number;
  limit: number;
  /** Injectable clock for tests (defaults to Date.now). */
  now?: () => number;
  /** Injectable abortable sleep for tests (defaults to a timer). */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface RerankOutcome {
  results: RecallResult[];
  summary: RetrievalSummary;
}

// ── Excerpt ──────────────────────────────────────────────────────────────

/**
 * Bounded body window for the judge: at most `maxTokens` (estimated) around
 * the first query-token match, else from the start of the body, hard-capped
 * in characters so one enormous line cannot blow the budget.
 */
export function buildBodyExcerpt(query: string, body: string | undefined, maxTokens = EXCERPT_TOKEN_BUDGET): string {
  if (!body) return "";
  const windowChars = Math.max(1, Math.min(Math.floor(maxTokens * CHARS_PER_TOKEN), EXCERPT_HARD_CAP_CHARS));
  if (estimateTokens(body) <= maxTokens && body.length <= windowChars) {
    return body.replace(/\s+/g, " ").trim().slice(0, EXCERPT_HARD_CAP_CHARS);
  }

  const lower = body.toLowerCase();
  let hit = -1;
  for (const t of significantQueryTokens(query)) {
    const idx = lower.indexOf(t);
    if (idx !== -1 && (hit === -1 || idx < hit)) hit = idx;
  }
  let start = hit === -1 ? 0 : Math.max(0, hit - Math.floor(windowChars / 2));
  const end = Math.min(body.length, start + windowChars);
  start = Math.max(0, end - windowChars);

  const prefix = start > 0 ? "… " : "";
  const suffix = end < body.length ? " …" : "";
  const text = body.slice(start, end).replace(/\s+/g, " ").trim();
  return (prefix + text + suffix).slice(0, EXCERPT_HARD_CAP_CHARS);
}

export function buildJudgeCandidate(
  query: string,
  r: Pick<RecallResult, "path" | "title" | "tags">,
  body: string | undefined,
  maxTokens = EXCERPT_TOKEN_BUDGET
): JudgeCandidate {
  return { path: r.path, title: r.title, tags: r.tags, excerpt: buildBodyExcerpt(query, body, maxTokens) };
}

// ── Reranker ─────────────────────────────────────────────────────────────

function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

function warningFor(err: JudgeError, model?: string): string | undefined {
  if (err.kind === "auth") {
    return (
      "judge rejected the API key; check recall.rerank-api-key / JEV_API_KEY and recall.rerank-base-url " +
      "(a Vercel AI Gateway key needs recall.rerank-base-url https://ai-gateway.vercel.sh/typesafe)"
    );
  }
  if (err.kind === "model") {
    return `judge does not know model "${model ?? "?"}"; set recall.rerank-model (the gateway accepts jev or jev-latest)`;
  }
  return undefined;
}

function toJudgeError(e: unknown): JudgeError {
  if (e instanceof JudgeError) return e;
  return new JudgeError("malformed", e instanceof Error ? e.message : String(e));
}

export async function rerank(
  query: string,
  candidates: RecallResult[],
  bodies: Map<string, string>,
  judge: RelevanceJudge,
  opts: RerankOptions
): Promise<RerankOutcome> {
  const limit = Math.max(1, opts.limit);
  if (candidates.length === 0) {
    return {
      results: [],
      summary: {
        ranker: "wide",
        candidates: 0,
        judged: 0,
        empty_reason: "lexical",
        fallback_reason: null,
        judge_model: null,
        input_tokens: 0,
        cache_hits: 0,
      },
    };
  }

  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const deadline = now() + opts.budgetMs;
  const controller = new AbortController();
  const { signal } = controller;

  let failure: JudgeError | null = null;
  const fail = (err: JudgeError) => {
    if (failure === null) failure = err;
    controller.abort();
  };
  const timer = setTimeout(() => {
    controller.abort();
  }, Math.max(0, opts.budgetMs));

  const scores = new Map<string, number>();
  let inputTokens = 0;
  let reportedModel: string | undefined;

  // Cache lookup first. Any cache failure is a miss, never an error.
  const jcByPath = new Map<string, JudgeCandidate>(
    candidates.map((c) => [c.path, buildJudgeCandidate(query, c, bodies.get(c.path))])
  );
  const judgeKey = judgeCacheKey(judge.modelVersion, judge.questionVersion);
  if (opts.cache) {
    try {
      const hits = opts.cache.get(query, [...jcByPath.values()], judgeKey);
      for (const [path, rel] of hits) {
        if (jcByPath.has(path) && typeof rel === "number" && Number.isFinite(rel)) scores.set(path, rel);
      }
    } catch {
      scores.clear();
    }
  }
  const cacheHits = scores.size;
  const misses = candidates.filter((c) => !scores.has(c.path));
  const fresh: Array<{ candidate: JudgeCandidate; relevance: number }> = [];

  const judgeOne = async (c: RecallResult): Promise<void> => {
    const jc = jcByPath.get(c.path) as JudgeCandidate;
    let backoff = INITIAL_BACKOFF_MS;
    let retried = false;
    while (!signal.aborted) {
      try {
        const r = await judge.judge(query, jc, signal);
        scores.set(c.path, r.relevance);
        fresh.push({ candidate: jc, relevance: r.relevance });
        inputTokens += r.inputTokens ?? 0;
        if (!reportedModel && r.model) reportedModel = r.model;
        return;
      } catch (e) {
        if (signal.aborted) return; // budget elapsed or another judgment already failed the run
        const err = toJudgeError(e);
        switch (err.kind) {
          case "rate_limit": {
            const delay = err.retryAfterMs ?? backoff;
            backoff *= 2;
            if (deadline - now() <= delay) return fail(err);
            await sleep(delay, signal);
            break;
          }
          case "overloaded":
          case "invalid":
            if (retried || deadline - now() <= 0) return fail(err);
            retried = true;
            break;
          default:
            // network fast-fails; auth/model are configuration errors;
            // malformed/timeout are not worth retrying.
            return fail(err);
        }
      }
    }
  };

  try {
    let next = 0;
    // Budget and all-or-nothing semantics are counted over the misses only.
    const workers = Array.from({ length: Math.max(1, Math.min(opts.concurrency, misses.length)) }, async () => {
      while (!signal.aborted && next < misses.length) {
        await judgeOne(misses[next++]);
      }
    });
    await Promise.all(workers);
  } finally {
    clearTimeout(timer);
  }

  // Store what was judged even when the run falls back below: each judgment
  // is individually valid, and keeping them makes the retry cheaper (only the
  // stragglers get judged next time). The all-or-nothing rule governs the
  // ORDERING we return, not whether a finished judgment is worth keeping.
  if (opts.cache && fresh.length > 0) {
    try {
      opts.cache.put(query, fresh, judgeKey);
    } catch {
      // best-effort
    }
  }

  if (scores.size < candidates.length) {
    const err = failure as JudgeError | null;
    return {
      results: candidates.slice(0, limit),
      summary: {
        ranker: "wide",
        candidates: candidates.length,
        judged: 0,
        empty_reason: null,
        fallback_reason: err ? err.kind : "timeout",
        judge_model: null,
        input_tokens: inputTokens,
        cache_hits: cacheHits,
        ...(err && warningFor(err, judge.modelVersion) ? { warning: warningFor(err, judge.modelVersion) } : {}),
      },
    };
  }

  const judged = candidates.map((c) => ({ ...c, relevance: scores.get(c.path) as number }));
  judged.sort(
    (a, b) =>
      b.relevance - a.relevance ||
      b.score - a.score ||
      (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : 0)
  );
  const results = judged.filter((r) => r.relevance >= opts.minRelevance).slice(0, limit);
  return {
    results,
    summary: {
      ranker: "judge",
      candidates: candidates.length,
      judged: candidates.length,
      empty_reason: results.length === 0 ? "judged" : null,
      fallback_reason: null,
      judge_model: reportedModel ?? judge.modelVersion,
      input_tokens: inputTokens,
      cache_hits: cacheHits,
    },
  };
}
