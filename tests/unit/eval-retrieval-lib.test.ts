// Unit tests for evals/retrieval-lib.ts (metric math, aggregation, arm
// selection) plus one integration test that runs the strict arm against the
// real fixture vault in an isolated temp dir. No network, no claude CLI.
import { describe, test, expect } from "bun:test";

import {
  rankOfFirst,
  hitAtK,
  reciprocalRank,
  isAbstention,
  adversarialPasses,
  percentile,
  scoreVariant,
  runArmOnCase,
  buildUnits,
  computeMetrics,
  buildArmReport,
  selectArms,
  parseArmsFlag,
  renderScorecard,
  type CaseResult,
  type RetrievalArm,
  type RetrievalCase,
} from "../../evals/retrieval-lib";
import { loadRetrievalCases, registeredArms, runRetrievalEval, parseCli } from "../../evals/retrieval";
import { useMinkFixture } from "../helpers/mink-fixture";

const kase = (over: Partial<RetrievalCase> = {}): RetrievalCase => ({
  id: "c1",
  category: "body-hit",
  question: "what is x?",
  queries: ["x one", "x two"],
  expected_paths: ["a.md", "b.md"],
  ...over,
});

const fixedArm = (map: Record<string, string[]>): RetrievalArm => ({
  name: "fixed",
  available: () => true,
  run: async (q) => (map[q] ?? []).map((path) => ({ path })),
});

describe("primitive metrics", () => {
  test("rankOfFirst is 1-based, any-of, null when absent", () => {
    expect(rankOfFirst(["x", "b.md", "a.md"], ["a.md", "b.md"])).toBe(2);
    expect(rankOfFirst(["x", "y"], ["a.md"])).toBeNull();
    expect(rankOfFirst(["a.md"], [])).toBeNull();
  });

  test("hit@k and reciprocal rank", () => {
    expect(hitAtK(1, 1)).toBe(true);
    expect(hitAtK(3, 1)).toBe(false);
    expect(hitAtK(3, 3)).toBe(true);
    expect(hitAtK(null, 10)).toBe(false);
    expect(reciprocalRank(4)).toBe(0.25);
    expect(reciprocalRank(null)).toBe(0);
  });

  test("abstention is an empty result list", () => {
    expect(isAbstention([])).toBe(true);
    expect(isAbstention(["a.md"])).toBe(false);
  });

  test("adversarial passes unless ranked first", () => {
    expect(adversarialPasses(null)).toBe(true);
    expect(adversarialPasses(2)).toBe(true);
    expect(adversarialPasses(1)).toBe(false);
  });

  test("percentile uses nearest-rank", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 50)).toBe(50);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile([3, 1, 2], 100)).toBe(3);
  });
});

