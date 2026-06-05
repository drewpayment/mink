// Tests for the mink-db-merge driver. We construct two DB files with
// overlapping rows, run the merge driver against them, and assert the
// merged result matches the conflict rules documented in the driver.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { openDriver } from "../../../src/storage/driver";
import { applySchema } from "../../../src/storage/schema";
import { mergeDbDriver } from "../../../src/core/sync-merge-drivers";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mink-db-merge-"));
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

function buildDb(filename: string): import("../../../src/storage/driver").DbDriver {
  const path = join(tmp, filename);
  const db = openDriver(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  applySchema(db);
  return db;
}

// Flush WAL and close so the .db file is self-contained when mergeDbDriver
// copyFileSyncs it. Otherwise the merge sees only the pre-WAL state.
function flushAndClose(db: import("../../../src/storage/driver").DbDriver): void {
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

describe("mink-db-merge driver", () => {
  test("file_index conflicts resolve to the newer last_modified", () => {
    const ours = buildDb("ours.db");
    const theirs = buildDb("theirs.db");

    ours.prepare(
      "INSERT INTO file_index (file_path, description, estimated_tokens, last_modified, last_indexed, mtime_ms, device_id) VALUES (?,?,?,?,?,?,?)"
    ).run("src/a.ts", "ours-desc", 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", 100, "dev-a");
    theirs.prepare(
      "INSERT INTO file_index (file_path, description, estimated_tokens, last_modified, last_indexed, mtime_ms, device_id) VALUES (?,?,?,?,?,?,?)"
    ).run("src/a.ts", "theirs-desc-newer", 2, "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z", 200, "dev-b");
    // disjoint row from theirs — should land in merged result.
    theirs.prepare(
      "INSERT INTO file_index (file_path, description, estimated_tokens, last_modified, last_indexed, mtime_ms, device_id) VALUES (?,?,?,?,?,?,?)"
    ).run("src/b.ts", "only-theirs", 3, "2026-01-03T00:00:00.000Z", "2026-01-03T00:00:00.000Z", 300, "dev-b");

    flushAndClose(ours);
    flushAndClose(theirs);

    mergeDbDriver({
      basePath: join(tmp, "ignored-base"),
      oursPath: join(tmp, "ours.db"),
      theirsPath: join(tmp, "theirs.db"),
      filePath: "projects/test/mink.db",
    });

    const merged = openDriver(join(tmp, "ours.db"));
    const rows = merged
      .prepare(
        "SELECT file_path, description, estimated_tokens, device_id FROM file_index ORDER BY file_path"
      )
      .all();
    expect(rows).toEqual([
      { file_path: "src/a.ts", description: "theirs-desc-newer", estimated_tokens: 2, device_id: "dev-b" },
      { file_path: "src/b.ts", description: "only-theirs",       estimated_tokens: 3, device_id: "dev-b" },
    ]);
    merged.close();
  });

  test("bug_memory merges occurrence_count + tags + related across sides", () => {
    const ours = buildDb("ours.db");
    const theirs = buildDb("theirs.db");

    const insertBug = (db: import("../../../src/storage/driver").DbDriver, fields: {
      created: string; lastSeen: string; count: number;
    }) => db.prepare(
      "INSERT INTO bug_memory (id, created_at, last_seen_at, error_message, file_path, root_cause, fix_description, occurrence_count, device_id) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run("bug-001", fields.created, fields.lastSeen, "err", "src/a.ts", "rc", "fd", fields.count, "dev");

    insertBug(ours, { created: "2026-01-05T00:00:00.000Z", lastSeen: "2026-01-05T00:00:00.000Z", count: 3 });
    ours.prepare("INSERT INTO bug_tags VALUES (?,?)").run("bug-001", "ours-tag");
    ours.prepare("INSERT INTO bug_related VALUES (?,?)").run("bug-001", "bug-002");

    // Theirs: older createdAt (wins), newer lastSeenAt (wins), smaller count (loses).
    insertBug(theirs, { created: "2026-01-01T00:00:00.000Z", lastSeen: "2026-01-10T00:00:00.000Z", count: 1 });
    theirs.prepare("INSERT INTO bug_tags VALUES (?,?)").run("bug-001", "theirs-tag");
    theirs.prepare("INSERT INTO bug_related VALUES (?,?)").run("bug-001", "bug-003");

    flushAndClose(ours);
    flushAndClose(theirs);

    mergeDbDriver({
      basePath: join(tmp, "ignored-base"),
      oursPath: join(tmp, "ours.db"),
      theirsPath: join(tmp, "theirs.db"),
      filePath: "projects/test/mink.db",
    });

    const merged = openDriver(join(tmp, "ours.db"));
    const bug = merged
      .prepare("SELECT created_at, last_seen_at, occurrence_count FROM bug_memory WHERE id = 'bug-001'")
      .get();
    expect(bug).toEqual({
      created_at: "2026-01-01T00:00:00.000Z",
      last_seen_at: "2026-01-10T00:00:00.000Z",
      occurrence_count: 3,
    });
    const tags = merged
      .prepare("SELECT tag FROM bug_tags WHERE bug_id = 'bug-001' ORDER BY tag")
      .all()
      .map((r) => (r as { tag: string }).tag);
    expect(tags).toEqual(["ours-tag", "theirs-tag"]);
    const related = merged
      .prepare("SELECT related_bug_id FROM bug_related WHERE bug_id = 'bug-001' ORDER BY related_bug_id")
      .all()
      .map((r) => (r as { related_bug_id: string }).related_bug_id);
    expect(related).toEqual(["bug-002", "bug-003"]);
    merged.close();
  });

  test("ledger_sessions insert-only (first writer wins on duplicate id)", () => {
    const ours = buildDb("ours.db");
    const theirs = buildDb("theirs.db");

    const insertSession = (db: import("../../../src/storage/driver").DbDriver, tokens: number) =>
      db.prepare(
        "INSERT INTO ledger_sessions (session_id, device_id, start_timestamp, end_timestamp, estimated_tokens) VALUES (?,?,?,?,?)"
      ).run("sess-shared", "dev", "2026-01-01", "2026-01-01", tokens);

    insertSession(ours, 100);
    insertSession(theirs, 999);

    // Disjoint session in theirs.
    theirs.prepare(
      "INSERT INTO ledger_sessions (session_id, device_id, start_timestamp, end_timestamp, estimated_tokens) VALUES (?,?,?,?,?)"
    ).run("sess-only-theirs", "dev-b", "2026-01-02", "2026-01-02", 200);

    flushAndClose(ours);
    flushAndClose(theirs);

    mergeDbDriver({
      basePath: "",
      oursPath: join(tmp, "ours.db"),
      theirsPath: join(tmp, "theirs.db"),
      filePath: "x",
    });

    const merged = openDriver(join(tmp, "ours.db"));
    const rows = merged
      .prepare("SELECT session_id, estimated_tokens FROM ledger_sessions ORDER BY session_id")
      .all();
    expect(rows).toEqual([
      { session_id: "sess-only-theirs", estimated_tokens: 200 },
      { session_id: "sess-shared",      estimated_tokens: 100 }, // ours wins
    ]);
    merged.close();
  });

  test("counters merge by MAX per device", () => {
    const ours = buildDb("ours.db");
    const theirs = buildDb("theirs.db");
    ours.prepare("INSERT INTO counters VALUES (?,?,?)").run("dev-a", 10, 2);
    theirs.prepare("INSERT INTO counters VALUES (?,?,?)").run("dev-a", 7, 9);
    theirs.prepare("INSERT INTO counters VALUES (?,?,?)").run("dev-b", 1, 1);
    flushAndClose(ours);
    flushAndClose(theirs);
    mergeDbDriver({
      basePath: "",
      oursPath: join(tmp, "ours.db"),
      theirsPath: join(tmp, "theirs.db"),
      filePath: "x",
    });
    const merged = openDriver(join(tmp, "ours.db"));
    const rows = merged
      .prepare("SELECT device_id, file_index_hits, file_index_misses FROM counters ORDER BY device_id")
      .all();
    expect(rows).toEqual([
      { device_id: "dev-a", file_index_hits: 10, file_index_misses: 9 },
      { device_id: "dev-b", file_index_hits: 1,  file_index_misses: 1 },
    ]);
    merged.close();
  });
});
