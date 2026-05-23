// Tests for the JSON → SQLite importer. The importer is exercised inside
// openProjectDb() in production; here we drive it directly with a temp
// MINK_ROOT_OVERRIDE so each test gets a clean filesystem.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  openProjectDb,
  projectDbPath,
  _resetDbCacheForTests,
} from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";
import { readMeta } from "../../../src/storage/schema";

let tmpRoot: string;
let cwd: string;
let projDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-migrate-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  // Use a stable, repo-shaped cwd so projectIdFor is deterministic across
  // tests in the same file run.
  cwd = mkdtempSync(join(tmpdir(), "mink-migrate-cwd-"));
  const id = projectIdFor(cwd);
  projDir = join(tmpRoot, "projects", id);
  mkdirSync(projDir, { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    rmSync(cwd, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

describe("migrate-json", () => {
  test("new project (no JSON sources) marks migrated without erroring", () => {
    const db = openProjectDb(cwd);
    expect(readMeta(db, "migrated_from_json_at")).not.toBeNull();
    expect(existsSync(projectDbPath(cwd))).toBe(true);
  });

  test("re-opening is a no-op (idempotent)", () => {
    openProjectDb(cwd);
    const first = readMeta(openProjectDb(cwd), "migrated_from_json_at");
    _resetDbCacheForTests();
    const db = openProjectDb(cwd);
    expect(readMeta(db, "migrated_from_json_at")).toBe(first);
  });

  test("legacy root JSONs are imported and moved to legacy-backup/", () => {
    writeJson(join(projDir, "file-index.json"), {
      header: { lastScanTimestamp: "2026-01-01T00:00:00.000Z", totalFiles: 1 },
      entries: {
        "src/a.ts": {
          filePath: "src/a.ts",
          description: "module a",
          estimatedTokens: 42,
          lastModified: "2026-01-01T00:00:00.000Z",
          lastIndexed: "2026-01-01T00:00:00.000Z",
        },
      },
    });
    writeJson(join(projDir, "bug-memory.json"), {
      entries: [
        {
          id: "bug-001",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-02T00:00:00.000Z",
          errorMessage: "TypeError: undefined is not a function",
          filePath: "src/a.ts",
          rootCause: "missing import",
          fixDescription: "added import",
          tags: ["typeerror", "import"],
          occurrenceCount: 2,
          relatedBugIds: [],
        },
      ],
      nextId: 2,
    });
    writeJson(join(projDir, "token-ledger.json"), {
      lifetime: {
        totalTokens: 1000,
        totalReads: 5,
        totalWrites: 2,
        totalSessions: 1,
        totalFileIndexHits: 3,
        totalFileIndexMisses: 4,
        totalRepeatedReads: 1,
        totalEstimatedSavings: 100,
      },
      sessions: [
        {
          sessionId: "sess-1",
          startTimestamp: "2026-01-01T00:00:00.000Z",
          endTimestamp: "2026-01-01T01:00:00.000Z",
          reads: [{ filePath: "src/a.ts", estimatedTokens: 42, readCount: 1 }],
          writes: [{ filePath: "src/b.ts", estimatedTokens: 99, action: "edit" }],
          totals: {
            readCount: 1,
            writeCount: 1,
            estimatedTokens: 141,
            repeatedReads: 0,
            fileIndexHits: 1,
            fileIndexMisses: 0,
          },
          estimatedSavings: 0,
        },
      ],
    });

    const db = openProjectDb(cwd);

    // file_index
    const fi = db.prepare("SELECT * FROM file_index").all() as Array<Record<string, unknown>>;
    expect(fi).toHaveLength(1);
    expect(fi[0].file_path).toBe("src/a.ts");
    expect(fi[0].estimated_tokens).toBe(42);
    expect(fi[0].device_id).toBe("legacy");

    // bug_memory + tags
    const bugs = db.prepare("SELECT id, occurrence_count FROM bug_memory").all();
    expect(bugs).toEqual([{ id: "bug-001", occurrence_count: 2 }]);
    const tags = db
      .prepare("SELECT tag FROM bug_tags ORDER BY tag")
      .all()
      .map((r) => (r as { tag: string }).tag);
    expect(tags).toEqual(["import", "typeerror"]);

    // ledger_sessions
    const sess = db.prepare("SELECT session_id, archived FROM ledger_sessions").all();
    expect(sess).toEqual([{ session_id: "sess-1", archived: 0 }]);

    // ledger_lifetime per device
    const lifetime = db
      .prepare("SELECT device_id, total_tokens FROM ledger_lifetime")
      .all();
    expect(lifetime).toEqual([{ device_id: "legacy", total_tokens: 1000 }]);

    // Sources moved to legacy-backup/legacy/
    const backupDir = join(projDir, "legacy-backup", "legacy");
    expect(existsSync(join(backupDir, "file-index.json"))).toBe(true);
    expect(existsSync(join(backupDir, "bug-memory.json"))).toBe(true);
    expect(existsSync(join(backupDir, "token-ledger.json"))).toBe(true);
    expect(existsSync(join(projDir, "file-index.json"))).toBe(false);
  });

  test("device shards preserve device_id attribution", () => {
    const devA = "device-aaa";
    const devB = "device-bbb";
    writeJson(join(projDir, "state", devA, "bug-memory.json"), {
      entries: [
        {
          id: "bug-from-a",
          createdAt: "2026-01-01T00:00:00.000Z",
          lastSeenAt: "2026-01-01T00:00:00.000Z",
          errorMessage: "ENOENT",
          filePath: "src/a.ts",
          rootCause: "x",
          fixDescription: "y",
          tags: ["fs"],
          occurrenceCount: 1,
          relatedBugIds: [],
        },
      ],
      nextId: 2,
    });
    writeJson(join(projDir, "state", devB, "token-ledger.json"), {
      lifetime: {
        totalTokens: 500,
        totalReads: 1,
        totalWrites: 0,
        totalSessions: 1,
        totalFileIndexHits: 0,
        totalFileIndexMisses: 1,
        totalRepeatedReads: 0,
        totalEstimatedSavings: 0,
      },
      sessions: [
        {
          sessionId: "sess-b1",
          startTimestamp: "2026-01-02T00:00:00.000Z",
          endTimestamp: "2026-01-02T01:00:00.000Z",
          reads: [],
          writes: [],
          totals: {
            readCount: 1,
            writeCount: 0,
            estimatedTokens: 500,
            repeatedReads: 0,
            fileIndexHits: 0,
            fileIndexMisses: 1,
          },
          estimatedSavings: 0,
        },
      ],
    });

    const db = openProjectDb(cwd);
    const bug = db.prepare("SELECT device_id FROM bug_memory WHERE id = ?").get("bug-from-a");
    expect(bug).toEqual({ device_id: devA });
    const sess = db
      .prepare("SELECT device_id FROM ledger_sessions WHERE session_id = ?")
      .get("sess-b1");
    expect(sess).toEqual({ device_id: devB });
    const lifetime = db
      .prepare("SELECT device_id, total_tokens FROM ledger_lifetime")
      .all();
    expect(lifetime).toEqual([{ device_id: devB, total_tokens: 500 }]);
  });

  test("overlapping bug in shard + legacy merges occurrence_count and lastSeenAt", () => {
    const dev = "device-x";
    writeJson(join(projDir, "state", dev, "bug-memory.json"), {
      entries: [
        {
          id: "bug-shared",
          createdAt: "2026-01-05T00:00:00.000Z",
          lastSeenAt: "2026-01-05T00:00:00.000Z",
          errorMessage: "err",
          filePath: "src/a.ts",
          rootCause: "rc",
          fixDescription: "fd",
          tags: ["a"],
          occurrenceCount: 3,
          relatedBugIds: [],
        },
      ],
      nextId: 2,
    });
    writeJson(join(projDir, "bug-memory.json"), {
      entries: [
        {
          id: "bug-shared",
          createdAt: "2026-01-01T00:00:00.000Z", // older — wins on createdAt
          lastSeenAt: "2026-01-10T00:00:00.000Z", // newer — wins on lastSeen
          errorMessage: "err",
          filePath: "src/a.ts",
          rootCause: "rc",
          fixDescription: "fd",
          tags: ["b"], // unioned
          occurrenceCount: 1, // smaller — loses
          relatedBugIds: [],
        },
      ],
      nextId: 2,
    });

    const db = openProjectDb(cwd);
    const bug = db
      .prepare(
        "SELECT created_at, last_seen_at, occurrence_count FROM bug_memory WHERE id = ?"
      )
      .get("bug-shared");
    expect(bug).toEqual({
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: "2026-01-10T00:00:00.000Z",
      occurrence_count: 3,
    });
    const tags = db
      .prepare("SELECT tag FROM bug_tags WHERE bug_id = ? ORDER BY tag")
      .all("bug-shared")
      .map((r) => (r as { tag: string }).tag);
    expect(tags).toEqual(["a", "b"]);
  });

  test("token-ledger-archive sessions are imported with archived=1", () => {
    writeJson(join(projDir, "token-ledger-archive.json"), [
      {
        sessionId: "old-1",
        startTimestamp: "2025-01-01T00:00:00.000Z",
        endTimestamp: "2025-01-01T01:00:00.000Z",
        reads: [],
        writes: [],
        totals: {
          readCount: 0,
          writeCount: 0,
          estimatedTokens: 0,
          repeatedReads: 0,
          fileIndexHits: 0,
          fileIndexMisses: 0,
        },
        estimatedSavings: 0,
      },
    ]);

    const db = openProjectDb(cwd);
    const row = db
      .prepare("SELECT archived FROM ledger_sessions WHERE session_id = ?")
      .get("old-1");
    expect(row).toEqual({ archived: 1 });
  });

  test(".mink-state-counters.json populates the counters table", () => {
    writeJson(join(projDir, ".mink-state-counters.json"), {
      "device-aaa": { hits: 10, misses: 3 },
      "device-bbb": { hits: 0, misses: 7 },
    });
    const db = openProjectDb(cwd);
    const rows = db
      .prepare("SELECT device_id, file_index_hits, file_index_misses FROM counters ORDER BY device_id")
      .all();
    expect(rows).toEqual([
      { device_id: "device-aaa", file_index_hits: 10, file_index_misses: 3 },
      { device_id: "device-bbb", file_index_hits: 0, file_index_misses: 7 },
    ]);
  });

  test("corrupt JSON source is ignored (does not block migration of siblings)", () => {
    // safeReadJson swallows parse errors and returns null; the importer
    // should skip that source and continue with the others.
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "bug-memory.json"), "not-json{{");
    writeJson(join(projDir, "file-index.json"), {
      header: {},
      entries: {
        "src/a.ts": {
          filePath: "src/a.ts",
          description: "ok",
          estimatedTokens: 1,
          lastModified: "2026-01-01T00:00:00.000Z",
          lastIndexed: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    const db = openProjectDb(cwd);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM file_index").get()
    ).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM bug_memory").get()).toEqual({
      n: 0,
    });
    // Meta marker is set so this never runs again
    expect(readMeta(db, "migrated_from_json_at")).not.toBeNull();
  });

  test("post-migration: re-running with NEW JSON drops added in (no-op due to meta marker)", () => {
    writeJson(join(projDir, "file-index.json"), {
      header: {},
      entries: {
        "src/a.ts": {
          filePath: "src/a.ts",
          description: "first",
          estimatedTokens: 1,
          lastModified: "2026-01-01T00:00:00.000Z",
          lastIndexed: "2026-01-01T00:00:00.000Z",
        },
      },
    });

    openProjectDb(cwd);
    _resetDbCacheForTests();

    // Now write a NEW JSON file that didn't exist during the first import.
    // Because meta.migrated_from_json_at is set, the importer skips it
    // entirely. (The wrapper layer in Phase 2 is responsible for any
    // post-migration JSON-to-DB write paths.)
    writeJson(join(projDir, "file-index.json"), {
      header: {},
      entries: {
        "src/b.ts": {
          filePath: "src/b.ts",
          description: "added later",
          estimatedTokens: 2,
          lastModified: "2026-01-02T00:00:00.000Z",
          lastIndexed: "2026-01-02T00:00:00.000Z",
        },
      },
    });

    const db = openProjectDb(cwd);
    const rows = db
      .prepare("SELECT file_path FROM file_index ORDER BY file_path")
      .all()
      .map((r) => (r as { file_path: string }).file_path);
    expect(rows).toEqual(["src/a.ts"]);
  });
});
