import { describe, test, expect } from "bun:test";
import {
  rerank,
  buildBodyExcerpt,
  buildJudgeCandidate,
  EXCERPT_HARD_CAP_CHARS,
  type RerankOptions,
} from "../../src/core/rerank";
import {
  JudgeError,
  type JudgeCandidate,
  type JudgeResult,
  type RelevanceJudge,
} from "../../src/core/relevance-judge";
import type { RecallResult } from "../../src/repositories/wiki-search-repo";
import { estimateTokens } from "../../src/core/note-index";

function cand(path: string, score = 1, updated = "2026-01-01T00:00:00.000Z"): RecallResult {
  return { path, title: path.replace(/\.md$/, ""), snippet: "", score, tags: ["t"], category: "inbox", updated };
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new JudgeError("timeout"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new JudgeError("timeout"));
      },
      { once: true }
    );
  });
}

type Step = number | JudgeError | { relevance: number; latencyMs?: number; inputTokens?: number; model?: string } | "hang";

// Scripted fake: per-path list of steps consumed one per call (last repeats).
function fakeJudge(script: Record<string, Step[] | Step> | ((path: string, call: number) => Step)) {
  const calls: Array<{ path: string; excerpt: string }> = [];
  const perPath = new Map<string, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const judge: RelevanceJudge = {
    modelVersion: "fake-latest",
    questionVersion: "test/v1",
    async judge(_q: string, c: JudgeCandidate, signal: AbortSignal): Promise<JudgeResult> {
      calls.push({ path: c.path, excerpt: c.excerpt });
      const n = perPath.get(c.path) ?? 0;
      perPath.set(c.path, n + 1);
      let step: Step;
      if (typeof script === "function") step = script(c.path, n);
      else {
        const s = script[c.path];
        step = Array.isArray(s) ? s[Math.min(n, s.length - 1)] : (s as Step);
      }
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (step instanceof JudgeError) throw step;
        if (step === "hang") {
          await wait(60_000, signal);
          throw new Error("unreachable");
        }
        if (typeof step === "number") return { relevance: step };
        if (step.latencyMs) await wait(step.latencyMs, signal);
        return { relevance: step.relevance, inputTokens: step.inputTokens, model: step.model };
      } finally {
        inFlight--;
      }
    },
  };
  return { judge, calls, maxInFlight: () => maxInFlight };
}

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
  };
}

const base = (over: Partial<RerankOptions> = {}): RerankOptions => ({
  budgetMs: 3000,
  concurrency: 8,
  minRelevance: 0.5,
  limit: 10,
  ...over,
});

