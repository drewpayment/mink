import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { wiki } from "../../../src/commands/wiki";
import { ensureVaultStructure, vaultManifestPath } from "../../../src/core/vault";
import { resetWikiSearchRuntimeForTests } from "../../../src/core/wiki-search";
import { _resetWikiSearchDbForTests } from "../../../src/storage/wiki-search-db";

// The agent template and mink-note skill invoke these as
// `mink wiki backlinks <note> --json` / `mink wiki related <note> --json`
// (the --json flag AFTER the positional note), but nothing should assume a
// fixed position — this exercises both orderings end-to-end through the
// actual `wiki()` command dispatcher (not just the arg parser in isolation).

let tempDir: string;
let originalEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "mink-wiki-graph-cmd-"));
  originalEnv = process.env.MINK_WIKI_PATH;
  process.env.MINK_WIKI_PATH = tempDir;
  ensureVaultStructure();
  writeFileSync(vaultManifestPath(), "{}");
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

async function captureStdout(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

describe("mink wiki backlinks/related — flag/positional ordering", () => {
  beforeEach(() => {
    writeNote("inbox/target.md", "---\ntags: [infra]\ncategory: inbox\n---\n\n# Target Note\n\nbody\n");
    writeNote("inbox/source.md", "---\ntags: [infra]\ncategory: inbox\n---\n\n# Source Note\n\nSee [[Target Note]].\n");
  });

  test("backlinks: --json AFTER the note (documented invocation shape)", async () => {
    const lines = await captureStdout(() => wiki("", ["backlinks", "Target Note", "--json"]));
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.note).toBe("inbox/target.md");
    expect(parsed.backlinks).toEqual([{ path: "inbox/source.md", title: "Source Note" }]);
  });

  test("backlinks: --json BEFORE the note", async () => {
    const lines = await captureStdout(() => wiki("", ["backlinks", "--json", "Target Note"]));
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.note).toBe("inbox/target.md");
    expect(parsed.backlinks).toEqual([{ path: "inbox/source.md", title: "Source Note" }]);
  });

  test("related: --json AFTER the note (documented invocation shape)", async () => {
    const lines = await captureStdout(() => wiki("", ["related", "Target Note", "--json"]));
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.note).toBe("inbox/target.md");
    expect(parsed.related.some((r: { path: string }) => r.path === "inbox/source.md")).toBe(true);
  });

  test("related: --json BEFORE the note", async () => {
    const lines = await captureStdout(() => wiki("", ["related", "--json", "Target Note"]));
    const parsed = JSON.parse(lines.join("\n"));
    expect(parsed.note).toBe("inbox/target.md");
    expect(parsed.related.some((r: { path: string }) => r.path === "inbox/source.md")).toBe(true);
  });
});
