import { describe, test, expect } from "bun:test";
import { afterEach, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { parseRecallArgs, recall } from "../../../src/commands/recall";
import { ensureVaultStructure, vaultManifestPath } from "../../../src/core/vault";
import { resetWikiSearchRuntimeForTests } from "../../../src/core/wiki-search";
import { setJudgeFactoryForTests } from "../../../src/core/recall-ranked";
import { setConfigValue } from "../../../src/core/global-config";
import { JudgeError, type RelevanceJudge } from "../../../src/core/relevance-judge";
import { _resetWikiSearchDbForTests } from "../../../src/storage/wiki-search-db";
import { useMinkFixture } from "../../helpers/mink-fixture";

// The agent template and mink-note skill invoke this as
// `mink recall --json "<query>"` — flags BEFORE the positional query — so
// arg parsing must accept flags in any position relative to the query, not
// just after it.
describe("parseRecallArgs — flag/positional ordering", () => {
  test("--json before the query (agent/skill invocation shape)", () => {
    const parsed = parseRecallArgs(["--json", "exponential backoff"]);
    expect(parsed.json).toBe(true);
    expect(parsed.query).toBe("exponential backoff");
  });

  test("--json after the query", () => {
    const parsed = parseRecallArgs(["exponential backoff", "--json"]);
    expect(parsed.json).toBe(true);
    expect(parsed.query).toBe("exponential backoff");
  });

  test("multiple flags interleaved before, between, and after the query tokens", () => {
    const parsed = parseRecallArgs([
      "--json",
      "--limit",
      "5",
      "exponential",
      "--tag",
      "infra",
      "backoff",
      "--category",
      "inbox",
    ]);
    expect(parsed.json).toBe(true);
    expect(parsed.limit).toBe(5);
    expect(parsed.tag).toBe("infra");
    expect(parsed.category).toBe("inbox");
    // Positional tokens are joined in the order they appear, wherever they
    // fall relative to the flags.
    expect(parsed.query).toBe("exponential backoff");
  });

  test("all filters recognized regardless of position", () => {
    const parsed = parseRecallArgs([
      "--project",
      "mink",
      "--since",
      "2026-01-01",
      "some query text",
    ]);
    expect(parsed.project).toBe("mink");
    expect(parsed.since).toBe("2026-01-01");
    expect(parsed.query).toBe("some query text");
  });

  test("no flags — plain positional query", () => {
    const parsed = parseRecallArgs(["plain", "query"]);
    expect(parsed.json).toBe(false);
    expect(parsed.limit).toBe(10);
    expect(parsed.query).toBe("plain query");
  });

  test("no positional args — empty query", () => {
    const parsed = parseRecallArgs(["--json"]);
    expect(parsed.query).toBe("");
  });
});

describe("parseRecallArgs — --wide", () => {
  test("defaults to false", () => {
    expect(parseRecallArgs(["q"]).wide).toBe(false);
  });

  test("recognized before, between and after the query tokens", () => {
    for (const args of [
      ["--wide", "alpha", "beta"],
      ["alpha", "--wide", "beta"],
      ["alpha", "beta", "--wide"],
    ]) {
      const parsed = parseRecallArgs(args);
      expect(parsed.wide).toBe(true);
      expect(parsed.query).toBe("alpha beta");
    }
  });

  test("combines with other flags and does not swallow the query", () => {
    const parsed = parseRecallArgs(["--json", "--wide", "--limit", "3", "--project", "p", "how do we x"]);
    expect(parsed).toMatchObject({ json: true, wide: true, limit: 3, project: "p", query: "how do we x" });
  });
});

describe("mink recall command — strict vs --wide output", () => {
  const fx = useMinkFixture("mink-recall-cmd");

  beforeEach(() => {
    resetWikiSearchRuntimeForTests();
    ensureVaultStructure();
    writeFileSync(vaultManifestPath(), "{}");
    const w = (rel: string, body: string) => {
      const abs = join(fx.current.wikiPath, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, body);
    };
    w(
      "resources/bucket.md",
      "---\ntags: []\ncategory: resources\n---\n\n# Partner bucket\n\nEach partner gets a token bucket. See [[Contract terms]].\n"
    );
    w("resources/contract.md", "---\ntags: []\ncategory: resources\n---\n\n# Contract terms\n\nLegal wording only.\n");
  });

  afterEach(() => {
    _resetWikiSearchDbForTests();
  });

  async function run(args: string[]): Promise<string> {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...a: unknown[]) => {
      lines.push(a.map(String).join(" "));
    };
    try {
      await recall("", args);
    } finally {
      console.log = original;
    }
    return lines.join("\n");
  }

  test("strict --json keeps query/results and adds the lexical retrieval object", async () => {
    const out = JSON.parse(await run(["--json", "token bucket"]));
    expect(Object.keys(out)).toEqual(["query", "results", "retrieval"]);
    expect(out.results[0].path).toBe("resources/bucket.md");
    expect(out.results[0].origin).toBeUndefined();
    expect(out.retrieval).toEqual({
      ranker: "lexical",
      candidates: out.results.length,
      judged: 0,
      empty_reason: null,
      fallback_reason: null,
      judge_model: null,
    });
  });

  test("strict --json reports lexical-empty when nothing matches", async () => {
    const out = JSON.parse(await run(["--json", "how do we throttle traffic"]));
    expect(out.results).toEqual([]);
    expect(out.retrieval).toMatchObject({ ranker: "lexical", candidates: 0, empty_reason: "lexical" });
  });

  test("--wide --json answers a natural-language question and marks origins", async () => {
    const out = JSON.parse(await run(["--wide", "--json", "How do we allocate the partner token bucket?"]));
    expect(out.results.map((r: { path: string }) => [r.path, r.origin])).toEqual([
      ["resources/bucket.md", "lexical"],
      ["resources/contract.md", "graph"],
    ]);
    expect(out.retrieval).toEqual({
      ranker: "wide",
      candidates: 2,
      judged: 0,
      empty_reason: null,
      fallback_reason: null,
      judge_model: null,
    });
  });

  test("--wide truncates to --limit but reports the pool size; neighbours only when there is room", async () => {
    const out = JSON.parse(await run(["--wide", "--json", "--limit", "1", "partner token bucket"]));
    expect(out.results.map((r: { path: string }) => r.path)).toEqual(["resources/bucket.md"]);
    expect(out.retrieval.candidates).toBe(2);
  });

  test("--wide --json with no matches is lexical-empty", async () => {
    const out = JSON.parse(await run(["--wide", "--json", "zzzzqqq"]));
    expect(out.results).toEqual([]);
    expect(out.retrieval).toMatchObject({ ranker: "wide", candidates: 0, empty_reason: "lexical" });
  });

  test("human output marks graph neighbours only in wide mode", async () => {
    const wide = await run(["--wide", "partner token bucket"]);
    expect(wide).toContain("Contract terms");
    expect(wide.match(/↳ linked from top results/g)?.length).toBe(1);
    const strict = await run(["token bucket"]);
    expect(strict).not.toContain("↳");
    expect(strict).not.toContain("resources/contract.md");
  });
});