describe("rerank — ordering", () => {
  test("sorts by relevance, then lexical score, then updated (newest first)", async () => {
    const cands = [
      cand("low.md", 9),
      cand("tie-old.md", 1, "2025-01-01T00:00:00.000Z"),
      cand("tie-new.md", 1, "2026-06-01T00:00:00.000Z"),
      cand("tie-score.md", 5),
      cand("top.md", 0),
    ];
    const f = fakeJudge({ "low.md": 0.6, "tie-old.md": 0.8, "tie-new.md": 0.8, "tie-score.md": 0.8, "top.md": 0.95 });
    const out = await rerank("q", cands, new Map(), f.judge, base());
    expect(out.results.map((r) => r.path)).toEqual(["top.md", "tie-score.md", "tie-new.md", "tie-old.md", "low.md"]);
    expect(out.results[0].relevance).toBe(0.95);
    expect(out.summary).toMatchObject({
      ranker: "judge",
      candidates: 5,
      judged: 5,
      empty_reason: null,
      fallback_reason: null,
      judge_model: "fake-latest",
    });
  });

  test("judge_model prefers the model the provider reported; tokens are summed", async () => {
    const f = fakeJudge({
      "a.md": { relevance: 0.9, inputTokens: 100, model: "jev-1.13.0" },
      "b.md": { relevance: 0.8, inputTokens: 50, model: "jev-1.13.0" },
    });
    const out = await rerank("q", [cand("a.md"), cand("b.md")], new Map(), f.judge, base());
    expect(out.summary.judge_model).toBe("jev-1.13.0");
    expect(out.summary.input_tokens).toBe(150);
  });

  test("drops results below minRelevance; nothing left is judged-empty", async () => {
    const f = fakeJudge({ "a.md": 0.49, "b.md": 0.2, "c.md": 0.03 });
    const out = await rerank("q", [cand("a.md"), cand("b.md"), cand("c.md")], new Map(), f.judge, base());
    expect(out.results).toEqual([]);
    expect(out.summary).toMatchObject({
      ranker: "judge",
      candidates: 3,
      judged: 3,
      empty_reason: "judged",
      fallback_reason: null,
    });
  });

  test("threshold is inclusive and partial survivors keep order", async () => {
    const f = fakeJudge({ "a.md": 0.5, "b.md": 0.1, "c.md": 0.7 });
    const out = await rerank("q", [cand("a.md"), cand("b.md"), cand("c.md")], new Map(), f.judge, base());
    expect(out.results.map((r) => r.path)).toEqual(["c.md", "a.md"]);
    expect(out.summary.empty_reason).toBeNull();
  });

  test("limit is applied after reranking, not before", async () => {
    const cands = ["a", "b", "c", "d", "e"].map((n) => cand(`${n}.md`));
    const f = fakeJudge({ "a.md": 0.6, "b.md": 0.6, "c.md": 0.6, "d.md": 0.7, "e.md": 0.99 });
    const out = await rerank("q", cands, new Map(), f.judge, base({ limit: 2 }));
    expect(out.results.map((r) => r.path)).toEqual(["e.md", "d.md"]);
    expect(out.summary.candidates).toBe(5);
    expect(f.calls.length).toBe(5);
  });

  test("empty input makes no judge calls and is lexical-empty", async () => {
    const f = fakeJudge({});
    const out = await rerank("q", [], new Map(), f.judge, base());
    expect(f.calls.length).toBe(0);
    expect(out.results).toEqual([]);
    expect(out.summary).toMatchObject({ ranker: "wide", candidates: 0, judged: 0, empty_reason: "lexical" });
  });

  test("passes the note body excerpt to the judge and tolerates notes with no body", async () => {
    const f = fakeJudge({ "a.md": 0.9, "b.md": 0.9 });
    await rerank("bucket", [cand("a.md"), cand("b.md")], new Map([["a.md", "the token bucket refills"]]), f.judge, base());
    const byPath = Object.fromEntries(f.calls.map((c) => [c.path, c.excerpt]));
    expect(byPath["a.md"]).toContain("token bucket");
    expect(byPath["b.md"]).toBe("");
  });
});

