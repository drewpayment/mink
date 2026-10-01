import { describe, test, expect } from "bun:test";
import {
  rerank,
  normalizeQuery,
  candidateReprHash,
  judgeCacheKey,
  type JudgmentCache,
  type RerankOptions,
} from "../../src/core/rerank";
import type { JudgeCandidate, RelevanceJudge } from "../../src/core/relevance-judge";
import { JudgeError } from "../../src/core/relevance-judge";
import type { RecallResult } from "../../src/repositories/wiki-search-repo";

const cand = (path: string): RecallResult => ({
  path,
  title: path,
  snippet: "",
  score: 1,
  tags: [],
  category: "inbox",
  updated: "2026-01-01T00:00:00.000Z",
});

function counting(model = "m1", scores: Record<string, number> = {}, failOn: string[] = []) {
  const calls: string[] = [];
  const judge: RelevanceJudge = {
    modelVersion: model,
    questionVersion: "q/v1",
    async judge(_q, c) {
      calls.push(c.path);
      if (failOn.includes(c.path)) throw new JudgeError("network");
      return { relevance: scores[c.path] ?? 0.9, inputTokens: 10 };
    },
  };
  return { judge, calls };
}

// In-memory cache with the same keying rules as the SQLite one.
function memCache() {
  const store = new Map<string, number>();
  const k = (q: string, c: JudgeCandidate, jk: string) => `${normalizeQuery(q)}|${c.path}|${candidateReprHash(c)}|${jk}`;
  const cache: JudgmentCache = {
    get(q, cands, jk) {
      const out = new Map<string, number>();
      for (const c of cands) {
        const v = store.get(k(q, c, jk));
        if (v !== undefined) out.set(c.path, v);
      }
      return out;
    },
    put(q, entries, jk) {
      for (const e of entries) store.set(k(q, e.candidate, jk), e.relevance);
    },
  };
  return { cache, store };
}

const opts = (over: Partial<RerankOptions> = {}): RerankOptions => ({
  budgetMs: 3000,
  concurrency: 4,
  minRelevance: 0.5,
  limit: 10,
  ...over,
});

describe("rerank + judgment cache", () => {
  test("normalizeQuery lowercases and collapses whitespace but keeps word order", () => {
    expect(normalizeQuery("  Token   BUCKET\tlimits ")).toBe("token bucket limits");
    expect(normalizeQuery("b a")).not.toBe(normalizeQuery("a b"));
    expect(judgeCacheKey("jev-latest", "answers_query/v1")).toBe("jev-latest/answers_query/v1");
  });

  test("a full cache hit makes no judge calls and still reports ranker=judge", async () => {
    const { cache } = memCache();
    const cands = [cand("a.md"), cand("b.md")];
    const first = counting("m1", { "a.md": 0.9, "b.md": 0.7 });
    await rerank("Q", cands, new Map(), first.judge, opts({ cache }));
    expect(first.calls.length).toBe(2);

    const second = counting("m1");
    const out = await rerank("  q ", cands, new Map(), second.judge, opts({ cache }));
    expect(second.calls).toEqual([]);
    expect(out.summary).toMatchObject({ ranker: "judge", cache_hits: 2, judged: 2, fallback_reason: null, input_tokens: 0 });
    expect(out.results.map((r) => [r.path, r.relevance])).toEqual([
      ["a.md", 0.9],
      ["b.md", 0.7],
    ]);
  });

  test("a partial hit judges only the misses", async () => {
    const { cache } = memCache();
    const a = counting("m1");
    await rerank("q", [cand("a.md")], new Map(), a.judge, opts({ cache }));
    const b = counting("m1");
    const out = await rerank("q", [cand("a.md"), cand("b.md")], new Map(), b.judge, opts({ cache }));
    expect(b.calls).toEqual(["b.md"]);
    expect(out.summary.cache_hits).toBe(1);
    expect(out.summary.input_tokens).toBe(10);
  });

  test("editing a note body (excerpt) invalidates its entry", async () => {
    const { cache } = memCache();
    const f1 = counting();
    await rerank("q", [cand("a.md")], new Map([["a.md", "old body"]]), f1.judge, opts({ cache }));
    const f2 = counting();
    await rerank("q", [cand("a.md")], new Map([["a.md", "old body"]]), f2.judge, opts({ cache }));
    expect(f2.calls).toEqual([]);
    const f3 = counting();
    const out = await rerank("q", [cand("a.md")], new Map([["a.md", "new body"]]), f3.judge, opts({ cache }));
    expect(f3.calls).toEqual(["a.md"]);
    expect(out.summary.cache_hits).toBe(0);
  });

  test("a model change invalidates entries", async () => {
    const { cache } = memCache();
    await rerank("q", [cand("a.md")], new Map(), counting("m1").judge, opts({ cache }));
    const other = counting("m2");
    await rerank("q", [cand("a.md")], new Map(), other.judge, opts({ cache }));
    expect(other.calls).toEqual(["a.md"]);
  });

  test("a cache that throws is treated as a miss and never breaks recall", async () => {
    const cache: JudgmentCache = {
      get() {
        throw new Error("db locked");
      },
      put() {
        throw new Error("db locked");
      },
    };
    const f = counting();
    const out = await rerank("q", [cand("a.md"), cand("b.md")], new Map(), f.judge, opts({ cache }));
    expect(f.calls.sort()).toEqual(["a.md", "b.md"]);
    expect(out.summary).toMatchObject({ ranker: "judge", cache_hits: 0 });
  });

  test("without a cache cache_hits is 0", async () => {
    const out = await rerank("q", [cand("a.md")], new Map(), counting().judge, opts());
    expect(out.summary.cache_hits).toBe(0);
  });

  test("on fallback, individually successful judgments are still cached (cheaper retry)", async () => {
    const { cache, store } = memCache();
    const f = counting("m1", {}, ["b.md"]);
    const out = await rerank("q", [cand("a.md"), cand("b.md")], new Map(), f.judge, opts({ cache, concurrency: 1 }));
    expect(out.summary.ranker).toBe("wide");
    expect(store.size).toBe(1);
    const retry = counting("m1");
    const again = await rerank("q", [cand("a.md"), cand("b.md")], new Map(), retry.judge, opts({ cache }));
    expect(retry.calls).toEqual(["b.md"]);
    expect(again.summary).toMatchObject({ ranker: "judge", cache_hits: 1 });
  });
});