describe("case scoring and aggregation", () => {
  test("scoreVariant records ranks and judge tokens", () => {
    const c = kase({ adversarial_paths: ["evil.md"] });
    const v = scoreVariant(
      c,
      "queries",
      "q",
      [
        { path: "evil.md", judgeInputTokens: 10 },
        { path: "b.md", judgeInputTokens: 5 },
      ],
      1.5
    );
    expect(v.rank).toBe(2);
    expect(v.adversarialRank).toBe(1);
    expect(v.judgeInputTokens).toBe(15);
    expect(scoreVariant(c, "question", "q", [{ path: "a.md" }], 1).judgeInputTokens).toBeNull();
  });

  test("runArmOnCase runs question plus every query and times them", async () => {
    let t = 0;
    const arm = fixedArm({ "what is x?": [], "x one": ["a.md"], "x two": ["z.md", "b.md"] });
    const r = await runArmOnCase(arm, kase(), 10, () => (t += 2));
    expect(r.variants.map((v) => v.kind)).toEqual(["question", "queries", "queries"]);
    expect(r.variants.map((v) => v.rank)).toEqual([null, 1, 2]);
    expect(r.variants[0].latencyMs).toBe(2);
    expect(r.isNegative).toBe(false);
  });

  test("negative cases are detected and scored by abstention", async () => {
    const arm = fixedArm({ q: [], n1: ["a.md"] });
    const r = await runArmOnCase(arm, kase({ question: "q", queries: ["n1"], expected_paths: [] }), 10);
    expect(r.isNegative).toBe(true);
    const units = buildUnits([r], "question", new Set());
    expect(computeMetrics(units).abstention).toBe(1);
    // per-variant average vs best-of: the one query variant did not abstain
    expect(computeMetrics(buildUnits([r], "queries-avg", new Set())).abstention).toBe(0);
    // best-of: an agent running every query sees the union, so it abstains
    // only when ALL variants abstain
    const two = await runArmOnCase(arm, kase({ question: "q", queries: ["q", "n1"], expected_paths: [] }), 10);
    expect(computeMetrics(buildUnits([two], "queries-best", new Set())).abstention).toBe(0);
    const none = await runArmOnCase(arm, kase({ question: "q", queries: ["q"], expected_paths: [] }), 10);
    expect(computeMetrics(buildUnits([none], "queries-best", new Set())).abstention).toBe(1);
    // no positives -> hit metrics are null, not 0
    expect(computeMetrics(units).hit1).toBeNull();
  });

  const results = (): CaseResult[] => [
    {
      id: "a",
      category: "body-hit",
      isNegative: false,
      variants: [
        { kind: "question", query: "q", ranked: [], latencyMs: 1, rank: null, adversarialRank: null, judgeInputTokens: null },
        { kind: "queries", query: "q1", ranked: ["x", "a.md"], latencyMs: 2, rank: 2, adversarialRank: null, judgeInputTokens: null },
        { kind: "queries", query: "q2", ranked: ["a.md"], latencyMs: 3, rank: 1, adversarialRank: null, judgeInputTokens: null },
      ],
    },
    {
      id: "b",
      category: "body-hit",
      isNegative: false,
      variants: [
        { kind: "question", query: "q", ranked: ["b.md"], latencyMs: 4, rank: 1, adversarialRank: null, judgeInputTokens: null },
        { kind: "queries", query: "q1", ranked: ["y"], latencyMs: 5, rank: null, adversarialRank: null, judgeInputTokens: null },
      ],
    },
  ];

  test("best-of-queries takes the best variant per case; avg counts every variant", () => {
    const best = computeMetrics(buildUnits(results(), "queries-best", new Set()));
    expect(best.nPositive).toBe(2);
    expect(best.hit1).toBe(0.5); // case a best rank 1, case b miss
    expect(best.mrr).toBeCloseTo(0.5);

    const avg = computeMetrics(buildUnits(results(), "queries-avg", new Set()));
    expect(avg.nPositive).toBe(3);
    expect(avg.hit1).toBeCloseTo(1 / 3);
    expect(avg.hit3).toBeCloseTo(2 / 3);
    expect(avg.mrr).toBeCloseTo((0.5 + 1 + 0) / 3);

    const q = computeMetrics(buildUnits(results(), "question", new Set()));
    expect(q.nPositive).toBe(2);
    expect(q.hit1).toBe(0.5);
  });

  test("adversarial best-scope is worst-case across variants", () => {
    const r: CaseResult[] = [
      {
        id: "adv",
        category: "adversarial",
        isNegative: false,
        variants: [
          { kind: "queries", query: "q1", ranked: ["good", "evil"], latencyMs: 1, rank: 1, adversarialRank: 2, judgeInputTokens: null },
          { kind: "queries", query: "q2", ranked: ["evil", "good"], latencyMs: 1, rank: 2, adversarialRank: 1, judgeInputTokens: null },
        ],
      },
    ];
    const adv = new Set(["adv"]);
    expect(computeMetrics(buildUnits(r, "queries-avg", adv)).adversarialPass).toBe(0.5);
    expect(computeMetrics(buildUnits(r, "queries-best", adv)).adversarialPass).toBe(0);
    expect(computeMetrics(buildUnits(r, "queries-best", adv)).nAdversarial).toBe(1);
  });

  test("latency percentiles and judge tokens roll up", () => {
    const m = computeMetrics(buildUnits(results(), "queries-avg", new Set()));
    expect(m.latencyP50Ms).toBe(3);
    expect(m.judgeInputTokens).toBeNull();
  });

  test("buildArmReport groups by category and renders a scorecard", () => {
    const report = buildArmReport("fixed", results(), new Set());
    expect(Object.keys(report.scopes["question"].byCategory)).toEqual(["body-hit"]);
    const md = renderScorecard({ limit: 10, caseCount: 2, arms: [report], skipped: [{ name: "wide", reason: "nope" }] });
    expect(md).toContain("## Summary");
    expect(md).toContain("fixed / queries-best");
    expect(md).toContain("- wide: nope");
  });
});

