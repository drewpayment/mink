import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import {
  appendRecallUsage,
  recallUsagePath,
  summarizeRecallUsage,
  formatRecallUsageLine,
  JEV_PRICE_PER_MILLION_INPUT_TOKENS_USD,
} from "../../src/core/recall-usage";
import type { RetrievalSummary } from "../../src/core/rerank";
import { useMinkFixture } from "../helpers/mink-fixture";

const summary = (over: Partial<RetrievalSummary> = {}): RetrievalSummary => ({
  ranker: "judge",
  candidates: 10,
  judged: 10,
  empty_reason: null,
  fallback_reason: null,
  judge_model: "jev-1",
  input_tokens: 1000,
  cache_hits: 4,
  ...over,
});

describe("recall usage accounting", () => {
  useMinkFixture("mink-recall-usage");

  test("appends one JSON line with the documented fields", () => {
    appendRecallUsage(summary(), 123.4, { now: new Date("2026-09-01T00:00:00Z") });
    const lines = readFileSync(recallUsagePath(), "utf-8").trim().split("\n");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0])).toEqual({
      ts: "2026-09-01T00:00:00.000Z",
      candidates: 10,
      judged: 10,
      cache_hits: 4,
      input_tokens: 1000,
      latency_ms: 123,
      fallback_reason: null,
      judge_model: "jev-1",
    });
  });

  test("trims to the last `keep` lines once past the threshold", () => {
    for (let i = 0; i < 12; i++) appendRecallUsage(summary({ input_tokens: i }), 1, { trimThreshold: 10, keep: 5 });
    const lines = readFileSync(recallUsagePath(), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    // 11th append triggers a trim to 5; the 12th then makes 6
    expect(lines.length).toBe(6);
    expect(lines.at(-1).input_tokens).toBe(11);
    expect(lines[0].input_tokens).toBe(6);
  });

  test("never throws, even when the path is unwritable", () => {
    expect(() => appendRecallUsage(summary(), 1, { path: "/dev/null/nope/usage.jsonl" })).not.toThrow();
  });

  test("summary aggregates the last 7 days only and formats the status line", () => {
    const now = Date.parse("2026-09-10T00:00:00Z");
    const line = (ts: string, o: Record<string, unknown>) =>
      JSON.stringify({ ts, candidates: 10, judged: 10, cache_hits: 0, input_tokens: 0, latency_ms: 1, fallback_reason: null, judge_model: "m", ...o });
    writeFileSync(
      recallUsagePath(),
      [
        line("2026-08-01T00:00:00Z", { input_tokens: 9_000_000 }), // outside window
        line("2026-09-08T00:00:00Z", { cache_hits: 5, input_tokens: 2_000_000 }),
        line("2026-09-09T00:00:00Z", { cache_hits: 3, input_tokens: 2_000_000, fallback_reason: "timeout" }),
        "not json",
      ].join("\n") + "\n"
    );
    const s = summarizeRecallUsage({ now })!;
    expect(s.queries).toBe(2);
    expect(s.cacheHitRate).toBeCloseTo(8 / 20);
    expect(s.inputTokens).toBe(4_000_000);
    expect(s.fallbacks).toBe(1);
    expect(s.costUsd).toBeCloseTo(4 * JEV_PRICE_PER_MILLION_INPUT_TOKENS_USD);
    expect(formatRecallUsageLine(s)).toBe(
      "recall rerank (7d): 2 queries · 40% cache hits · 4.0M tokens ≈ $0.17 · 1 fallback"
    );
  });

  test("no usage file or no recent usage yields null (status omits the line)", () => {
    expect(existsSync(recallUsagePath())).toBe(false);
    expect(summarizeRecallUsage()).toBeNull();
    appendRecallUsage(summary(), 1, { now: new Date("2020-01-01T00:00:00Z") });
    expect(summarizeRecallUsage()).toBeNull();
  });
});
