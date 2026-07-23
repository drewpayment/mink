import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  indexNoteFile,
  removeNoteFromIndex,
  reindexVault,
  catchUpIndex,
  recall,
  resolveNoteArg,
  backlinksForNote,
  relatedForNote,
  resetWikiSearchRuntimeForTests,
} from "../../../src/core/wiki-search";
import { ensureVaultStructure } from "../../../src/core/vault";
import { _resetWikiSearchDbForTests, wikiSearchDbPath } from "../../../src/storage/wiki-search-db";

let tempDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mink-wiki-search-"));
  originalEnv = process.env.MINK_WIKI_PATH;
  process.env.MINK_WIKI_PATH = tempDir;
  ensureVaultStructure();
  resetWikiSearchRuntimeForTests();
});

afterEach(() => {
  _resetWikiSearchDbForTests();
  if (originalEnv === undefined) delete process.env.MINK_WIKI_PATH;
  else process.env.MINK_WIKI_PATH = originalEnv;
  rmSync(tempDir, { recursive: true, force: true });
});

function writeNote(relPath: string, content: string): string {
  const abs = join(tempDir, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

describe("wiki-search — indexing", () => {
  test("indexNoteFile makes a body-only fact findable via recall in one call", () => {
    const content = `---
created: "2026-01-01T00:00:00.000Z"
updated: "2026-01-01T00:00:00.000Z"
tags: []
category: inbox
---

# Deploy notes

The staging database password rotates automatically every 90 days via the
secrets-manager cron job.
`;
    writeNote("inbox/deploy-notes.md", content);
    indexNoteFile(join(tempDir, "inbox/deploy-notes.md"), content);

    const results = recall("secrets-manager cron job");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe("inbox/deploy-notes.md");
  });

  test("indexNoteFile reads content from disk when not passed explicitly", () => {
    const abs = writeNote(
      "inbox/x.md",
      `---
tags: []
category: inbox
---

# X

Some searchable fact about turbines.
`
    );
    indexNoteFile(abs);
    const results = recall("turbines");
    expect(results.length).toBe(1);
  });

  test("removeNoteFromIndex drops it from recall results", () => {
    const content = "---\ntags: []\ncategory: inbox\n---\n\n# Y\n\nwidget content\n";
    writeNote("inbox/y.md", content);
    indexNoteFile(join(tempDir, "inbox/y.md"), content);
    expect(recall("widget").length).toBe(1);

    removeNoteFromIndex(join(tempDir, "inbox/y.md"));
    expect(recall("widget").length).toBe(0);
  });
});

describe("wiki-search — reindexVault", () => {
  test("indexes every markdown file in the vault", () => {
    writeNote("inbox/a.md", "---\ntags: []\ncategory: inbox\n---\n\n# A\n\nalpha fact\n");
    writeNote("areas/b.md", "---\ntags: []\ncategory: areas\n---\n\n# B\n\nbeta fact\n");

    const { indexed } = reindexVault();
    expect(indexed).toBe(2);
    expect(recall("alpha").length).toBe(1);
    expect(recall("beta").length).toBe(1);
  });

  test("is idempotent — running it twice yields the same result set", () => {
    writeNote("inbox/a.md", "---\ntags: []\ncategory: inbox\n---\n\n# A\n\nalpha fact\n");
    const first = reindexVault();
    const second = reindexVault();
    expect(first.indexed).toBe(second.indexed);
    expect(recall("alpha").length).toBe(1);
  });

  test("resolves a link when the target note's title equals its own auto-added alias (regression: title+alias collision)", () => {
    // note-writer.ts adds `aliases: [<Title>]` whenever slug != title. A
    // wikilink using the exact title text must still resolve unambiguously
    // even though the resolution map sees that path under the same key from
    // both the title and the alias.
    writeNote(
      "inbox/target.md",
      `---
tags: []
category: inbox
aliases: [Retry Backoff Policy]
---

# Retry Backoff Policy

body
`
    );
    writeNote("inbox/source.md", "---\ntags: []\ncategory: inbox\n---\n\n# Source\n\nSee [[Retry Backoff Policy]].\n");

    reindexVault();
    expect(backlinksForNote("inbox/target.md")).toEqual([{ path: "inbox/source.md", title: "Source" }]);
  });

  test("resolves wikilinks across files in a second pass", () => {
    writeNote("inbox/target.md", "---\ntags: []\ncategory: inbox\n---\n\n# Target Note\n\nbody\n");
    writeNote(
      "inbox/source.md",
      "---\ntags: []\ncategory: inbox\n---\n\n# Source Note\n\nSee [[Target Note]] for details.\n"
    );

    reindexVault();
    const backlinks = backlinksForNote("inbox/target.md");
    expect(backlinks).toEqual([{ path: "inbox/source.md", title: "Source Note" }]);
  });
});

describe("wiki-search — mtime catch-up sweep", () => {
  test("picks up an out-of-band edit (no indexNoteFile call) on the next catch-up", () => {
    const abs = writeNote("inbox/a.md", "---\ntags: []\ncategory: inbox\n---\n\n# A\n\noriginal fact\n");
    indexNoteFile(abs);
    expect(recall("original").length).toBe(1);

    // Simulate an external edit (e.g. Obsidian, git pull) that never calls
    // through note-writer.ts / indexNoteFile.
    const newContent = "---\ntags: []\ncategory: inbox\n---\n\n# A\n\nexternally edited fact\n";
    writeFileSync(abs, newContent);
    // Bump mtime forward so the catch-up sweep's comparison sees a change
    // even on filesystems with coarse mtime resolution.
    const future = new Date(Date.now() + 5000);
    utimesSync(abs, future, future);

    const { updated } = catchUpIndex({ force: true });
    expect(updated).toBe(1);
    expect(recall("externally edited").length).toBe(1);
    expect(recall("original fact").length).toBe(0);
  });

  test("removes notes from the index that were deleted out-of-band", () => {
    const abs = writeNote("inbox/gone.md", "---\ntags: []\ncategory: inbox\n---\n\n# Gone\n\nephemeral fact\n");
    indexNoteFile(abs);
    expect(recall("ephemeral").length).toBe(1);

    rmSync(abs);
    const { removed } = catchUpIndex({ force: true });
    expect(removed).toBe(1);
    expect(recall("ephemeral").length).toBe(0);
  });

  test("throttles repeated calls within the window unless forced", () => {
    const abs = writeNote("inbox/a.md", "---\ntags: []\ncategory: inbox\n---\n\n# A\n\nfact one\n");
    indexNoteFile(abs);
    // Prime the throttle window with an initial (forced) sweep.
    catchUpIndex({ force: true });

    writeFileSync(abs, "---\ntags: []\ncategory: inbox\n---\n\n# A\n\nfact two\n");
    const future = new Date(Date.now() + 5000);
    utimesSync(abs, future, future);

    // Not forced, and the sweep above just ran moments ago inside this
    // test process — the throttle should skip this one.
    const result = catchUpIndex();
    expect(result).toEqual({ updated: 0, removed: 0 });
  });
});

describe("wiki-search — resolveNoteArg / graph queries", () => {
  test("resolveNoteArg resolves by path and by title", () => {
    writeNote("projects/mink/overview.md", "---\ntags: []\ncategory: projects\n---\n\n# Mink Overview\n\nbody\n");
    reindexVault();
    expect(resolveNoteArg("projects/mink/overview.md")).toBe("projects/mink/overview.md");
    expect(resolveNoteArg("Mink Overview")).toBe("projects/mink/overview.md");
    expect(resolveNoteArg("does-not-exist")).toBeNull();
  });

  test("relatedForNote surfaces shared-tag neighbors", () => {
    writeNote("a.md", "---\ntags: [infra]\ncategory: inbox\n---\n\n# A\n\nbody\n");
    writeNote("b.md", "---\ntags: [infra]\ncategory: inbox\n---\n\n# B\n\nbody\n");
    reindexVault();
    const related = relatedForNote("a.md");
    expect(related.some((r) => r.path === "b.md")).toBe(true);
  });

  test("relatedForNote no longer cites a note removed out-of-band without an explicit reindex (rm + catch-up)", () => {
    writeNote("alpha.md", "---\ntags: []\ncategory: inbox\n---\n\n# Alpha\n\nSee [[Beta]] for context.\n");
    const betaAbs = writeNote("beta.md", "---\ntags: []\ncategory: inbox\n---\n\n# Beta\n\nbody\n");
    reindexVault();
    expect(relatedForNote("alpha.md").some((r) => r.path === "beta.md")).toBe(true);

    // External delete (rm), never routed through removeNoteFromIndex —
    // only the mtime catch-up sweep (which relatedForNote/backlinksForNote
    // run automatically) will ever see this.
    rmSync(betaAbs);
    resetWikiSearchRuntimeForTests(); // clear the throttle so the sweep actually runs

    const related = relatedForNote("alpha.md");
    expect(related.some((r) => r.path === "beta.md")).toBe(false);
  });
});

describe("wiki-search — templates/ excluded, patterns/ kept (indexing scope)", () => {
  test("templates/ content is never indexed (proven repro: 'compression' matched templates/note.md)", () => {
    writeNote(
      "templates/note.md",
      "---\ntags: []\ncategory: resources\n---\n\n# {{title}}\n\nUse this template to write up compression benchmarks.\n"
    );
    writeNote("inbox/real.md", "---\ntags: []\ncategory: inbox\n---\n\n# Real Note\n\nUnrelated content.\n");

    reindexVault();
    const results = recall("compression");
    expect(results.some((r) => r.path.startsWith("templates/"))).toBe(false);
    expect(results.length).toBe(0);
  });

  test("templates/ is also excluded from the incremental write-time hook and the catch-up sweep", () => {
    const abs = writeNote(
      "templates/note.md",
      "---\ntags: []\ncategory: resources\n---\n\n# {{title}}\n\nMentions compression in boilerplate prose.\n"
    );
    indexNoteFile(abs);
    expect(recall("compression").length).toBe(0);

    resetWikiSearchRuntimeForTests();
    catchUpIndex({ force: true });
    expect(recall("compression").length).toBe(0);
  });

  test("patterns/ IS indexed — it holds real cross-project knowledge (spec 15), not boilerplate", () => {
    writeNote(
      "patterns/retry-with-backoff.md",
      "---\ntags: []\ncategory: resources\n---\n\n# Retry With Backoff\n\nA reusable pattern for exponential backoff across services.\n"
    );
    reindexVault();
    const results = recall("exponential backoff");
    expect(results.some((r) => r.path === "patterns/retry-with-backoff.md")).toBe(true);
  });
});

describe("wiki-search — --since normalization of non-ISO updated: values", () => {
  test("a hand-edited non-ISO updated: field is normalized to ISO at index time so --since still filters correctly", () => {
    // US-format date, deliberately NOT ISO-8601 — a naive lexicographic
    // string compare against an ISO --since value would misbehave (e.g.
    // "01/15/2026" sorts before any ISO date starting with "19"-"29"
    // regardless of which is actually more recent).
    writeNote(
      "inbox/obsidian-edited.md",
      '---\ntags: []\ncategory: inbox\nupdated: "01/15/2026"\n---\n\n# Obsidian Edited\n\nrecent fact about widgets\n'
    );
    reindexVault();

    // The note's real date (Jan 2026) is after this --since bound.
    const included = recall("widgets", { since: "2025-01-01T00:00:00.000Z" });
    expect(included.length).toBe(1);

    // ...and before this one.
    const excluded = recall("widgets", { since: "2027-01-01T00:00:00.000Z" });
    expect(excluded.length).toBe(0);
  });

  test("an unparseable updated: value falls back to the file's mtime instead of corrupting the sort", () => {
    const abs = writeNote(
      "inbox/garbage-date.md",
      '---\ntags: []\ncategory: inbox\nupdated: "not a date at all"\n---\n\n# Garbage Date\n\nfact about gadgets\n'
    );
    indexNoteFile(abs);
    // Doesn't throw, and is still findable/filterable using a real bound
    // derived from "now" (mtime falls back to the write time, which is now).
    const results = recall("gadgets", { since: new Date(Date.now() - 60_000).toISOString() });
    expect(results.length).toBe(1);
  });
});

describe("wiki-search — corruption recovery", () => {
  test("recall() recovers from a corrupted .mink-search.db by rebuilding once and retrying", () => {
    writeNote("inbox/a.md", "---\ntags: []\ncategory: inbox\n---\n\n# A\n\na fact about flywheels\n");
    reindexVault();
    expect(recall("flywheels").length).toBe(1);

    // Corrupt the on-disk database out from under the running process.
    _resetWikiSearchDbForTests();
    writeFileSync(wikiSearchDbPath(), "this is not a valid sqlite file");

    // Must not throw, and must recover (rebuild from the vault's markdown,
    // which is still intact on disk) rather than surface a raw SQLite error.
    const results = recall("flywheels");
    expect(results.length).toBe(1);
    expect(results[0].path).toBe("inbox/a.md");
  });

  test("reindexVault() itself recovers from a corrupted database", () => {
    writeNote("inbox/a.md", "---\ntags: []\ncategory: inbox\n---\n\n# A\n\na fact about gyroscopes\n");
    reindexVault();

    _resetWikiSearchDbForTests();
    writeFileSync(wikiSearchDbPath(), "not a database");

    const { indexed } = reindexVault();
    expect(indexed).toBe(1);
    expect(recall("gyroscopes").length).toBe(1);
  });
});
