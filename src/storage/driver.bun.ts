// bun:sqlite implementation of the DbDriver interface.
// Selected at build time when MINK_RUNTIME === "bun" and via `typeof Bun`
// detection when running unbundled.

import type { DbDriver, DriverModule, SqlParam, Statement } from "./driver";

// Use require() so the type-only import path doesn't trip Node when this
// file is loaded under the wrong runtime by mistake (the runtime dispatcher
// in driver.ts is supposed to prevent that).
const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");

class BunStatement implements Statement {
  constructor(private readonly stmt: import("bun:sqlite").Statement) {}

  run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint } {
    const r = this.stmt.run(...(params as never[]));
    return { changes: r.changes, lastInsertRowid: r.lastInsertRowid };
  }

  get(...params: SqlParam[]) {
    const row = this.stmt.get(...(params as never[]));
    return (row ?? undefined) as Record<string, unknown> | undefined;
  }

  all(...params: SqlParam[]) {
    return this.stmt.all(...(params as never[])) as Record<string, unknown>[];
  }
}

class BunDriver implements DbDriver {
  readonly filename: string;
  private readonly db: import("bun:sqlite").Database;
  private readonly txnDepth = { value: 0 };

  constructor(filename: string) {
    this.filename = filename;
    this.db = new Database(filename, { create: true });
  }

  prepare(sql: string): Statement {
    return new BunStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  // We implement transactions manually (rather than using bun:sqlite's
  // `db.transaction(fn)` wrapper) so semantics match node:sqlite exactly:
  // synchronous, nestable via savepoints, IMMEDIATE locking to fail fast
  // when another writer is mid-transaction.
  transaction<T>(fn: () => T): T {
    if (this.txnDepth.value > 0) {
      const sp = `sp_${this.txnDepth.value}`;
      this.db.exec(`SAVEPOINT ${sp}`);
      this.txnDepth.value++;
      try {
        const result = fn();
        this.db.exec(`RELEASE SAVEPOINT ${sp}`);
        this.txnDepth.value--;
        return result;
      } catch (err) {
        this.db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
        this.db.exec(`RELEASE SAVEPOINT ${sp}`);
        this.txnDepth.value--;
        throw err;
      }
    }
    this.db.exec("BEGIN IMMEDIATE");
    this.txnDepth.value++;
    try {
      const result = fn();
      this.db.exec("COMMIT");
      this.txnDepth.value--;
      return result;
    } catch (err) {
      this.db.exec("ROLLBACK");
      this.txnDepth.value--;
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  pragma(stmt: string): unknown {
    // bun:sqlite has no dedicated pragma() helper; route through exec/query.
    // Pragmas that return a value (e.g. `journal_mode`) are SELECT-shaped.
    if (/^[a-z_]+\s*=/i.test(stmt) || /^[a-z_]+\s*\([^)]*\)/i.test(stmt)) {
      // Assignment or call form — no result expected, but the sqlite engine
      // still returns the new value. Query so callers can read it.
      return this.db.prepare(`PRAGMA ${stmt}`).all();
    }
    return this.db.prepare(`PRAGMA ${stmt}`).all();
  }
}

export const open: DriverModule["open"] = (filename) => new BunDriver(filename);
