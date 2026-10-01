// Pure logic for the retrieval-level eval (evals/retrieval.ts): metric math,
// per-case aggregation, arm selection and scorecard rendering. No side
// effects at module scope and no dependency on src/ — the CLI wires real
// arms in; tests import this directly.
//
// Vocabulary
//   arm      a retrieval strategy under test (strict / wide / judge ...)
//   variant  one query text run for one case: the natural-language
//            `question`, or one of the case's keyword `queries`
//   unit     one scored observation; what a "unit" is depends on the scope:
//              question      -> the question variant of each case
//              queries-avg   -> every keyword-query variant (per-variant
//                               average: each variant counts once)
//              queries-best  -> one per case, best-of-queries: the best rank
//                               over that case's keyword variants (an agent
//                               that retries with a better query wins). For
//                               negatives, "abstained" means EVERY variant
//                               abstained (an agent running all of them
//                               sees the union of their results); for
//                               adversarial, the case only
//                               passes if EVERY variant keeps the bad note
//                               off rank 1 (worst-case, since it's a safety
//                               check).

export interface RankedResult {
  path: string;
  score?: number;
  /** Tokens an external judge consumed to produce this ranking (per query). */
  judgeInputTokens?: number;
}

/**
 * Richer arm output: lets an arm report run-level facts that a bare result
 * list cannot carry (tokens spent on a judged-empty query, a silent fallback).
 */
export interface ArmOutput {
  results: RankedResult[];
  /** Tokens an external judge consumed for this query (even if it returned nothing). */
  judgeInputTokens?: number;
  /** Set when the arm wanted to rerank but fell back; the reason. */
  fallbackReason?: string | null;
}

export interface RetrievalArm {
  name: string;
  /**
   * true when runnable, otherwise a human-readable reason it is skipped.
   * `requested` is true when the arm was named explicitly in --arms; arms that
   * cost money use it to stay opt-in.
   */
  available(ctx?: { requested: boolean }): boolean | string;
  run(query: string, limit: number): Promise<RankedResult[] | ArmOutput>;
}

function normalizeArmOutput(out: RankedResult[] | ArmOutput): ArmOutput {
  return Array.isArray(out) ? { results: out } : out;
}

export interface RetrievalCase {
  id: string;
  category: string;
  question: string;
  queries?: string[];
  expected_paths: string[];
  adversarial_paths?: string[];
}

export type VariantKind = "question" | "queries";

export interface VariantOutcome {
  kind: VariantKind;
  query: string;
  ranked: string[];
  latencyMs: number;
  /** 1-based rank of the first expected path, null if absent. */
  rank: number | null;
  /** 1-based rank of the best-ranked adversarial note, null if absent. */
  adversarialRank: number | null;
  judgeInputTokens: number | null;
  /** Fallback reason when the arm fell back from its intended ranker, else null. */
  fallback?: string | null;
}

export interface CaseResult {
  id: string;
  category: string;
  isNegative: boolean;
  variants: VariantOutcome[];
}

export type Scope = "question" | "queries-avg" | "queries-best";
export const SCOPES: Scope[] = ["question", "queries-avg", "queries-best"];

export interface Unit {
  id: string;
  category: string;
  isNegative: boolean;
  rank: number | null;
  abstained: boolean;
  adversarialRank: number | null;
  hasAdversary: boolean;
  latenciesMs: number[];
  judgeInputTokens: number | null;
  /** Results the arm returned for this unit (mean over variants for best-of). */
  poolSize: number;
  /** Variants in this unit where the arm fell back from its intended ranker. */
  fallbacks: number;
}

export interface Metrics {
  /** Non-negative cases/units contributing to hit/MRR. */
  nPositive: number;
  hit1: number | null;
  hit3: number | null;
  hit10: number | null;
  /** Share of positives whose expected path is anywhere in the returned results. */
  hitPool: number | null;
  mrr: number | null;
  /** Mean number of results returned per unit (pool-size cost). */
  poolSize: number | null;
  nNegative: number;
  /** Share of negatives where the arm returned nothing; null if none. */
  abstention: number | null;
  nAdversarial: number;
  adversarialPass: number | null;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  judgeInputTokens: number | null;
  /** Queries where the arm fell back (e.g. judge timeout) instead of ranking as intended. */
  fallbacks: number;
}

// ---------------------------------------------------------------------------
// Primitive metric math
// ---------------------------------------------------------------------------

/** 1-based rank of the first path in `ranked` that is in `expected`. */
export function rankOfFirst(ranked: string[], expected: string[]): number | null {
  if (expected.length === 0) return null;
  const want = new Set(expected);
  for (let i = 0; i < ranked.length; i++) {
    if (want.has(ranked[i])) return i + 1;
  }
  return null;
}

