// node:sqlite implementation of the DbDriver interface.
// Selected at build time when MINK_RUNTIME === "node" and via runtime
// detection when running unbundled under Node.
//
// Node engine floor (package.json `engines.node`) is pinned to >=24.0.0:
// node:sqlite first appeared (flagged/experimental) in 22.5 and its API
// shifted across 22.x/23.x. Node 24 is the only line we smoke-test the node
// bundle against in CI, so it's the floor we actually validate this driver on.
// This pin does NOT affect Bun users — Bun runs through driver.bun.ts
// (bun:sqlite), which is always available and is the preferred, faster path;
// `engines.node` is an npm/Node-side constraint only.

import type { DbDriver, DriverModule, SqlParam, Statement } from "./driver";

// Suppress Node 22's `ExperimentalWarning: SQLite is an experimental feature`
// the first (and only) time the module is required. We do it inline rather
// than via NODE_NO_WARNINGS so users don't lose warnings from other modules.
const originalEmit = process.emit;
process.emit = function patchedEmit(
  this: NodeJS.Process,
  event: string | symbol,
  ...args: unknown[]
): boolean {
  if (
    event === "warning" &&
    args[0] instanceof Error &&
    (args[0] as Error & { name: string }).name === "ExperimentalWarning" &&
    /sqlite/i.test((args[0] as Error).message)
  ) {
    return false;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (originalEmit as any).call(this, event, ...args);
} as typeof process.emit;

const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

class NodeStatement implements Statement {
  // node:sqlite uses StatementSync from its types
  constructor(private readonly stmt: import("node:sqlite").StatementSync) {}

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

class NodeDriver implements DbDriver {
  readonly filename: string;
  private readonly db: import("node:sqlite").DatabaseSync;
  private readonly txnDepth = { value: 0 };

  constructor(filename: string) {
    this.filename = filename;
    this.db = new DatabaseSync(filename);
  }

  prepare(sql: string): Statement {
    return new NodeStatement(this.db.prepare(sql));
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

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
    return this.db.prepare(`PRAGMA ${stmt}`).all();
  }
}

export const open: DriverModule["open"] = (filename) => new NodeDriver(filename);
