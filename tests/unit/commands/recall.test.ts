import { describe, test, expect } from "bun:test";
import { afterEach, beforeEach } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { parseRecallArgs, recall } from "../../../src/commands/recall";
import { ensureVaultStructure, vaultManifestPath } from "../../../src/core/vault";
import { resetWikiSearchRuntimeForTests } from "../../../src/core/wiki-search";
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
