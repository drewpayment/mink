import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { BugMemoryRepo } from "../../../src/repositories/bug-memory-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";

let tmpRoot: string;
let cwd: string;
let projDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-bug-repo-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-bug-repo-cwd-"));
  projDir = join(tmpRoot, "projects", projectIdFor(cwd));
  mkdirSync(projDir, { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function buildEntry(overrides: Partial<{
  errorMessage: string;
  filePath: string;
  rootCause: string;
  fixDescription: string;
  tags: string[];
  lineNumber: number;
  relatedBugIds: string[];
}> = {}) {
  return {
    errorMessage: overrides.errorMessage ?? "TypeError: undefined is not a function",
    filePath: overrides.filePath ?? "src/index.ts",
    lineNumber: overrides.lineNumber,
    rootCause: overrides.rootCause ?? "import was missing",
    fixDescription: overrides.fixDescription ?? "added the import",
    tags: overrides.tags ?? ["typeerror", "import"],
    relatedBugIds: overrides.relatedBugIds ?? [],
  };
}

describe("BugMemoryRepo", () => {
  test("add round-trips through lookup", () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    const created = repo.add(buildEntry());
    const fetched = repo.lookup(created.id);
    expect(fetched?.errorMessage).toBe(created.errorMessage);
    expect(fetched?.tags.sort()).toEqual(["import", "typeerror"]);
    expect(fetched?.occurrenceCount).toBe(1);
  });

  test("add(duplicate) increments occurrence + bumps lastSeenAt", () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    const first = repo.add(buildEntry());
    const second = repo.add(buildEntry());
    expect(second.id).toBe(first.id);
    expect(second.occurrenceCount).toBe(2);
    expect(new Date(second.lastSeenAt).getTime()).toBeGreaterThanOrEqual(
      new Date(first.lastSeenAt).getTime()
    );
  });

  test("findDuplicate matches on (errorMessage, filePath)", () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    repo.add(buildEntry({ errorMessage: "ENOENT", filePath: "src/a.ts" }));
    expect(repo.findDuplicate("ENOENT", "src/a.ts")).not.toBeNull();
    expect(repo.findDuplicate("ENOENT", "src/b.ts")).toBeNull();
    expect(repo.findDuplicate("ENOTFOUND", "src/a.ts")).toBeNull();
  });

  test("lookupForFile returns matching bugs sorted by lastSeenAt desc", async () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    const first = repo.add(buildEntry({ errorMessage: "err-old", filePath: "src/a.ts" }));
    // small delay so second bug's lastSeenAt is later
    await new Promise((r) => setTimeout(r, 5));
    const second = repo.add(buildEntry({ errorMessage: "err-new", filePath: "src/a.ts" }));
    repo.add(buildEntry({ errorMessage: "elsewhere", filePath: "src/b.ts" }));

    const bugs = repo.lookupForFile("src/a.ts");
    expect(bugs.map((b) => b.id)).toEqual([second.id, first.id]);
  });

  test("hasBugForFileInSession respects the start cutoff", async () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    const sessionStart = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 5));
    repo.add(buildEntry({ filePath: "src/x.ts" }));

    expect(repo.hasBugForFileInSession("src/x.ts", sessionStart)).toBe(true);
    expect(repo.hasBugForFileInSession("src/other.ts", sessionStart)).toBe(false);

    const futureStart = new Date(Date.now() + 60_000).toISOString();
    expect(repo.hasBugForFileInSession("src/x.ts", futureStart)).toBe(false);
  });

  test("searchBugs finds matches via FTS5 on error_message", () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    const a = repo.add(buildEntry({
      errorMessage: "TypeError: Cannot read properties of undefined",
      filePath: "src/auth.ts",
      tags: ["typeerror"],
    }));
    repo.add(buildEntry({
      errorMessage: "ENOENT: no such file or directory",
      filePath: "src/fs.ts",
      tags: ["fs"],
    }));

    const hits = repo.searchBugs("undefined", { filePath: "src/auth.ts" });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.id).toBe(a.id);
    expect(hits[0].matchReasons).toContain("fts");
    expect(hits[0].matchReasons).toContain("file_path");
  });

  test("searchBugs finds matches via FTS5 on tags", () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    const a = repo.add(buildEntry({
      errorMessage: "Network call failed",
      tags: ["fetch", "timeout"],
    }));
    const hits = repo.searchBugs("timeout");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].entry.id).toBe(a.id);
  });

  test("searchBugs returns empty array for empty query", () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    repo.add(buildEntry());
    expect(repo.searchBugs("")).toEqual([]);
    expect(repo.searchBugs("   ")).toEqual([]);
  });

  test("searchBugs survives queries with FTS-significant characters", () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    repo.add(buildEntry({ errorMessage: "Cannot find module 'foo'" }));
    // Quotes + parens would crash a naive FTS5 query — buildFtsQuery
    // phrase-quotes the input to make these inputs safe.
    expect(() => repo.searchBugs("module 'foo' (NotFound)")).not.toThrow();
  });

  test("snapshot returns BugMemory shape with all entries", () => {
    const repo = new BugMemoryRepo(openProjectDb(cwd));
    repo.add(buildEntry({ errorMessage: "A", filePath: "a.ts" }));
    repo.add(buildEntry({ errorMessage: "B", filePath: "b.ts" }));
    repo.add(buildEntry({ errorMessage: "C", filePath: "c.ts" }));

    const snap = repo.snapshot();
    expect(snap.entries).toHaveLength(3);
    expect(snap.nextId).toBe(4);
  });

  test("static for(cwd) returns a working repo", () => {
    const repo = BugMemoryRepo.for(cwd);
    const bug = repo.add(buildEntry({ errorMessage: "static" }));
    expect(BugMemoryRepo.for(cwd).lookup(bug.id)?.errorMessage).toBe("static");
  });
});