export function hitAtK(rank: number | null, k: number): boolean {
  return rank !== null && rank <= k;
}

export function reciprocalRank(rank: number | null): number {
  return rank === null ? 0 : 1 / rank;
}

/** Strict-arm abstention: an empty result list. */
export function isAbstention(ranked: string[]): boolean {
  return ranked.length === 0;
}

/** Adversarial pass: the bad note is absent or not at rank 1. */
export function adversarialPasses(adversarialRank: number | null): boolean {
  return adversarialRank === null || adversarialRank > 1;
}

/** Nearest-rank percentile (p in 0..100); null for an empty sample. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

// ---------------------------------------------------------------------------
// Case scoring
// ---------------------------------------------------------------------------

export function queryVariants(kase: RetrievalCase): Array<{ kind: VariantKind; query: string }> {
  const out: Array<{ kind: VariantKind; query: string }> = [{ kind: "question", query: kase.question }];
  for (const q of kase.queries ?? []) out.push({ kind: "queries", query: q });
  return out;
}

export function scoreVariant(
  kase: RetrievalCase,
  kind: VariantKind,
  query: string,
  output: RankedResult[] | ArmOutput,
  latencyMs: number
): VariantOutcome {
  const { results, judgeInputTokens, fallbackReason } = normalizeArmOutput(output);
  const ranked = results.map((r) => r.path);
  const perResult = results.some((r) => typeof r.judgeInputTokens === "number")
    ? results.reduce((s, r) => s + (r.judgeInputTokens ?? 0), 0)
    : null;
  const tokens = typeof judgeInputTokens === "number" ? judgeInputTokens : perResult;
  return {
    kind,
    query,
    ranked,
    latencyMs,
    rank: rankOfFirst(ranked, kase.expected_paths),
    adversarialRank: rankOfFirst(ranked, kase.adversarial_paths ?? []),
    judgeInputTokens: tokens,
    fallback: fallbackReason ?? null,
  };
}

export async function runArmOnCase(
  arm: RetrievalArm,
  kase: RetrievalCase,
  limit: number,
  now: () => number = () => performance.now()
): Promise<CaseResult> {
  const variants: VariantOutcome[] = [];
  for (const v of queryVariants(kase)) {
    const t0 = now();
    const results = await arm.run(v.query, limit);
    const latencyMs = now() - t0;
    variants.push(scoreVariant(kase, v.kind, v.query, results, latencyMs));
  }
  return {
    id: kase.id,
    category: kase.category,
    isNegative: kase.expected_paths.length === 0 && (kase.adversarial_paths ?? []).length === 0,
    variants,
  };
}

export async function runArm(
  arm: RetrievalArm,
  cases: RetrievalCase[],
  limit: number,
  now?: () => number
): Promise<CaseResult[]> {
  const out: CaseResult[] = [];
  for (const c of cases) out.push(await runArmOnCase(arm, c, limit, now));
  return out;
}

function sumTokens(vs: VariantOutcome[]): number | null {
  const reported = vs.filter((v) => v.judgeInputTokens !== null);
  return reported.length === 0 ? null : reported.reduce((s, v) => s + (v.judgeInputTokens ?? 0), 0);
}

function variantToUnit(c: CaseResult, v: VariantOutcome): Unit {
  return {
    id: c.id,
    category: c.category,
    isNegative: c.isNegative,
    rank: v.rank,
    abstained: isAbstention(v.ranked),
    adversarialRank: v.adversarialRank,
    hasAdversary: false,
    latenciesMs: [v.latencyMs],
    judgeInputTokens: v.judgeInputTokens,
    poolSize: v.ranked.length,
    fallbacks: v.fallback ? 1 : 0,
  };
}

/** Builds the scored units for one scope. `hasAdversary` is filled by the
 * caller-agnostic rule: a case is adversarial iff it declared adversarial
 * paths — tracked via `adversarialCaseIds`. */
export function buildUnits(cases: CaseResult[], scope: Scope, adversarialCaseIds: Set<string>): Unit[] {
  const units: Unit[] = [];
  for (const c of cases) {
    const adv = adversarialCaseIds.has(c.id);
    const question = c.variants.filter((v) => v.kind === "question");
    const queries = c.variants.filter((v) => v.kind === "queries");
    if (scope === "question") {
      for (const v of question) units.push({ ...variantToUnit(c, v), hasAdversary: adv });
    } else if (scope === "queries-avg") {
      for (const v of queries) units.push({ ...variantToUnit(c, v), hasAdversary: adv });
    } else {
      const pool = queries.length > 0 ? queries : question;
      if (pool.length === 0) continue;
      const ranks = pool.map((v) => v.rank).filter((r): r is number => r !== null);
      const advRanks = pool.map((v) => v.adversarialRank).filter((r): r is number => r !== null);
      units.push({
        id: c.id,
        category: c.category,
        isNegative: c.isNegative,
        rank: ranks.length ? Math.min(...ranks) : null,
        abstained: pool.every((v) => isAbstention(v.ranked)),
        adversarialRank: advRanks.length ? Math.min(...advRanks) : null,
        hasAdversary: adv,
        latenciesMs: pool.map((v) => v.latencyMs),
        judgeInputTokens: sumTokens(pool),
        poolSize: mean(pool.map((v) => v.ranked.length)) ?? 0,
        fallbacks: pool.filter((v) => v.fallback).length,
      });
    }
  }
  return units;
}