describe("arm selection", () => {
  const arm = (name: string, avail: boolean | string): RetrievalArm => ({
    name,
    available: () => avail,
    run: async () => [],
  });

  test("unavailable arms are skipped with a reason, not failed", () => {
    const { active, skipped } = selectArms([arm("strict", true), arm("wide", "not yet implemented")], null);
    expect(active.map((a) => a.name)).toEqual(["strict"]);
    expect(skipped).toEqual([{ name: "wide", reason: "not yet implemented" }]);
  });

  test("--arms filters, and unknown names are a harness error", () => {
    const reg = [arm("strict", true), arm("wide", false)];
    expect(selectArms(reg, ["wide"])).toEqual({ active: [], skipped: [{ name: "wide", reason: "unavailable" }] });
    expect(() => selectArms(reg, ["nope"])).toThrow(/unknown arm/);
    expect(parseArmsFlag("strict, wide,,judge")).toEqual(["strict", "wide", "judge"]);
  });

  test("registered wide/judge stubs are skipped", () => {
    const { active, skipped } = selectArms(registeredArms(), null);
    expect(active.map((a) => a.name)).toEqual(["strict"]);
    expect(skipped.map((s) => s.name)).toEqual(["wide", "judge"]);
  });
});

describe("cases.json", () => {
  test("every case has 1-3 queries and adversarial cases declare their bad note", () => {
    const cases = loadRetrievalCases();
    for (const c of cases) {
      expect(c.queries?.length ?? 0).toBeGreaterThanOrEqual(1);
      expect(c.queries!.length).toBeLessThanOrEqual(3);
    }
    expect(cases.filter((c) => c.category === "adversarial").every((c) => (c.adversarial_paths ?? []).length > 0)).toBe(true);
  });
});

describe("strict arm on the fixture vault (integration)", () => {
  useMinkFixture("eval-retrieval");

  test("produces a result for every case and variant, and cleans up", async () => {
    const cases = loadRetrievalCases();
    const report = await runRetrievalEval(parseCli([]));
    expect(report.arms.map((a) => a.name)).toEqual(["strict"]);
    const strict = report.arms[0];
    expect(strict.cases).toHaveLength(cases.length);
    for (const c of strict.cases) {
      const src = cases.find((k) => k.id === c.id)!;
      expect(c.variants).toHaveLength(1 + (src.queries?.length ?? 0));
    }
    expect(strict.scopes["queries-best"].overall.nAdversarial).toBe(1);
    expect(strict.scopes["question"].overall.nNegative).toBeGreaterThan(0);
    expect(report.skipped.map((s) => s.name)).toEqual(["wide", "judge"]);
    // env restored to the useMinkFixture temp dirs, not left on the eval's vault
    expect(process.env.MINK_WIKI_PATH ?? "").not.toContain("mink-retrieval-eval-");
  });
});