describe("rerank — fallback state machine", () => {
  test("budget exhaustion is all-or-nothing: input order, ranker wide, timeout", async () => {
    const cands = [cand("a.md", 3), cand("b.md", 2), cand("c.md", 1)];
    const f = fakeJudge({ "a.md": 0.99, "b.md": "hang", "c.md": 0.9 });
    const out = await rerank("q", cands, new Map(), f.judge, base({ budgetMs: 40, limit: 2 }));
    expect(out.results.map((r) => r.path)).toEqual(["a.md", "b.md"]);
    expect(out.results.every((r) => r.relevance === undefined)).toBe(true);
    expect(out.summary).toMatchObject({ ranker: "wide", judged: 0, fallback_reason: "timeout", judge_model: null });
    expect(out.summary.warning).toBeUndefined();
  });

  test("first network error fails fast, without waiting out the budget", async () => {
    const cands = [cand("a.md"), cand("b.md"), cand("c.md")];
    const f = fakeJudge({ "a.md": new JudgeError("network", "ECONNREFUSED"), "b.md": "hang", "c.md": "hang" });
    const t0 = Date.now();
    const out = await rerank("q", cands, new Map(), f.judge, base({ budgetMs: 10_000 }));
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(out.summary).toMatchObject({ ranker: "wide", fallback_reason: "network" });
    expect(out.results.map((r) => r.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  test("auth failure aborts, falls back, and surfaces exactly one warning", async () => {
    const cands = Array.from({ length: 10 }, (_, i) => cand(`n${i}.md`));
    const f = fakeJudge(() => new JudgeError("auth", "401"));
    const out = await rerank("q", cands, new Map(), f.judge, base({ concurrency: 4 }));
    expect(out.summary.fallback_reason).toBe("auth");
    expect(out.summary.warning).toMatch(/rejected the API key/);
    expect(out.summary.warning).toMatch(/recall\.rerank-api-key/);
    // one abort, so no more than the first wave of workers ever called out
    expect(f.calls.length).toBeLessThanOrEqual(4);
  });

  test("model_not_found becomes one actionable warning naming the model", async () => {
    const f = fakeJudge(() => new JudgeError("model", "404"));
    const out = await rerank("q", [cand("a.md"), cand("b.md")], new Map(), f.judge, base());
    expect(out.summary.fallback_reason).toBe("model");
    expect(out.summary.warning).toContain("fake-latest");
  });

  test("rate limit backs off (Retry-After) within budget, then succeeds", async () => {
    const clock = fakeClock();
    const f = fakeJudge({ "a.md": [new JudgeError("rate_limit", "429", { retryAfterMs: 700 }), 0.9], "b.md": 0.8 });
    const out = await rerank("q", [cand("a.md"), cand("b.md")], new Map(), f.judge, base({ now: clock.now, sleep: clock.sleep }));
    expect(clock.sleeps).toEqual([700]);
    expect(out.summary.ranker).toBe("judge");
    expect(out.results.map((r) => r.path)).toEqual(["a.md", "b.md"]);
  });

  test("rate limit without Retry-After backs off exponentially from 250ms", async () => {
    const clock = fakeClock();
    const rl = new JudgeError("rate_limit", "429");
    const f = fakeJudge({ "a.md": [rl, rl, rl, 0.9] });
    const out = await rerank("q", [cand("a.md")], new Map(), f.judge, base({ now: clock.now, sleep: clock.sleep }));
    expect(clock.sleeps).toEqual([250, 500, 1000]);
    expect(out.summary.ranker).toBe("judge");
  });

  test("rate limited past the budget falls back instead of sleeping", async () => {
    const clock = fakeClock();
    const f = fakeJudge({ "a.md": new JudgeError("rate_limit", "429", { retryAfterMs: 5000 }), "b.md": 0.9 });
    const out = await rerank(
      "q",
      [cand("a.md"), cand("b.md")],
      new Map(),
      f.judge,
      base({ budgetMs: 1000, now: clock.now, sleep: clock.sleep })
    );
    expect(clock.sleeps).toEqual([]);
    expect(out.summary).toMatchObject({ ranker: "wide", fallback_reason: "rate_limit" });
  });

  test("persistent rate limiting eventually exhausts the budget", async () => {
    const clock = fakeClock();
    const f = fakeJudge({ "a.md": new JudgeError("rate_limit", "429") });
    const out = await rerank("q", [cand("a.md")], new Map(), f.judge, base({ budgetMs: 1000, now: clock.now, sleep: clock.sleep }));
    expect(clock.sleeps).toEqual([250, 500]);
    expect(out.summary.fallback_reason).toBe("rate_limit");
  });

  test("overloaded is retried once, then succeeds", async () => {
    const f = fakeJudge({ "a.md": [new JudgeError("overloaded", "529"), 0.9] });
    const out = await rerank("q", [cand("a.md")], new Map(), f.judge, base());
    expect(f.calls.length).toBe(2);
    expect(out.summary.ranker).toBe("judge");
  });

  test("overloaded twice, or invalid twice, falls back", async () => {
    for (const kind of ["overloaded", "invalid"] as const) {
      const f = fakeJudge({ "a.md": new JudgeError(kind, "x") });
      const out = await rerank("q", [cand("a.md")], new Map(), f.judge, base());
      expect(f.calls.length).toBe(2);
      expect(out.summary).toMatchObject({ ranker: "wide", fallback_reason: kind });
    }
  });

  test("malformed falls back without retrying", async () => {
    const f = fakeJudge({ "a.md": new JudgeError("malformed", "noul=7") });
    const out = await rerank("q", [cand("a.md")], new Map(), f.judge, base());
    expect(f.calls.length).toBe(1);
    expect(out.summary).toMatchObject({ ranker: "wide", fallback_reason: "malformed" });
  });

  test("one failure among many successes still falls back whole (never mixes)", async () => {
    const cands = [cand("a.md", 1), cand("b.md", 2), cand("c.md", 3)];
    const f = fakeJudge({ "a.md": 0.99, "b.md": new JudgeError("malformed", "x"), "c.md": 0.1 });
    const out = await rerank("q", cands, new Map(), f.judge, base({ concurrency: 1 }));
    expect(out.results.map((r) => r.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(out.results.some((r) => r.relevance !== undefined)).toBe(false);
  });

  test("a non-JudgeError throw is treated as malformed", async () => {
    const judge: RelevanceJudge = {
      modelVersion: "m",
      questionVersion: "q",
      async judge() {
        throw new TypeError("boom");
      },
    };
    const out = await rerank("q", [cand("a.md")], new Map(), judge, base());
    expect(out.summary.fallback_reason).toBe("malformed");
  });
});

describe("rerank — concurrency", () => {
  test("never exceeds the concurrency cap, and uses it", async () => {
    const cands = Array.from({ length: 20 }, (_, i) => cand(`n${i}.md`));
    const f = fakeJudge(() => ({ relevance: 0.9, latencyMs: 5 }));
    const out = await rerank("q", cands, new Map(), f.judge, base({ concurrency: 3 }));
    expect(f.maxInFlight()).toBe(3);
    expect(out.summary.judged).toBe(20);
  });

  test("concurrency larger than the pool is fine", async () => {
    const f = fakeJudge(() => ({ relevance: 0.9, latencyMs: 1 }));
    const out = await rerank("q", [cand("a.md"), cand("b.md")], new Map(), f.judge, base({ concurrency: 50 }));
    expect(f.maxInFlight()).toBe(2);
    expect(out.results.length).toBe(2);
  });
});

describe("excerpt builder", () => {
  test("short bodies are passed through whitespace-normalised", () => {
    expect(buildBodyExcerpt("bucket", "line one\n\n  line   two")).toBe("line one line two");
  });

  test("no body yields an empty excerpt", () => {
    expect(buildBodyExcerpt("bucket", undefined)).toBe("");
    expect(buildBodyExcerpt("bucket", "")).toBe("");
    const jc = buildJudgeCandidate("q", { path: "p.md", title: "T", tags: ["x"] }, undefined);
    expect(jc).toEqual({ path: "p.md", title: "T", tags: ["x"], excerpt: "" });
  });

  test("window is at most 400 estimated tokens and centres on the first query-token match", () => {
    const filler = "lorem ipsum dolor sit amet ".repeat(400); // ~10.8k chars
    const body = `${filler}needle sentence here ${filler}`;
    const ex = buildBodyExcerpt("where is the needle", body);
    expect(estimateTokens(ex)).toBeLessThanOrEqual(400 + 2);
    expect(ex).toContain("needle sentence");
    expect(ex.startsWith("… ")).toBe(true);
    expect(ex.endsWith(" …")).toBe(true);
  });

  test("stopword-only overlap does not steer the window; falls back to body start", () => {
    const body = "start of note. " + "x ".repeat(3000) + " the end";
    const ex = buildBodyExcerpt("the of", body);
    expect(ex.startsWith("start of note.")).toBe(true);
    expect(ex.startsWith("…")).toBe(false);
  });

  test("no query match falls back to the start of the body", () => {
    const ex = buildBodyExcerpt("zzzz", "alpha beta ".repeat(1000));
    expect(ex.startsWith("alpha beta")).toBe(true);
  });

  test("a single enormous line is hard-capped", () => {
    const ex = buildBodyExcerpt("aaa", "a".repeat(5_000_000));
    expect(ex.length).toBeLessThanOrEqual(EXCERPT_HARD_CAP_CHARS);
    const big = buildBodyExcerpt("aaa", "a".repeat(100_000), 100_000);
    expect(big.length).toBeLessThanOrEqual(EXCERPT_HARD_CAP_CHARS);
  });

  test("match near the end of the body still yields a full window", () => {
    const body = "pad ".repeat(2000) + "needle";
    const ex = buildBodyExcerpt("needle", body);
    expect(ex).toContain("needle");
    expect(ex.length).toBeGreaterThan(1000);
  });
});