export function computeMetrics(units: Unit[]): Metrics {
  const positives = units.filter((u) => !u.isNegative);
  const negatives = units.filter((u) => u.isNegative);
  const adversarial = units.filter((u) => u.hasAdversary);
  const frac = (pred: (u: Unit) => boolean, pool: Unit[]) =>
    pool.length === 0 ? null : pool.filter(pred).length / pool.length;
  const latencies = units.flatMap((u) => u.latenciesMs);
  const tokenUnits = units.filter((u) => u.judgeInputTokens !== null);
  return {
    nPositive: positives.length,
    hit1: frac((u) => hitAtK(u.rank, 1), positives),
    hit3: frac((u) => hitAtK(u.rank, 3), positives),
    hit10: frac((u) => hitAtK(u.rank, 10), positives),
    // rank is computed over everything the arm returned, so "anywhere in
    // the returned results" is exactly rank !== null. For strict this equals
    // hit@limit.
    hitPool: frac((u) => u.rank !== null, positives),
    mrr: mean(positives.map((u) => reciprocalRank(u.rank))),
    poolSize: mean(units.map((u) => u.poolSize)),
    nNegative: negatives.length,
    abstention: frac((u) => u.abstained, negatives),
    nAdversarial: adversarial.length,
    adversarialPass: frac((u) => adversarialPasses(u.adversarialRank), adversarial),
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
    judgeInputTokens: tokenUnits.length ? tokenUnits.reduce((s, u) => s + (u.judgeInputTokens ?? 0), 0) : null,
    fallbacks: units.reduce((s, u) => s + u.fallbacks, 0),
  };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

export interface ScopeReport {
  overall: Metrics;
  byCategory: Record<string, Metrics>;
}

export interface ArmReport {
  name: string;
  scopes: Record<Scope, ScopeReport>;
  cases: CaseResult[];
}

export interface SkippedArm {
  name: string;
  reason: string;
}

export interface RetrievalReport {
  limit: number;
  caseCount: number;
  arms: ArmReport[];
  skipped: SkippedArm[];
}

export function buildArmReport(name: string, cases: CaseResult[], adversarialCaseIds: Set<string>): ArmReport {
  const scopes = {} as Record<Scope, ScopeReport>;
  for (const scope of SCOPES) {
    const units = buildUnits(cases, scope, adversarialCaseIds);
    const cats = [...new Set(units.map((u) => u.category))];
    const byCategory: Record<string, Metrics> = {};
    for (const cat of cats) byCategory[cat] = computeMetrics(units.filter((u) => u.category === cat));
    scopes[scope] = { overall: computeMetrics(units), byCategory };
  }
  return { name, scopes, cases };
}

// ---------------------------------------------------------------------------
// Arm selection
// ---------------------------------------------------------------------------

/**
 * Resolves which registered arms to run. `requested` null = all registered.
 * Arms whose available() is not `true` are reported as skipped (never
 * failed). Unknown requested names throw — that's a harness/usage error.
 */
export function selectArms(
  registered: RetrievalArm[],
  requested: string[] | null
): { active: RetrievalArm[]; skipped: SkippedArm[] } {
  let chosen = registered;
  if (requested !== null) {
    const byName = new Map(registered.map((a) => [a.name, a]));
    chosen = requested.map((n) => {
      const arm = byName.get(n);
      if (!arm) throw new Error(`unknown arm "${n}" (registered: ${registered.map((a) => a.name).join(", ")})`);
      return arm;
    });
  }
  const active: RetrievalArm[] = [];
  const skipped: SkippedArm[] = [];
  for (const arm of chosen) {
    const avail = arm.available({ requested: requested !== null && requested.includes(arm.name) });
    if (avail === true) active.push(arm);
    else skipped.push({ name: arm.name, reason: avail === false ? "unavailable" : avail });
  }
  return { active, skipped };
}

export function parseArmsFlag(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

const pct = (x: number | null) => (x === null ? "-" : `${(x * 100).toFixed(0)}%`);
const num = (x: number | null, d = 3) => (x === null ? "-" : x.toFixed(d));
const ms = (x: number | null) => (x === null ? "-" : x.toFixed(1));

function table(header: string[], rows: string[][]): string {
  const lines = [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`];
  for (const r of rows) lines.push(`| ${r.join(" | ")} |`);
  return lines.join("\n");
}

function metricRow(label: string, m: Metrics): string[] {
  return [
    label,
    String(m.nPositive),
    pct(m.hit1),
    pct(m.hit3),
    pct(m.hit10),
    pct(m.hitPool),
    num(m.mrr),
    m.nNegative ? `${pct(m.abstention)} (n=${m.nNegative})` : "-",
    m.nAdversarial ? `${pct(m.adversarialPass)} (n=${m.nAdversarial})` : "-",
    m.poolSize === null ? "-" : m.poolSize.toFixed(1),
    ms(m.latencyP50Ms),
    ms(m.latencyP95Ms),
    m.judgeInputTokens === null ? "-" : String(m.judgeInputTokens),
    String(m.fallbacks),
  ];
}

const METRIC_HEADER = [
  "n",
  "hit@1",
  "hit@3",
  "hit@10",
  "hit@pool",
  "MRR",
  "abstain",
  "adv-pass",
  "pool",
  "p50 ms",
  "p95 ms",
  "judge tok",
  "fallbacks",
];

export function renderSummary(report: RetrievalReport): string {
  const out: string[] = [];
  out.push(`## Summary (limit=${report.limit}, cases=${report.caseCount})`, "");
  const rows: string[][] = [];
  for (const arm of report.arms) {
    for (const scope of SCOPES) rows.push(metricRow(`${arm.name} / ${scope}`, arm.scopes[scope].overall));
  }
  out.push(table(["arm / scope", ...METRIC_HEADER], rows));
  if (report.skipped.length) {
    out.push("", "Skipped arms:");
    for (const s of report.skipped) out.push(`- ${s.name}: ${s.reason}`);
  }
  return out.join("\n");
}

export function renderCategories(report: RetrievalReport): string {
  const out: string[] = ["## Per category", ""];
  for (const arm of report.arms) {
    for (const scope of SCOPES) {
      out.push(`### ${arm.name} / ${scope}`, "");
      const cats = Object.keys(arm.scopes[scope].byCategory).sort();
      out.push(
        table(
          ["category", ...METRIC_HEADER],
          cats.map((c) => metricRow(c, arm.scopes[scope].byCategory[c]))
        ),
        ""
      );
    }
  }
  return out.join("\n");
}

function rankCell(v: VariantOutcome | undefined, isNegative: boolean): string {
  if (!v) return "-";
  if (isNegative) return v.ranked.length === 0 ? "abstain" : `${v.ranked.length} results`;
  return v.rank === null ? "miss" : String(v.rank);
}

export function renderCaseDetail(report: RetrievalReport, verbose = false): string {
  const out: string[] = ["## Per case", ""];
  for (const arm of report.arms) {
    out.push(`### ${arm.name}`, "");
    const rows = arm.cases.map((c) => {
      const q = c.variants.find((v) => v.kind === "question");
      const qs = c.variants.filter((v) => v.kind === "queries");
      const adv = c.variants.map((v) => v.adversarialRank).filter((r): r is number => r !== null);
      return [
        c.id,
        c.category,
        rankCell(q, c.isNegative),
        qs.map((v) => rankCell(v, c.isNegative)).join(", ") || "-",
        adv.length ? String(Math.min(...adv)) : "-",
      ];
    });
    out.push(table(["case", "category", "question rank", "queries rank(s)", "adversarial rank"], rows), "");
    if (verbose) {
      out.push("Top 5 per query:", "");
      for (const c of arm.cases) {
        for (const v of c.variants) {
          out.push(`- ${c.id} [${v.kind}] "${v.query}"`);
          for (const p of v.ranked.slice(0, 5)) out.push(`    - ${p}`);
          if (v.ranked.length === 0) out.push("    - (no results)");
        }
      }
      out.push("");
    }
  }
  return out.join("\n");
}

export function renderScorecard(report: RetrievalReport, verbose = false): string {
  return [
    "# Retrieval eval scorecard",
    "",
    "hit@k / MRR are over non-negative cases; hit@pool = expected note anywhere in what the arm returned;",
    "pool = mean results returned per query; abstain is over negative cases (empty result = abstained);",
    "adv-pass = adversarial note not at rank 1. Scopes: `question` = natural-language question;",
    "`queries-avg` = per-variant average over keyword queries; `queries-best` = best-of-queries per case.",
    "",
    renderSummary(report),
    "",
    renderCategories(report),
    renderCaseDetail(report, verbose),
  ].join("\n");
}
