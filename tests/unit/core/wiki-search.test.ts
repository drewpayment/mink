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
import { _resetWikiSearchDbForTests } from "../../../src/storage/wiki-search-db";

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
});
