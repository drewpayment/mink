import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { WikiSearchRepo, judgmentKeyId, buildFtsQueryAny, type WikiSearchNoteInput } from "../../../src/repositories/wiki-search-repo";
import { _resetWikiSearchDbForTests } from "../../../src/storage/wiki-search-db";

let tempDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mink-wiki-search-repo-"));
  originalEnv = process.env.MINK_WIKI_PATH;
  process.env.MINK_WIKI_PATH = tempDir;
});

afterEach(() => {
  _resetWikiSearchDbForTests();
  if (originalEnv === undefined) delete process.env.MINK_WIKI_PATH;
  else process.env.MINK_WIKI_PATH = originalEnv;
  rmSync(tempDir, { recursive: true, force: true });
});

function note(overrides: Partial<WikiSearchNoteInput> & { path: string }): WikiSearchNoteInput {
  return {
    title: "Untitled",
    category: "inbox",
    projectSlug: null,
    tags: [],
    aliases: [],
    frontmatter: {},
    body: "",
    mtimeMs: Date.now(),
    updatedAt: new Date().toISOString(),
    estimatedTokens: 10,
    ...overrides,
  };
}

describe("WikiSearchRepo", () => {
  test("upsertNote + search round-trips a body-only fact", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(
      note({
        path: "inbox/pgvector.md",
        title: "Database notes",
        body: "The retry backoff for the ingest worker is exactly 47 seconds, chosen to dodge the upstream rate limit.",
      })
    );

    const results = repo.search("47 seconds retry backoff");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("inbox/pgvector.md");
  });

  test("upsertNote is idempotent on the same path (ON CONFLICT update, not duplicate rows)", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "inbox/a.md", title: "First title", body: "alpha" }));
    repo.upsertNote(note({ path: "inbox/a.md", title: "Second title", body: "beta" }));
    expect(repo.count()).toBe(1);
    const results = repo.search("beta");
    expect(results[0].title).toBe("Second title");
  });

  test("ranking: title match outranks body-only match", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(
      note({
        path: "inbox/titled.md",
        title: "Kubernetes networking",
        body: "Some unrelated filler text about something else entirely.",
      })
    );
    repo.upsertNote(
      note({
        path: "inbox/body-only.md",
        title: "Random notes",
        body: "This note mentions kubernetes networking once in passing, buried in a much longer paragraph of filler text.",
      })
    );

    const results = repo.search("kubernetes networking");
    expect(results.length).toBe(2);
    expect(results[0].path).toBe("inbox/titled.md");
    // Regression: score direction must agree with array order. A previous
    // version computed `1/(1+abs(rank))`, which — since abs() erases bm25's
    // sign (more negative = better) — actually gave the WORSE (body-only)
    // match the HIGHER score even though the array itself (sorted by the
    // raw SQL ORDER BY) was in the right order. Any consumer sorting or
    // thresholding on `score` directly, rather than trusting array order,
    // got backwards relevance.
    expect(results[0].score).toBeGreaterThan(results[1].score);
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].score).toBeLessThan(1);
  });

  test("filters: --category restricts results", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "projects/a/note.md", title: "Widget plan", category: "projects", body: "widget rollout plan" }));
    repo.upsertNote(note({ path: "areas/note.md", title: "Widget journal", category: "areas", body: "widget rollout journal" }));

    const results = repo.search("widget", { category: "projects" });
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("projects/a/note.md");
  });

  test("filters: --tag restricts results", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "a.md", title: "A", tags: ["backend"], body: "widget" }));
    repo.upsertNote(note({ path: "b.md", title: "B", tags: ["frontend"], body: "widget" }));

    const results = repo.search("widget", { tag: "backend" });
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("a.md");
  });

  test("filters: --project restricts results by project_slug", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "projects/mink/a.md", title: "A", projectSlug: "mink", body: "widget" }));
    repo.upsertNote(note({ path: "projects/other/b.md", title: "B", projectSlug: "other", body: "widget" }));

    const results = repo.search("widget", { project: "mink" });
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("projects/mink/a.md");
  });

  test("filters: --since restricts results by updated_at", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "old.md", title: "Old", body: "widget", updatedAt: "2020-01-01T00:00:00.000Z" }));
    repo.upsertNote(note({ path: "new.md", title: "New", body: "widget", updatedAt: "2026-01-01T00:00:00.000Z" }));

    const results = repo.search("widget", { since: "2025-01-01T00:00:00.000Z" });
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("new.md");
  });

  test("limit caps the result count", () => {
    const repo = WikiSearchRepo.forVault();
    for (let i = 0; i < 5; i++) {
      repo.upsertNote(note({ path: `n${i}.md`, title: `Note ${i}`, body: "widget" }));
    }
    const results = repo.search("widget", { limit: 2 });
    expect(results.length).toBe(2);
  });

  test("search returns [] (not throwing) for empty/whitespace query", () => {
    const repo = WikiSearchRepo.forVault();
    expect(repo.search("")).toEqual([]);
    expect(repo.search("   ")).toEqual([]);
  });

  test("search returns [] for a query with no matches", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "a.md", title: "A", body: "widget" }));
    expect(repo.search("zzznonexistentzzz")).toEqual([]);
  });

  test("deleteNote removes it from search results and its own outlinks", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "a.md", title: "A", body: "widget" }));
    repo.replaceLinksForSource("a.md", [{ target: "B", resolvedPath: "b.md" }]);
    repo.deleteNote("a.md");
    expect(repo.search("widget")).toEqual([]);
    expect(repo.outlinksFor("a.md")).toEqual([]);
  });

  describe("deleteNote — no dangling citations of a removed note", () => {
    test("clears inbound resolved_path so a deleted note stops being cited as a backlink", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "alpha.md", title: "Alpha" }));
      repo.upsertNote(note({ path: "beta.md", title: "Beta" }));
      repo.replaceLinksForSource("alpha.md", [{ target: "Beta", resolvedPath: "beta.md" }]);
      expect(repo.backlinksFor("beta.md")).toEqual([{ path: "alpha.md", title: "Alpha" }]);

      repo.deleteNote("beta.md");

      expect(repo.backlinksFor("beta.md")).toEqual([]);
    });

    test("relatedFor no longer cites a deleted note as an outlink (proven repro: rm beta.md)", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "alpha.md", title: "Alpha" }));
      repo.upsertNote(note({ path: "beta.md", title: "Beta" }));
      repo.replaceLinksForSource("alpha.md", [{ target: "Beta", resolvedPath: "beta.md" }]);
      expect(repo.relatedFor("alpha.md").some((r) => r.path === "beta.md")).toBe(true);

      repo.deleteNote("beta.md");

      const related = repo.relatedFor("alpha.md");
      expect(related.some((r) => r.path === "beta.md")).toBe(false);
    });

    test("outlinksFor reports a deleted target as unresolved (path: null), not the stale path", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "alpha.md", title: "Alpha" }));
      repo.upsertNote(note({ path: "beta.md", title: "Beta" }));
      repo.replaceLinksForSource("alpha.md", [{ target: "Beta", resolvedPath: "beta.md" }]);

      repo.deleteNote("beta.md");

      const outlinks = repo.outlinksFor("alpha.md");
      expect(outlinks).toEqual([{ target: "Beta", path: null, title: null }]);
    });

    test("belt-and-suspenders: outlinksFor/relatedFor ignore a links row whose resolved_path is stale even without going through deleteNote", () => {
      // Simulates an external delete (rm on disk) caught by the mtime
      // catch-up sweep at a point where the links row itself hasn't been
      // touched yet — i.e. the JOIN-based defense in outlinksFor, not the
      // deleteNote cleanup, is what's under test here.
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "alpha.md", title: "Alpha" }));
      // Note: no upsertNote for "beta.md" — resolved_path points at a path
      // that was never (or is no longer) a real note row.
      repo.replaceLinksForSource("alpha.md", [{ target: "Beta", resolvedPath: "beta.md" }]);

      expect(repo.outlinksFor("alpha.md")).toEqual([{ target: "Beta", path: null, title: null }]);
      expect(repo.relatedFor("alpha.md").some((r) => r.path === "beta.md")).toBe(false);
    });
  });

  describe("search — prefix/partial-word fallback", () => {
    test("a stemmed prefix query on a partial word alone returns nothing from FTS (documents the actual FTS5+porter limitation)", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "auth.md", title: "Auth", body: "We rolled out two-factor authentication for all admin accounts." }));

      // This is the private FTS-only path's behavior in isolation — asserted
      // indirectly: a complete-but-different word with the same prefix
      // wouldn't help porter here, so we just document that the *only*
      // reason "authenticat" still finds something below is the substring
      // fallback, not FTS prefix matching itself.
      const results = repo.search("authenticat");
      expect(results.length).toBe(1);
      expect(results[0].path).toBe("auth.md");
      // Fallback hits are deliberately capped at/below 0.5 — below the
      // range a real FTS/bm25 match can reach (bm25ToScore approaches but
      // never hits 1).
      expect(results[0].score).toBeLessThanOrEqual(0.5);
    });

    test("falls back to a substring scan when the FTS prefix-of-stem query returns zero hits", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "a.md", title: "A", body: "Unrelated content about turbines." }));
      repo.upsertNote(note({ path: "b.md", title: "Configuration Guide", body: "See the configuration reference for details." }));

      const results = repo.search("configurat");
      expect(results.map((r) => r.path)).toEqual(["b.md"]);
    });

    test("fallback still respects filters (--category)", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "a.md", title: "A", category: "inbox", body: "authentication flow notes" }));
      repo.upsertNote(note({ path: "b.md", title: "B", category: "projects", body: "authentication flow notes" }));

      const results = repo.search("authenticat", { category: "projects" });
      expect(results.map((r) => r.path)).toEqual(["b.md"]);
    });

    test("does not fall back when the FTS query already found results", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "a.md", title: "A", body: "compression testing" }));
      repo.upsertNote(note({ path: "b.md", title: "B", body: "unrelated note about turbines, no relevant words at all" }));

      const results = repo.search("compression");
      // Only the real FTS match — the fallback must not run (and thus must
      // not add irrelevant rows) when FTS already succeeded.
      expect(results.map((r) => r.path)).toEqual(["a.md"]);
    });

    test("still returns [] when nothing matches even the fallback", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "a.md", title: "A", body: "widget" }));
      expect(repo.search("zzznonexistentzzz")).toEqual([]);
    });
  });

  test("wipeAll clears notes, fts mirror, and links", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "a.md", title: "A", body: "widget" }));
    repo.replaceLinksForSource("a.md", [{ target: "B", resolvedPath: null }]);
    repo.wipeAll();
    expect(repo.count()).toBe(0);
    expect(repo.search("widget")).toEqual([]);
    expect(repo.outlinksFor("a.md")).toEqual([]);
  });

  describe("links / graph queries", () => {
    test("backlinksFor returns notes whose links resolve to the target", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "target.md", title: "Target" }));
      repo.upsertNote(note({ path: "source-a.md", title: "Source A" }));
      repo.upsertNote(note({ path: "source-b.md", title: "Source B" }));
      repo.replaceLinksForSource("source-a.md", [{ target: "Target", resolvedPath: "target.md" }]);
      repo.replaceLinksForSource("source-b.md", [{ target: "Something else", resolvedPath: null }]);

      const backlinks = repo.backlinksFor("target.md");
      expect(backlinks).toEqual([{ path: "source-a.md", title: "Source A" }]);
    });

    test("outlinksFor returns raw target + resolved path/title", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "target.md", title: "Target" }));
      repo.upsertNote(note({ path: "source.md", title: "Source" }));
      repo.replaceLinksForSource("source.md", [
        { target: "Target", resolvedPath: "target.md" },
        { target: "Unresolved thing", resolvedPath: null },
      ]);

      const outlinks = repo.outlinksFor("source.md");
      expect(outlinks.length).toBe(2);
      const resolved = outlinks.find((o) => o.target === "Target");
      expect(resolved?.path).toBe("target.md");
      expect(resolved?.title).toBe("Target");
      const unresolved = outlinks.find((o) => o.target === "Unresolved thing");
      expect(unresolved?.path).toBeNull();
    });

    test("backfillUnresolvedLinks resolves previously-dangling links once the target note appears", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "source.md", title: "Source" }));
      repo.replaceLinksForSource("source.md", [{ target: "Future Note", resolvedPath: null }]);
      expect(repo.backlinksFor("future-note.md")).toEqual([]);

      repo.upsertNote(note({ path: "future-note.md", title: "Future Note" }));
      const n = repo.backfillUnresolvedLinks("future-note.md", "Future Note", []);
      expect(n).toBe(1);

      const backlinks = repo.backlinksFor("future-note.md");
      expect(backlinks).toEqual([{ path: "source.md", title: "Source" }]);
    });

    test("relatedFor ranks direct link edges above shared-tag-only neighbors", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "center.md", title: "Center", tags: ["a", "b"] }));
      repo.upsertNote(note({ path: "linked.md", title: "Linked", tags: [] }));
      repo.upsertNote(note({ path: "tag-only.md", title: "Tag Only", tags: ["a", "b"] }));
      repo.replaceLinksForSource("center.md", [{ target: "Linked", resolvedPath: "linked.md" }]);

      const related = repo.relatedFor("center.md");
      expect(related[0].path).toBe("linked.md");
      expect(related[0].reason).toContain("outlink");
      const tagOnly = related.find((r) => r.path === "tag-only.md");
      expect(tagOnly?.reason).toBe("shared-tags");
      expect(tagOnly?.overlap).toBe(2);
    });

    test("relatedFor merges reasons when a note is both a backlink and shares tags", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "center.md", title: "Center", tags: ["shared"] }));
      repo.upsertNote(note({ path: "other.md", title: "Other", tags: ["shared"] }));
      repo.replaceLinksForSource("other.md", [{ target: "Center", resolvedPath: "center.md" }]);

      const related = repo.relatedFor("center.md");
      expect(related.length).toBe(1);
      expect(related[0].path).toBe("other.md");
      expect(related[0].reason).toContain("backlink");
      expect(related[0].reason).toContain("shared-tags");
      expect(related[0].overlap).toBe(3); // 2 (backlink) + 1 (shared tag)
    });
  });

  describe("resolveNoteArg", () => {
    test("resolves an exact path", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "projects/mink/overview.md", title: "Overview" }));
      expect(repo.resolveNoteArg("projects/mink/overview.md")).toBe("projects/mink/overview.md");
      expect(repo.resolveNoteArg("projects/mink/overview")).toBe("projects/mink/overview.md");
    });

    test("resolves an unambiguous title, case-insensitively", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "inbox/x.md", title: "My Great Note" }));
      expect(repo.resolveNoteArg("my great note")).toBe("inbox/x.md");
    });

    test("returns null for an ambiguous title", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "a.md", title: "Dup" }));
      repo.upsertNote(note({ path: "b.md", title: "Dup" }));
      expect(repo.resolveNoteArg("Dup")).toBeNull();
    });

    test("returns null when nothing matches", () => {
      const repo = WikiSearchRepo.forVault();
      expect(repo.resolveNoteArg("nope")).toBeNull();
    });
  });
});

