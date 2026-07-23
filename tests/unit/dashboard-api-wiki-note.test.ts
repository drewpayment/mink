import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { loadWikiNote } from "../../src/core/dashboard-api";
import { ensureVaultStructure } from "../../src/core/vault";
import { reindexVault, resetWikiSearchRuntimeForTests } from "../../src/core/wiki-search";
import { _resetWikiSearchDbForTests } from "../../src/storage/wiki-search-db";

// Regression coverage for the loadWikiNote() backlinks refactor
// (dashboard-api.ts, ~line 647): backlinks used to come from re-reading
// every markdown file in the vault on every note view; they now come from
// the SQLite search index. This file asserts the response shape and the
// actual backlink set are unchanged for the cases the old O(n) file-read
// implementation handled.

let tempDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mink-dashboard-wiki-note-"));
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

function writeNote(relPath: string, content: string): void {
  const abs = join(tempDir, relPath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

describe("loadWikiNote — indexed backlinks", () => {
  test("returns frontmatter, body, and backlinks for an existing note", () => {
    writeNote(
      "inbox/target.md",
      `---
created: "2026-01-01T00:00:00.000Z"
tags: [demo]
category: inbox
---

# Target Note

Body content here.
`
    );
    writeNote(
      "inbox/source.md",
      `---
category: inbox
---

# Source Note

See [[Target Note]] for context.
`
    );
    reindexVault();

    const payload = loadWikiNote("inbox/target.md");
    expect(payload).not.toBeNull();
    expect(payload!.path).toBe("inbox/target.md");
    expect(payload!.body).toContain("Body content here.");
    expect(payload!.frontmatter.tags).toEqual(["demo"]);
    expect(payload!.backlinks).toEqual([{ path: "inbox/source.md", title: "Source Note" }]);
  });

  test("returns no backlinks for an unlinked note", () => {
    writeNote("inbox/lonely.md", "---\ncategory: inbox\n---\n\n# Lonely Note\n\nNobody links here.\n");
    reindexVault();

    const payload = loadWikiNote("inbox/lonely.md");
    expect(payload!.backlinks).toEqual([]);
  });

  test("returns null for a path outside the vault", () => {
    expect(loadWikiNote("../../etc/passwd")).toBeNull();
  });

  test("returns null for a nonexistent note", () => {
    expect(loadWikiNote("inbox/does-not-exist.md")).toBeNull();
  });

  test("picks up backlinks from notes written entirely out-of-band (mtime catch-up, no prior index)", () => {
    // Neither file has ever gone through note-writer.ts or a reindex — this
    // exercises loadWikiNote()'s own catch-up sweep starting from an empty
    // index, the same situation as an Obsidian/git-sync edit landing between
    // dashboard requests.
    writeNote("inbox/target.md", "---\ncategory: inbox\n---\n\n# Target Note\n\nbody\n");
    writeNote("inbox/new-source.md", "---\ncategory: inbox\n---\n\n# New Source\n\nSee [[Target Note]].\n");

    const payload = loadWikiNote("inbox/target.md");
    expect(payload!.backlinks).toEqual([{ path: "inbox/new-source.md", title: "New Source" }]);
  });
});
