import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { WikiSearchRepo, type WikiSearchNoteInput } from "../../../src/repositories/wiki-search-repo";
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
