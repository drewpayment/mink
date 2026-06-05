// File-index repository tests. The repo wraps the SQLite file_index
// table — every method is one or two SQL statements, so the tests
// concentrate on edge cases (overwrites, retain semantics, stale-set
// boundary, last_scan_timestamp persistence).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { FileIndexRepo } from "../../../src/repositories/file-index-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";
import type { FileIndexEntry } from "../../../src/types/file-index";

let tmpRoot: string;
let cwd: string;
let projDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-fi-repo-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-fi-repo-cwd-"));
  projDir = join(tmpRoot, "projects", projectIdFor(cwd));
  mkdirSync(projDir, { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeEntry(filePath: string, overrides: Partial<FileIndexEntry> = {}): FileIndexEntry {
  return {
    filePath,
    description: `desc for ${filePath}`,
    estimatedTokens: 100,
    lastModified: "2026-01-01T00:00:00.000Z",
    lastIndexed: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("FileIndexRepo", () => {
  test("upsert + lookupEntry round-trips", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    repo.upsert(makeEntry("src/a.ts"), { mtimeMs: 12345, sizeBytes: 99 });
    const got = repo.lookupEntry("src/a.ts");
    expect(got?.filePath).toBe("src/a.ts");
    expect(got?.estimatedTokens).toBe(100);
  });

  test("upsert is idempotent and overwrites in place", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    repo.upsert(makeEntry("src/a.ts", { estimatedTokens: 1 }));
    repo.upsert(makeEntry("src/a.ts", { estimatedTokens: 2 }));
    repo.upsert(makeEntry("src/a.ts", { estimatedTokens: 3 }));
    expect(repo.totalFiles()).toBe(1);
    expect(repo.lookupEntry("src/a.ts")?.estimatedTokens).toBe(3);
  });

  test("lookupEntry returns null for unknown files", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    expect(repo.lookupEntry("missing.ts")).toBeNull();
  });

  test("remove deletes one entry", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    repo.upsert(makeEntry("a.ts"));
    repo.upsert(makeEntry("b.ts"));
    repo.remove("a.ts");
    expect(repo.totalFiles()).toBe(1);
    expect(repo.lookupEntry("a.ts")).toBeNull();
    expect(repo.lookupEntry("b.ts")).not.toBeNull();
  });

  test("retainOnly prunes everything not in the set", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    for (const p of ["a.ts", "b.ts", "c.ts", "d.ts"]) repo.upsert(makeEntry(p));
    const deleted = repo.retainOnly(["b.ts", "d.ts"]);
    expect(deleted).toBe(2);
    expect(repo.listAll().map((e) => e.filePath)).toEqual(["b.ts", "d.ts"]);
  });

  test("retainOnly with empty keep deletes all", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    repo.upsert(makeEntry("a.ts"));
    expect(repo.retainOnly([])).toBe(1);
    expect(repo.totalFiles()).toBe(0);
  });

  test("upsertMany commits all entries in one transaction", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    const batch = Array.from({ length: 100 }, (_, i) => ({
      entry: makeEntry(`f${i}.ts`),
      opts: { mtimeMs: i },
    }));
    repo.upsertMany(batch);
    expect(repo.totalFiles()).toBe(100);
    expect(repo.lookupEntry("f42.ts")?.filePath).toBe("f42.ts");
  });

  test("listAll returns entries sorted by file_path", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    for (const p of ["src/z.ts", "src/a.ts", "src/m.ts"]) repo.upsert(makeEntry(p));
    expect(repo.listAll().map((e) => e.filePath)).toEqual([
      "src/a.ts",
      "src/m.ts",
      "src/z.ts",
    ]);
  });

  test("staleSet returns paths whose mtime differs from the index", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    repo.upsert(makeEntry("same.ts"), { mtimeMs: 1000 });
    repo.upsert(makeEntry("changed.ts"), { mtimeMs: 1000 });
    // new.ts is not in the index — should be reported as stale (needs read).
    const stale = repo.staleSet([
      { relativePath: "same.ts",    mtimeMs: 1000 },
      { relativePath: "changed.ts", mtimeMs: 2000 },
      { relativePath: "new.ts",     mtimeMs: 3000 },
    ]);
    expect(stale.sort()).toEqual(["changed.ts", "new.ts"]);
  });

  test("checkStaleness reports missing and orphaned", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    repo.upsert(makeEntry("kept.ts"));
    repo.upsert(makeEntry("orphan.ts"));
    const report = repo.checkStaleness(["kept.ts", "added.ts"]);
    expect(report.isStale).toBe(true);
    expect(report.missingFromIndex).toEqual(["added.ts"]);
    expect(report.orphanedEntries).toEqual(["orphan.ts"]);
  });

  test("setLastScanTimestamp + getLastScanTimestamp persist via meta", () => {
    const repo = new FileIndexRepo(openProjectDb(cwd));
    expect(repo.getLastScanTimestamp()).toBe("");
    repo.setLastScanTimestamp("2026-05-24T10:00:00.000Z");
    expect(repo.getLastScanTimestamp()).toBe("2026-05-24T10:00:00.000Z");
  });

  test("static for(cwd) returns a working repo bound to project DB", () => {
    const repo = FileIndexRepo.for(cwd);
    repo.upsert(makeEntry("via/static.ts"));
    expect(FileIndexRepo.for(cwd).lookupEntry("via/static.ts")?.filePath).toBe(
      "via/static.ts"
    );
  });

  test("FileIndexRepo satisfies the IndexLookup contract by passing instance directly", () => {
    const repo = FileIndexRepo.for(cwd);
    repo.upsert(makeEntry("x.ts"));
    // Treat repo as IndexLookup — must expose lookupEntry directly.
    const lookup: { lookupEntry(p: string): FileIndexEntry | null } = repo;
    expect(lookup.lookupEntry("x.ts")?.filePath).toBe("x.ts");
    expect(lookup.lookupEntry("none.ts")).toBeNull();
  });
});