describe("buildFtsQueryAny", () => {
  test("drops stopwords, phrase-quotes, prefixes and OR-joins", () => {
    expect(buildFtsQueryAny("How do we throttle partner API traffic?")).toBe(
      '"throttle"* OR "partner"* OR "api"* OR "traffic"*'
    );
  });

  test("drops single-character tokens and contraction stems", () => {
    // "what's" -> "what" + "s"; a bare "s"* prefix would match nearly every note
    expect(buildFtsQueryAny("What's the deploy process? Don't guess")).toBe(
      '"deploy"* OR "process"* OR "guess"*'
    );
    expect(buildFtsQueryAny("a b c")).toBeNull();
  });

  test("returns null for empty and stopword-only queries", () => {
    expect(buildFtsQueryAny("")).toBeNull();
    expect(buildFtsQueryAny("how do we do that?")).toBeNull();
  });

  test("keeps 'not', 'api', 'find' and 'use' as significant terms", () => {
    expect(buildFtsQueryAny("not api find use")).toBe('"not"* OR "api"* OR "find"* OR "use"*');
  });

  test("escapes embedded double quotes", () => {
    expect(buildFtsQueryAny('say "hi"')).toBe('"say"* OR "hi"*');
  });
});

describe("WikiSearchRepo.searchCandidates", () => {
  const cfg = { poolSize: 40, neighbourCap: 8 };

  function seedBucketVault(repo: WikiSearchRepo) {
    repo.upsertNote(
      note({
        path: "resources/partner-bucket-allocation.md",
        title: "Partner bucket allocation",
        body: "Each partner gets a token bucket with a refill rate agreed in the contract.",
      })
    );
    repo.upsertNote(note({ path: "inbox/lunch.md", title: "Lunch", body: "We should get lunch about noon." }));
  }

  test("any-term matching finds a note that strict search misses", () => {
    const repo = WikiSearchRepo.forVault();
    seedBucketVault(repo);
    const q = "how do we allocate the partner token bucket refill rate";
    expect(repo.search(q)).toEqual([]);
    const wide = repo.searchCandidates(q, {}, cfg);
    expect(wide[0].path).toBe("resources/partner-bucket-allocation.md");
    expect(wide[0].origin).toBe("lexical");
    expect(wide[0].snippet.length).toBeGreaterThan(0);
  });

  test("a stopword-only query falls back to strict behaviour", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "inbox/a.md", title: "About it", body: "how do we do that" }));
    const q = "how do we do that";
    const strict = repo.search(q);
    expect(strict.length).toBe(1);
    const wide = repo.searchCandidates(q, {}, cfg);
    expect(wide.map((r) => r.path)).toEqual(strict.map((r) => r.path));
    expect(wide.every((r) => r.origin === "lexical")).toBe(true);
    expect(wide[0].score).toBe(strict[0].score);
  });

  test("falls back to the strict substring scan when the any-term query matches nothing", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "inbox/auth.md", title: "Auth", body: "Handles authentication tokens." }));
    const wide = repo.searchCandidates("authenticat", {}, cfg);
    expect(wide.map((r) => r.path)).toEqual(["inbox/auth.md"]);
    expect(wide[0].origin).toBe("lexical");
  });

  test("returns nothing when nothing matches", () => {
    const repo = WikiSearchRepo.forVault();
    seedBucketVault(repo);
    expect(repo.searchCandidates("zzzzqqq", {}, cfg)).toEqual([]);
  });

  test("poolSize bounds the lexical hits", () => {
    const repo = WikiSearchRepo.forVault();
    for (let i = 0; i < 6; i++) repo.upsertNote(note({ path: `inbox/n${i}.md`, title: `N${i}`, body: "widget" }));
    const wide = repo.searchCandidates("widget", {}, { poolSize: 3, neighbourCap: 8 });
    expect(wide.length).toBe(3);
  });

  test("strict search() results are unchanged by the candidate path", () => {
    const repo = WikiSearchRepo.forVault();
    repo.upsertNote(note({ path: "inbox/a.md", title: "Kubernetes networking", body: "filler" }));
    repo.upsertNote(note({ path: "inbox/b.md", title: "Random", body: "kubernetes networking in passing" }));
    const before = repo.search("kubernetes networking");
    repo.searchCandidates("kubernetes networking", {}, cfg);
    expect(repo.search("kubernetes networking")).toEqual(before);
    expect(before.every((r) => r.origin === undefined)).toBe(true);
    expect(before[0].path).toBe("inbox/a.md");
  });

  describe("graph neighbours", () => {
    function seedGraph(repo: WikiSearchRepo) {
      repo.upsertNote(note({ path: "hit.md", title: "Hit", body: "quasar" }));
      repo.upsertNote(note({ path: "out.md", title: "Out", body: "linked target" }));
      repo.upsertNote(note({ path: "back.md", title: "Back", body: "links to the hit" }));
      repo.upsertNote(note({ path: "unrelated.md", title: "Unrelated", body: "nothing" }));
      repo.replaceLinksForSource("hit.md", [{ target: "Out", resolvedPath: "out.md" }]);
      repo.replaceLinksForSource("back.md", [{ target: "Hit", resolvedPath: "hit.md" }]);
    }

    test("adds outlink and backlink neighbours with origin graph, score 0, body-prefix snippet", () => {
      const repo = WikiSearchRepo.forVault();
      seedGraph(repo);
      const wide = repo.searchCandidates("quasar", {}, cfg);
      expect(wide.map((r) => [r.path, r.origin])).toEqual([
        ["hit.md", "lexical"],
        ["back.md", "graph"],
        ["out.md", "graph"],
      ]);
      const graph = wide.filter((r) => r.origin === "graph");
      expect(graph.every((r) => r.score === 0)).toBe(true);
      expect(graph.find((r) => r.path === "out.md")!.snippet).toBe("linked target");
    });

    test("ignores unresolved outlinks", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "hit.md", title: "Hit", body: "quasar" }));
      repo.replaceLinksForSource("hit.md", [{ target: "Ghost", resolvedPath: null }]);
      expect(repo.searchCandidates("quasar", {}, cfg).map((r) => r.path)).toEqual(["hit.md"]);
    });

    test("does not duplicate notes already in the lexical pool", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "a.md", title: "A", body: "quasar" }));
      repo.upsertNote(note({ path: "b.md", title: "B", body: "quasar" }));
      repo.replaceLinksForSource("a.md", [{ target: "B", resolvedPath: "b.md" }]);
      const wide = repo.searchCandidates("quasar", {}, cfg);
      expect(wide.map((r) => r.path).sort()).toEqual(["a.md", "b.md"]);
      expect(wide.every((r) => r.origin === "lexical")).toBe(true);
    });

    test("caps neighbours and orders by seed count, then best seed rank, then path", () => {
      const repo = WikiSearchRepo.forVault();
      // s1 outranks s2 (title hit vs body hit)
      repo.upsertNote(note({ path: "s1.md", title: "quasar", body: "x" }));
      repo.upsertNote(note({ path: "s2.md", title: "S2", body: "quasar" }));
      for (const p of ["shared.md", "z-only-s1.md", "a-only-s2.md", "b-only-s2.md"]) {
        repo.upsertNote(note({ path: p, title: p, body: "neighbour body" }));
      }
      repo.replaceLinksForSource("s1.md", [
        { target: "shared", resolvedPath: "shared.md" },
        { target: "z", resolvedPath: "z-only-s1.md" },
      ]);
      repo.replaceLinksForSource("s2.md", [
        { target: "shared", resolvedPath: "shared.md" },
        { target: "a", resolvedPath: "a-only-s2.md" },
        { target: "b", resolvedPath: "b-only-s2.md" },
      ]);
      const all = repo.searchCandidates("quasar", {}, { poolSize: 10, neighbourCap: 10 });
      expect(all.filter((r) => r.origin === "graph").map((r) => r.path)).toEqual([
        "shared.md", // two seeds
        "z-only-s1.md", // best seed rank 0 beats rank 1
        "a-only-s2.md", // tie on seeds and rank: path order
        "b-only-s2.md",
      ]);
      const capped = repo.searchCandidates("quasar", {}, { poolSize: 10, neighbourCap: 2 });
      expect(capped.filter((r) => r.origin === "graph").map((r) => r.path)).toEqual(["shared.md", "z-only-s1.md"]);
      // deterministic across calls
      expect(repo.searchCandidates("quasar", {}, { poolSize: 10, neighbourCap: 2 })).toEqual(capped);
    });

    test("only the top seedCount lexical hits seed expansion", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(note({ path: "s1.md", title: "quasar", body: "x" }));
      repo.upsertNote(note({ path: "s2.md", title: "S2", body: "quasar" }));
      repo.upsertNote(note({ path: "n2.md", title: "N2", body: "y" }));
      repo.replaceLinksForSource("s2.md", [{ target: "N2", resolvedPath: "n2.md" }]);
      const one = repo.searchCandidates("quasar", {}, { poolSize: 10, neighbourCap: 8, seedCount: 1 });
      expect(one.map((r) => r.path)).toEqual(["s1.md", "s2.md"]);
      const two = repo.searchCandidates("quasar", {}, { poolSize: 10, neighbourCap: 8, seedCount: 2 });
      expect(two.map((r) => r.path)).toEqual(["s1.md", "s2.md", "n2.md"]);
    });

    test("filters apply to neighbours (project, tag, category, since)", () => {
      const repo = WikiSearchRepo.forVault();
      repo.upsertNote(
        note({ path: "projects/a/hit.md", title: "Hit", projectSlug: "a", tags: ["keep"], category: "projects", body: "quasar" })
      );
      repo.upsertNote(
        note({ path: "projects/a/same.md", title: "Same", projectSlug: "a", tags: ["keep"], category: "projects", body: "s" })
      );
      repo.upsertNote(
        note({ path: "projects/b/other.md", title: "Other", projectSlug: "b", tags: ["keep"], category: "projects", body: "o" })
      );
      repo.upsertNote(
        note({ path: "projects/a/notag.md", title: "NoTag", projectSlug: "a", tags: [], category: "projects", body: "n" })
      );
      repo.upsertNote(
        note({ path: "projects/a/old.md", title: "Old", projectSlug: "a", tags: ["keep"], category: "projects", body: "old", updatedAt: "2020-01-01T00:00:00.000Z" })
      );
      repo.replaceLinksForSource("projects/a/hit.md", [
        { target: "Same", resolvedPath: "projects/a/same.md" },
        { target: "Other", resolvedPath: "projects/b/other.md" },
        { target: "NoTag", resolvedPath: "projects/a/notag.md" },
        { target: "Old", resolvedPath: "projects/a/old.md" },
      ]);

      const paths = (o: Parameters<WikiSearchRepo["searchCandidates"]>[1]) =>
        repo.searchCandidates("quasar", o, cfg).filter((r) => r.origin === "graph").map((r) => r.path).sort();
      expect(paths({})).toEqual([
        "projects/a/notag.md", "projects/a/old.md", "projects/a/same.md", "projects/b/other.md",
      ]);
      expect(paths({ project: "a" })).not.toContain("projects/b/other.md");
      expect(paths({ tag: "keep" })).not.toContain("projects/a/notag.md");
      expect(paths({ since: "2024-01-01T00:00:00.000Z" })).not.toContain("projects/a/old.md");
      expect(paths({ category: "inbox" })).toEqual([]);
    });
  });
});

