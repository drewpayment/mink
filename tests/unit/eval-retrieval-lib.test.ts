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
  applyThreshold,
  sweepThresholds,
  recommendThreshold,
  buildArmReport,
  selectArms,
  parseArmsFlag,
  renderScorecard,
  type CaseResult,
  type Metrics,
  type SweepRow,
  type VariantOutcome,
  type RetrievalArm,
  type RetrievalCase,
} from "../../evals/retrieval-lib";
import {
  loadRetrievalCases,
  registeredArms,
  runRetrievalEval,
  parseCli,
  JUDGE_ARM_SKIP_REASON,
} from "../../evals/retrieval";
import { setJudgeFactoryForTests } from "../../src/core/recall-ranked";
import { JudgeError, type RelevanceJudge } from "../../src/core/relevance-judge";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function withEnvAsync(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
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

  test("hitPool counts an expected path anywhere in the returned pool; poolSize is the mean size", async () => {
    const deep = [...Array.from({ length: 11 }, (_, i) => `n${i}.md`), "a.md"];
    const arm = fixedArm({ "what is x?": deep, "x one": ["z.md"], "x two": [] });
    const r = await runArmOnCase(arm, kase(), 20);
    const q = computeMetrics(buildUnits([r], "question", new Set()));
    expect(q.hit10).toBe(0); // rank 12
    expect(q.hitPool).toBe(1);
    expect(q.poolSize).toBe(12);
    const avg = computeMetrics(buildUnits([r], "queries-avg", new Set()));
    expect(avg.hitPool).toBe(0);
    expect(avg.poolSize).toBe(0.5);
    // best-of: pool size is averaged over the case's variants
    expect(computeMetrics(buildUnits([r], "queries-best", new Set())).poolSize).toBe(0.5);
    // negatives do not contribute to hitPool
    const neg = await runArmOnCase(fixedArm({ q: ["a.md"] }), kase({ question: "q", queries: [], expected_paths: [] }), 5);
    expect(computeMetrics(buildUnits([neg], "question", new Set())).hitPool).toBeNull();
  });

  test("scorecard shows hit@pool and pool columns", () => {
    const md = renderScorecard({ limit: 10, caseCount: 2, arms: [buildArmReport("fixed", results(), new Set())], skipped: [] });
    expect(md).toContain("hit@pool");
    expect(md).toContain("| pool |");
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

  test("the judge arm is skipped on a default run even when a key is in the environment", () => {
    withEnv({ JEV_API_KEY: "k-1234", MINK_RECALL_RERANK_API_KEY: "k-5678" }, () => {
      const { active, skipped } = selectArms(registeredArms(), null);
      expect(active.map((a) => a.name)).toEqual(["strict", "wide"]);
      expect(skipped).toEqual([{ name: "judge", reason: JUDGE_ARM_SKIP_REASON }]);
    });
    expect(JUDGE_ARM_SKIP_REASON).toBe(
      "opt-in: pass --arms judge (needs MINK_RECALL_RERANK_API_KEY or JEV_API_KEY)"
    );
  });

  test("the judge arm needs BOTH an explicit --arms judge and a key", () => {
    withEnv({ JEV_API_KEY: undefined, MINK_RECALL_RERANK_API_KEY: undefined }, () => {
      expect(selectArms(registeredArms(), ["judge"]).skipped).toEqual([{ name: "judge", reason: JUDGE_ARM_SKIP_REASON }]);
    });
    withEnv({ JEV_API_KEY: "k-1234", MINK_RECALL_RERANK_API_KEY: undefined }, () => {
      expect(selectArms(registeredArms(), ["judge"]).active.map((a) => a.name)).toEqual(["judge"]);
      // naming other arms explicitly does not opt the judge in
      expect(selectArms(registeredArms(), ["strict", "wide"]).skipped).toEqual([]);
    });
    withEnv({ JEV_API_KEY: undefined, MINK_RECALL_RERANK_API_KEY: "k-5678" }, () => {
      expect(selectArms(registeredArms(), ["strict", "wide", "judge"]).active.map((a) => a.name)).toEqual([
        "strict",
        "wide",
        "judge",
      ]);
    });
  });

  test("arms' available() receives whether they were requested explicitly", () => {
    const seen: Array<boolean | undefined> = [];
    const probe: RetrievalArm = {
      name: "probe",
      available: (ctx) => {
        seen.push(ctx?.requested);
        return true;
      },
      run: async () => [],
    };
    selectArms([probe], null);
    selectArms([probe], ["probe"]);
    expect(seen).toEqual([false, true]);
  });
});

describe("--min-relevance flag", () => {
  test("parsed and validated", () => {
    expect(parseCli([]).minRelevance).toBeUndefined();
    expect(parseCli(["--min-relevance", "0.7"]).minRelevance).toBe(0.7);
    expect(parseCli(["--min-relevance=0.2"]).minRelevance).toBe(0.2);
    expect(() => parseCli(["--min-relevance", "2"])).toThrow(/between 0 and 1/);
    expect(() => parseCli(["--min-relevance", "x"])).toThrow(/between 0 and 1/);
  });
});

describe("fallbacks metric", () => {
  const outcome = (over: Partial<VariantOutcome> = {}): VariantOutcome => ({
    kind: "question",
    query: "q",
    ranked: ["a.md"],
    latencyMs: 1,
    rank: 1,
    adversarialRank: null,
    judgeInputTokens: null,
    ...over,
  });

  test("scoreVariant records ArmOutput fallback reason and tokens, even for an empty result", () => {
    const v = scoreVariant(kase(), "question", "q", { results: [], judgeInputTokens: 900, fallbackReason: "timeout" }, 2);
    expect(v.fallback).toBe("timeout");
    expect(v.judgeInputTokens).toBe(900);
    expect(v.ranked).toEqual([]);
    expect(scoreVariant(kase(), "question", "q", [{ path: "a.md" }], 2).fallback).toBeNull();
  });

  test("computeMetrics counts fallbacks per scope; best-of counts each variant that fell back", () => {
    const cases: CaseResult[] = [
      {
        id: "c1",
        category: "body-hit",
        isNegative: false,
        variants: [
          outcome({ fallback: "timeout" }),
          outcome({ kind: "queries", fallback: "network" }),
          outcome({ kind: "queries", fallback: null }),
        ],
      },
      { id: "c2", category: "body-hit", isNegative: false, variants: [outcome(), outcome({ kind: "queries" })] },
    ];
    const m = (scope: "question" | "queries-avg" | "queries-best") =>
      computeMetrics(buildUnits(cases, scope, new Set())).fallbacks;
    expect(m("question")).toBe(1);
    expect(m("queries-avg")).toBe(1);
    expect(m("queries-best")).toBe(1);
    const both: CaseResult[] = [{ ...cases[0], variants: cases[0].variants.map((v) => ({ ...v, fallback: "timeout" })) }];
    expect(computeMetrics(buildUnits(both, "queries-best", new Set())).fallbacks).toBe(2);
  });

  test("arms that never fall back report zero, and the scorecard has a fallbacks column", async () => {
    const arm: RetrievalArm = { name: "x", available: () => true, run: async () => [{ path: "a.md" }] };
    const cases = [await runArmOnCase(arm, kase({ queries: ["q1"] }), 10)];
    const report = { limit: 10, caseCount: 1, arms: [buildArmReport("x", cases, new Set())], skipped: [] };
    expect(report.arms[0].scopes.question.overall.fallbacks).toBe(0);
    expect(renderScorecard(report)).toContain("| fallbacks |");
  });
});

describe("judge arm end to end (fake judge, no network)", () => {
  useMinkFixture("eval-retrieval-judge");

  const fakeJudge = (fail?: JudgeError): RelevanceJudge => ({
    modelVersion: "fake",
    questionVersion: "t/v1",
    async judge(_q, c) {
      if (fail) throw fail;
      return { relevance: c.title.toLowerCase().includes("rate") ? 0.9 : 0.1, inputTokens: 50 };
    },
  });

  test("runs under the temp vault, reports tokens, and counts zero fallbacks on success", async () => {
    await withEnvAsync({ MINK_RECALL_RERANK_API_KEY: "fake-key-1234", JEV_API_KEY: undefined }, async () => {
      setJudgeFactoryForTests(() => fakeJudge());
      try {
        const report = await runRetrievalEval(parseCli(["--arms", "judge"]));
        expect(report.arms.map((a) => a.name)).toEqual(["judge"]);
        expect(report.skipped).toEqual([]);
        const overall = report.arms[0].scopes.question.overall;
        expect(overall.fallbacks).toBe(0);
        expect(overall.judgeInputTokens!).toBeGreaterThan(0);
      } finally {
        setJudgeFactoryForTests(null);
      }
    });
  });

  test("a failing judge shows up as fallbacks, not as silent judge results", async () => {
    await withEnvAsync({ MINK_RECALL_RERANK_API_KEY: "fake-key-1234", JEV_API_KEY: undefined }, async () => {
      setJudgeFactoryForTests(() => fakeJudge(new JudgeError("network", "offline")));
      try {
        const report = await runRetrievalEval(parseCli(["--arms", "judge"]));
        const overall = report.arms[0].scopes.question.overall;
        // questions with zero lexical candidates never reach the judge, so not every case falls back
        expect(overall.fallbacks).toBeGreaterThan(0);
        expect(overall.fallbacks).toBeLessThanOrEqual(loadRetrievalCases().length);
        expect(renderScorecard(report)).toContain("fallbacks");
      } finally {
        setJudgeFactoryForTests(null);
      }
    });
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

describe("strict and wide arms on the fixture vault (integration)", () => {
  useMinkFixture("eval-retrieval");

  test("produces a result for every case and variant, and cleans up", async () => {
    const cases = loadRetrievalCases();
    const report = await runRetrievalEval(parseCli([]));
    expect(report.arms.map((a) => a.name)).toEqual(["strict", "wide"]);
    const strict = report.arms[0];
    const wide = report.arms[1];
    // the wide arm returns its whole pool, not a limit-truncated list, and
    // its pool recall is at least strict's
    for (const scope of ["question", "queries-avg", "queries-best"] as const) {
      expect(wide.scopes[scope].overall.hitPool!).toBeGreaterThanOrEqual(strict.scopes[scope].overall.hitPool!);
    }
    expect(wide.scopes["question"].overall.hitPool!).toBeGreaterThan(0);
    expect(strict.cases).toHaveLength(cases.length);
    for (const c of strict.cases) {
      const src = cases.find((k) => k.id === c.id)!;
      expect(c.variants).toHaveLength(1 + (src.queries?.length ?? 0));
    }
    expect(strict.scopes["queries-best"].overall.nAdversarial).toBe(1);
    expect(strict.scopes["question"].overall.nNegative).toBeGreaterThan(0);
    expect(report.skipped.map((s) => s.name)).toEqual(["judge"]);
    // env restored to the useMinkFixture temp dirs, not left on the eval's vault
    expect(process.env.MINK_WIKI_PATH ?? "").not.toContain("mink-retrieval-eval-");
  });
});

describe("threshold sweep", () => {
  const kases: RetrievalCase[] = [
    { id: "pos", category: "c", question: "q", expected_paths: ["want.md"] },
    { id: "neg", category: "c", question: "q", expected_paths: [] },
    { id: "adv", category: "c", question: "q", expected_paths: ["want.md"], adversarial_paths: ["bad.md"] },
  ];
  const variant = (ranked: string[], relevances: number[] | undefined, k: RetrievalCase): VariantOutcome =>
    scoreVariant(k, "question", "q", {
      results: ranked.map((path, i) => ({ path, relevance: relevances?.[i] })),
    }, 1);
  const cases = (): CaseResult[] => [
    // positive: wanted note at 0.6 under a 0.8 distractor
    { id: "pos", category: "c", isNegative: false, variants: [variant(["other.md", "want.md"], [0.8, 0.6], kases[0])] },
    // negative: only weak noise
    { id: "neg", category: "c", isNegative: true, variants: [variant(["noise.md", "noise2.md"], [0.35, 0.15], kases[1])] },
    // adversarial: bad note on top at 0.7, wanted at 0.4
    { id: "adv", category: "c", isNegative: false, variants: [variant(["bad.md", "want.md"], [0.7, 0.4], kases[2])] },
  ];

  test("scoreVariant carries relevances only when every result has one", () => {
    expect(variant(["a.md"], [0.5], kases[0]).relevances).toEqual([0.5]);
    expect(variant(["a.md"], undefined, kases[0]).relevances).toBeUndefined();
  });

  test("applyThreshold filters, re-ranks and leaves relevance-less variants alone", () => {
    const t = applyThreshold(cases(), kases, 0.5);
    expect(t[0].variants[0].ranked).toEqual(["other.md", "want.md"]);
    expect(t[1].variants[0].ranked).toEqual([]);
    expect(t[2].variants[0].ranked).toEqual(["bad.md"]);
    expect(t[2].variants[0].rank).toBeNull();
    const t2 = applyThreshold(cases(), kases, 0.7);
    expect(t2[0].variants[0].rank).toBeNull();
    expect(t2[0].variants[0].ranked).toEqual(["other.md"]);
    const noRel: CaseResult[] = [{ id: "pos", category: "c", isNegative: false, variants: [variant(["x.md"], undefined, kases[0])] }];
    expect(applyThreshold(noRel, kases, 0.9)[0].variants[0].ranked).toEqual(["x.md"]);
  });

  test("sweepThresholds recomputes metrics per threshold", () => {
    const rows = sweepThresholds(cases(), kases, new Set(["adv"]), [0.1, 0.5, 0.9]);
    expect(rows.map((r) => r.threshold)).toEqual([0.1, 0.5, 0.9]);
    const q = (i: number) => rows[i].scopes.question;
    expect(q(0).abstention).toBe(0); // noise survives at 0.1
    expect(q(1).abstention).toBe(1); // dropped by 0.5
    expect(q(0).hit3).toBe(1);
    expect(q(1).hit3).toBe(0.5); // adv positive lost its wanted note (0.4)
    expect(q(1).hit1).toBe(0);
    expect(q(2).hit3).toBe(0);
    expect(q(0).adversarialPass).toBe(0); // bad.md at rank 1
    expect(q(1).adversarialPass).toBe(0); // bad.md (0.7) still rank 1 at 0.5
    expect(q(2).adversarialPass).toBe(1); // dropped at 0.9
  });

  test("recommendThreshold picks the highest threshold maximising abstention without losing hit@3", () => {
    const mk = (threshold: number, hit3: number, abstention: number): SweepRow => {
      const m = { hit3, abstention } as Metrics;
      return { threshold, scopes: { question: m, "queries-avg": m, "queries-best": m } };
    };
    const rows = [mk(0.1, 1, 0.2), mk(0.2, 1, 0.6), mk(0.3, 1, 0.6), mk(0.4, 0.9, 1), mk(0.5, 1, 0.8)];
    // 0.4 maximises abstention but loses hit@3; 0.5 (0.8) beats 0.3 (0.6)
    expect(recommendThreshold(rows).threshold).toBe(0.5);
    // ties resolve to the highest threshold
    expect(recommendThreshold([mk(0.1, 1, 0.5), mk(0.2, 1, 0.5)]).threshold).toBe(0.2);
    expect(recommendThreshold([]).threshold).toBeNull();
    // unsorted input is handled
    expect(recommendThreshold([mk(0.3, 1, 0.6), mk(0.1, 1, 0.2)]).threshold).toBe(0.3);
  });

  test("parseCli: --sweep needs the judge arm and defaults arms; rejects --min-relevance", () => {
    expect(parseCli(["--sweep"]).arms).toEqual(["strict", "wide", "judge"]);
    expect(parseCli(["--sweep", "--arms", "judge"]).sweep).toBe(true);
    expect(() => parseCli(["--sweep", "--arms", "strict"])).toThrow();
    expect(() => parseCli(["--sweep", "--min-relevance", "0.3"])).toThrow();
  });
});