describe("parseRecallArgs — --rerank / --no-rerank / --min-relevance", () => {
  test("rerank is unset by default, true for --rerank, false for --no-rerank (last wins)", () => {
    expect(parseRecallArgs(["q"]).rerank).toBeUndefined();
    expect(parseRecallArgs(["--rerank", "q"]).rerank).toBe(true);
    expect(parseRecallArgs(["q", "--no-rerank"]).rerank).toBe(false);
    expect(parseRecallArgs(["--rerank", "--no-rerank", "q"]).rerank).toBe(false);
    expect(parseRecallArgs(["--no-rerank", "--rerank", "q"]).rerank).toBe(true);
  });

  test("--min-relevance takes a probability and does not swallow the query", () => {
    const p = parseRecallArgs(["--min-relevance", "0.8", "the", "query"]);
    expect(p.minRelevance).toBe(0.8);
    expect(p.query).toBe("the query");
    expect(parseRecallArgs(["q"]).minRelevance).toBeUndefined();
    expect(parseRecallArgs(["--min-relevance", "7", "q"]).minRelevance).toBeUndefined();
    expect(parseRecallArgs(["--min-relevance", "abc", "q"]).minRelevance).toBeUndefined();
  });
});

describe("mink recall command — judge reranking", () => {
  const fx = useMinkFixture("mink-recall-rerank");
  const ENV = [
    "JEV_API_KEY",
    "MINK_RECALL_RERANK",
    "MINK_RECALL_RERANK_API_KEY",
    "MINK_RECALL_RERANK_BASE_URL",
    "MINK_RECALL_RERANK_MODEL",
    "MINK_RECALL_RERANK_MIN_RELEVANCE",
  ];
  const savedEnv: Record<string, string | undefined> = {};
  let judged: string[] = [];

  const scores: Record<string, number> = {
    "resources/bucket.md": 0.95,
    "meetings/agenda.md": 0.03,
    "resources/limits.md": 0.6,
  };
  const fakeJudge = (behaviour?: (path: string) => JudgeError | null): RelevanceJudge => ({
    modelVersion: "fake-model",
    questionVersion: "test/v1",
    async judge(_q, c) {
      judged.push(c.path);
      const err = behaviour?.(c.path);
      if (err) throw err;
      return { relevance: scores[c.path] ?? 0.01, inputTokens: 100, model: "fake-model" };
    },
  });

  beforeEach(() => {
    for (const k of ENV) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    judged = [];
    resetWikiSearchRuntimeForTests();
    ensureVaultStructure();
    writeFileSync(vaultManifestPath(), "{}");
    const w = (rel: string, body: string) => {
      const abs = join(fx.current.wikiPath, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, body);
    };
    w("resources/bucket.md", "---\ntags: [infra]\ncategory: resources\n---\n\n# Partner bucket\n\nPartners get a token bucket for throttling.\n");
    w("meetings/agenda.md", "---\ntags: [meeting]\ncategory: meetings\n---\n\n# Standup agenda\n\nAgenda: discuss throttling partners later.\n");
    w("resources/limits.md", "---\ntags: [infra]\ncategory: resources\n---\n\n# Partner limits\n\nPartner throttling limits per plan.\n");
  });

  afterEach(() => {
    setJudgeFactoryForTests(null);
    _resetWikiSearchDbForTests();
    for (const k of ENV) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  async function run(args: string[]): Promise<{ out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const [log, error] = [console.log, console.error];
    console.log = (...a: unknown[]) => void out.push(a.map(String).join(" "));
    console.error = (...a: unknown[]) => void err.push(a.map(String).join(" "));
    try {
      await recall("", args);
    } finally {
      console.log = log;
      console.error = error;
    }
    return { out: out.join("\n"), err: err.join("\n") };
  }

  const fake = (b?: (p: string) => JudgeError | null) => setJudgeFactoryForTests(() => fakeJudge(b));

  test("--rerank --json orders by relevance, adds relevance and the full retrieval summary", async () => {
    fake();
    const { out, err } = await run(["--rerank", "--json", "partner throttling"]);
    const json = JSON.parse(out);
    expect(err).toBe("");
    expect(Object.keys(json)).toEqual(["query", "results", "retrieval"]);
    expect(json.results.map((r: { path: string }) => r.path)).toEqual(["resources/bucket.md", "resources/limits.md"]);
    expect(json.results.map((r: { relevance: number }) => r.relevance)).toEqual([0.95, 0.6]);
    expect(json.results[0]).toMatchObject({ path: "resources/bucket.md", title: "Partner bucket" });
    expect(json.retrieval).toEqual({
      ranker: "judge",
      candidates: 3,
      judged: 3,
      empty_reason: null,
      fallback_reason: null,
      judge_model: "fake-model",
      input_tokens: 300,
    });
    expect(judged.sort()).toEqual(["meetings/agenda.md", "resources/bucket.md", "resources/limits.md"]);
  });

  test("--limit applies after reranking", async () => {
    fake();
    const json = JSON.parse((await run(["--rerank", "--json", "--limit", "1", "partner throttling"])).out);
    expect(json.results.map((r: { path: string }) => r.path)).toEqual(["resources/bucket.md"]);
    expect(json.retrieval.candidates).toBe(3);
  });

  test("human output shows relevance per hit", async () => {
    fake();
    const { out } = await run(["--rerank", "partner throttling"]);
    expect(out).toContain("2 results for");
    expect(out).toContain("relevance 0.95");
    expect(out).toContain("relevance 0.60");
    expect(out.indexOf("Partner bucket")).toBeLessThan(out.indexOf("Partner limits"));
    expect(out).not.toContain("reranking not applied");
  });

  test("filters are applied before judging: filtered-out notes never reach the judge", async () => {
    fake();
    const json = JSON.parse((await run(["--rerank", "--json", "--tag", "infra", "partner throttling"])).out);
    expect(judged).not.toContain("meetings/agenda.md");
    expect(json.results.every((r: { tags: string[] }) => r.tags.includes("infra"))).toBe(true);
    expect(json.retrieval.candidates).toBe(2);
  });

  test("judged-empty: explicit message with candidate count and threshold, exit 0", async () => {
    fake();
    const { out } = await run(["--rerank", "--min-relevance", "0.99", "partner throttling"]);
    expect(out).toBe('[mink] no relevant notes for "partner throttling" (3 candidates judged, none ≥ 0.99)');
    const json = JSON.parse((await run(["--rerank", "--json", "--min-relevance", "0.99", "partner throttling"])).out);
    expect(json.results).toEqual([]);
    expect(json.retrieval).toMatchObject({ ranker: "judge", candidates: 3, judged: 3, empty_reason: "judged" });
  });

  test("judged-empty message uses the configured threshold by default", async () => {
    fake();
    process.env.MINK_RECALL_RERANK_MIN_RELEVANCE = "0.97";
    const { out } = await run(["--rerank", "partner throttling"]);
    expect(out).toContain("none ≥ 0.97");
  });

  test("lexical-empty under --rerank is a plain no-results, and the judge is never called", async () => {
    fake();
    const json = JSON.parse((await run(["--rerank", "--json", "zzzzqqq"])).out);
    expect(judged).toEqual([]);
    expect(json.results).toEqual([]);
    expect(json.retrieval).toMatchObject({ candidates: 0, judged: 0, empty_reason: "lexical" });
    expect((await run(["--rerank", "zzzzqqq"])).out).toBe('[mink] no results for "zzzzqqq"');
  });

  test("--rerank without a key: wide ordering, no_credential, one stderr warning, no throw", async () => {
    const { out, err } = await run(["--rerank", "--json", "partner throttling"]);
    const json = JSON.parse(out);
    expect(json.retrieval).toMatchObject({ ranker: "wide", fallback_reason: "no_credential", judged: 0, judge_model: null });
    expect(json.results.length).toBeGreaterThan(0);
    expect(json.results.every((r: { relevance?: number }) => r.relevance === undefined)).toBe(true);
    expect(err.split("\n").filter(Boolean)).toHaveLength(1);
    expect(err).toContain("--rerank");
    expect(err).toContain("recall.rerank-api-key");
  });

  test("judge mode from config without a key falls back silently on stderr", async () => {
    setConfigValue("recall.rerank", "jev");
    const { out, err } = await run(["--json", "partner throttling"]);
    expect(JSON.parse(out).retrieval).toMatchObject({ ranker: "wide", fallback_reason: "no_credential" });
    expect(err).toBe("");
  });

  test("human output notes the fallback reason", async () => {
    setConfigValue("recall.rerank", "jev");
    const { out } = await run(["partner throttling"]);
    expect(out).toContain("reranking not applied (no_credential); showing lexical ordering");
    expect(out).toContain("Partner bucket");
  });

  test("config recall.rerank=jev turns judge mode on", async () => {
    setConfigValue("recall.rerank", "jev");
    fake();
    const json = JSON.parse((await run(["--json", "partner throttling"])).out);
    expect(json.retrieval.ranker).toBe("judge");
    expect(json.results[0].path).toBe("resources/bucket.md");
  });

  test("--no-rerank overrides config: lexical result, judge never built or called", async () => {
    setConfigValue("recall.rerank", "jev");
    setJudgeFactoryForTests(() => {
      throw new Error("judge must not be created");
    });
    const json = JSON.parse((await run(["--no-rerank", "--json", "token bucket"])).out);
    expect(json.retrieval.ranker).toBe("lexical");
    expect(judged).toEqual([]);
    const wide = JSON.parse((await run(["--no-rerank", "--wide", "--json", "partner throttling"])).out);
    expect(wide.retrieval.ranker).toBe("wide");
    expect(wide.results.every((r: { relevance?: number }) => r.relevance === undefined)).toBe(true);
  });

  test("with nothing configured the output is exactly the Phase 1 shape", async () => {
    setJudgeFactoryForTests(() => {
      throw new Error("judge must not be created");
    });
    const json = JSON.parse((await run(["--json", "token bucket"])).out);
    expect(json.retrieval).toEqual({
      ranker: "lexical",
      candidates: 1,
      judged: 0,
      empty_reason: null,
      fallback_reason: null,
      judge_model: null,
    });
    expect(json.results[0].relevance).toBeUndefined();
    const human = (await run(["token bucket"])).out;
    expect(human).not.toContain("relevance");
    expect(human).not.toContain("reranking");
  });

  test("auth failure: lexical fallback, exactly one actionable warning, exit 0", async () => {
    fake(() => new JudgeError("auth", "401"));
    const { out, err } = await run(["--rerank", "--json", "partner throttling"]);
    const json = JSON.parse(out);
    expect(json.retrieval).toMatchObject({ ranker: "wide", fallback_reason: "auth", judged: 0 });
    expect(err.split("\n").filter(Boolean)).toHaveLength(1);
    expect(err).toContain("rejected the API key");
    expect(json.results.length).toBe(3);
  });

  test("a network failure falls back with no stderr noise", async () => {
    fake(() => new JudgeError("network", "offline"));
    const { out, err } = await run(["--rerank", "--json", "partner throttling"]);
    expect(JSON.parse(out).retrieval).toMatchObject({ ranker: "wide", fallback_reason: "network" });
    expect(err).toBe("");
  });
});