describe("judgment cache", () => {
  const key = (path: string, over: Record<string, string> = {}) => ({
    queryNorm: "q",
    path,
    reprHash: "h1",
    judgeKey: "m/v1",
    ...over,
  });

  test("put/get round trip; misses (other hash, model, query) are absent", () => {
    const repo = WikiSearchRepo.forVault();
    repo.putJudgments([
      { ...key("a.md"), relevance: 0.8 },
      { ...key("b.md"), relevance: 0.1 },
    ]);
    const got = repo.getJudgments([
      key("a.md"),
      key("b.md"),
      key("a.md", { reprHash: "h2" }),
      key("a.md", { judgeKey: "other/v1" }),
      key("a.md", { queryNorm: "other" }),
      key("missing.md"),
    ]);
    expect([...got.values()].sort()).toEqual([0.1, 0.8]);
    expect(got.get(judgmentKeyId(key("a.md")))).toBe(0.8);
    // upsert replaces
    repo.putJudgments([{ ...key("a.md"), relevance: 0.2 }]);
    expect(repo.getJudgments([key("a.md")]).get(judgmentKeyId(key("a.md")))).toBe(0.2);
  });

  test("prune drops entries older than the max age", () => {
    const repo = WikiSearchRepo.forVault();
    const now = 1_000_000_000_000;
    repo.putJudgments([
      { ...key("old.md"), relevance: 0.5, judgedAt: now - 40 * 86_400_000 },
      { ...key("new.md"), relevance: 0.5, judgedAt: now - 1000 },
    ]);
    expect(repo.pruneJudgments({ now })).toBe(1);
    expect(repo.getJudgments([key("old.md"), key("new.md")]).size).toBe(1);
  });

  test("prune enforces the row cap, keeping the newest", () => {
    const repo = WikiSearchRepo.forVault();
    const now = 1_000_000_000_000;
    repo.putJudgments(
      Array.from({ length: 10 }, (_, i) => ({ ...key(`n${i}.md`), relevance: 0.5, judgedAt: now - (10 - i) * 1000 }))
    );
    repo.pruneJudgments({ maxRows: 4, now });
    const kept = repo.getJudgments(Array.from({ length: 10 }, (_, i) => key(`n${i}.md`)));
    expect(kept.size).toBe(4);
    expect(kept.has(judgmentKeyId(key("n9.md")))).toBe(true);
    expect(kept.has(judgmentKeyId(key("n0.md")))).toBe(false);
  });

  test("a v1 database upgrades in place to v2 without losing notes", () => {
    const { openDriver } = require("../../../src/storage/driver");
    const { WIKI_SEARCH_SCHEMA_VERSION, WIKI_SEARCH_INITIAL_SCHEMA } = require("../../../src/storage/wiki-search-schema");
    const dbPath = join(tempDir, ".mink-search.db");
    const raw = openDriver(dbPath);
    // Build a genuine v1 database: current schema minus judgment_cache, stamped 1.
    raw.exec(WIKI_SEARCH_INITIAL_SCHEMA.split("-- LLM relevance judgments")[0]);
    raw.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1')").run();
    raw
      .prepare(
        "INSERT INTO notes (path, title, category, mtime_ms, updated_at) VALUES ('keep.md', 'Keep', 'inbox', 1, 'x')"
      )
      .run();
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name = 'judgment_cache'").get()).toBeUndefined();
    raw.close();

    const repo = WikiSearchRepo.forVault(); // opens + applies the schema
    repo.putJudgments([{ ...key("keep.md"), relevance: 0.7 }]);
    expect(repo.getJudgments([key("keep.md")]).size).toBe(1);
    expect(repo.getBodies(["keep.md"]).has("keep.md")).toBe(true);
    const db = require("../../../src/storage/wiki-search-db").openWikiSearchDb();
    const v = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    expect(v.value).toBe(String(WIKI_SEARCH_SCHEMA_VERSION));
    expect(WIKI_SEARCH_SCHEMA_VERSION).toBe(2);
  });
});
