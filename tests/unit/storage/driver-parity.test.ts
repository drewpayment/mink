// Parity test for the build-time-selected SQLite driver. We can only
// exercise the runtime that's hosting `bun test`, so this file proves the
// adapter's contract holds for *that* runtime. The Node side is covered by
// a separate `node --test`-driven smoke job in CI (see release.yml).

import { describe, expect, test, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { openDriver, currentRuntime, type DbDriver } from "../../../src/storage/driver";
import { applySchema, readMeta, writeMeta } from "../../../src/storage/schema";

let dbs: DbDriver[] = [];
let tmpDirs: string[] = [];

afterEach(() => {
  for (const db of dbs) {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
  dbs = [];
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tmpDirs = [];
});

function fresh(): DbDriver {
  const dir = mkdtempSync(join(tmpdir(), "mink-driver-"));
  tmpDirs.push(dir);
  const db = openDriver(join(dir, "test.db"));
  db.exec("PRAGMA journal_mode = WAL");
  dbs.push(db);
  return db;
}

describe("driver", () => {
  test("reports a known runtime", () => {
    const rt = currentRuntime();
    expect(rt === "bun" || rt === "node").toBe(true);
  });

  test("exec creates a table and prepare/run/all round-trips rows", () => {
    const db = fresh();
    db.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    const ins = db.prepare("INSERT INTO kv (k, v) VALUES (?, ?)");
    const r = ins.run("a", "1");
    expect(Number(r.changes)).toBe(1);

    ins.run("b", "2");
    const rows = db.prepare("SELECT k, v FROM kv ORDER BY k").all();
    expect(rows).toEqual([
      { k: "a", v: "1" },
      { k: "b", v: "2" },
    ]);
  });

  test("get returns undefined for missing rows, row object for matches", () => {
    const db = fresh();
    db.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    db.prepare("INSERT INTO kv VALUES (?, ?)").run("x", "1");
    expect(db.prepare("SELECT v FROM kv WHERE k = ?").get("x")).toEqual({ v: "1" });
    expect(db.prepare("SELECT v FROM kv WHERE k = ?").get("missing")).toBeUndefined();
  });

  test("transaction commits on success", () => {
    const db = fresh();
    db.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    db.transaction(() => {
      db.prepare("INSERT INTO kv VALUES (?, ?)").run("a", "1");
      db.prepare("INSERT INTO kv VALUES (?, ?)").run("b", "2");
    });
    const rows = db.prepare("SELECT k FROM kv ORDER BY k").all();
    expect(rows.map((r) => r.k)).toEqual(["a", "b"]);
  });

  test("transaction rolls back on throw", () => {
    const db = fresh();
    db.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    expect(() => {
      db.transaction(() => {
        db.prepare("INSERT INTO kv VALUES (?, ?)").run("a", "1");
        throw new Error("boom");
      });
    }).toThrow("boom");
    expect(db.prepare("SELECT COUNT(*) AS n FROM kv").get()).toEqual({ n: 0 });
  });

  test("nested transactions use savepoints", () => {
    const db = fresh();
    db.exec(`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    db.transaction(() => {
      db.prepare("INSERT INTO kv VALUES (?, ?)").run("a", "1");
      try {
        db.transaction(() => {
          db.prepare("INSERT INTO kv VALUES (?, ?)").run("b", "2");
          throw new Error("inner");
        });
      } catch {
        // swallowed — outer should still commit "a"
      }
      db.prepare("INSERT INTO kv VALUES (?, ?)").run("c", "3");
    });
    const rows = db.prepare("SELECT k FROM kv ORDER BY k").all();
    expect(rows.map((r) => r.k)).toEqual(["a", "c"]);
  });

  test("FTS5 virtual table is queryable", () => {
    const db = fresh();
    db.exec(`CREATE VIRTUAL TABLE docs USING fts5(body, tokenize = 'porter unicode61')`);
    const ins = db.prepare("INSERT INTO docs (body) VALUES (?)");
    ins.run("the quick brown fox jumps");
    ins.run("lazy dogs lie quietly");
    const hits = db
      .prepare("SELECT body FROM docs WHERE docs MATCH ?")
      .all("quick");
    expect(hits).toHaveLength(1);
    expect((hits[0] as { body: string }).body).toContain("quick");
  });
});

describe("schema", () => {
  test("applySchema is idempotent and seeds schema_version", () => {
    const db = fresh();
    applySchema(db);
    applySchema(db);
    expect(readMeta(db, "schema_version")).toBe("2");
  });

  test("writeMeta upserts", () => {
    const db = fresh();
    applySchema(db);
    writeMeta(db, "test_key", "first");
    writeMeta(db, "test_key", "second");
    expect(readMeta(db, "test_key")).toBe("second");
  });

  test("bug_memory_fts triggers fire on INSERT and reflect tags", () => {
    const db = fresh();
    applySchema(db);
    db.prepare(`
      INSERT INTO bug_memory
        (id, created_at, last_seen_at, error_message, file_path, root_cause, fix_description, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "bug-001",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "TypeError: cannot read property foo of undefined",
      "src/index.ts",
      "missing null check",
      "add optional chaining",
      "dev-a"
    );
    db.prepare("INSERT INTO bug_tags VALUES (?, ?)").run("bug-001", "typeerror");
    db.prepare("INSERT INTO bug_tags VALUES (?, ?)").run("bug-001", "nullcheck");

    const hits = db
      .prepare("SELECT bug_id, tags FROM bug_memory_fts WHERE bug_memory_fts MATCH ?")
      .all("typeerror");
    expect(hits).toHaveLength(1);
    expect((hits[0] as { bug_id: string }).bug_id).toBe("bug-001");
  });
});
