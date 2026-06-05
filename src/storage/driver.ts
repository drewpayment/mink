// Build-time-selected SQLite driver adapter. The actual import of
// `bun:sqlite` or `node:sqlite` happens in the runtime-specific
// `driver.bun.ts` / `driver.node.ts` siblings; this file picks one based on
// the `MINK_RUNTIME` define injected by `bun build --define`. When neither
// define is set (e.g. running TypeScript directly under `bun test`), it
// falls back to `typeof Bun` detection.
//
// The adapter exposes a stable 5-method surface — `prepare`, `exec`,
// `transaction`, `close`, `pragma` — chosen as the minimal set that covers
// every call site in `src/repositories/`. Both backends' `Statement.run/get/all`
// methods are compatible enough that we pass them through unchanged.

declare const MINK_RUNTIME: string | undefined;

export type SqlParam = string | number | bigint | Uint8Array | null;
export type SqlRow = Record<string, unknown>;

export interface Statement {
  run(...params: SqlParam[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SqlParam[]): SqlRow | undefined;
  all(...params: SqlParam[]): SqlRow[];
  iterate?(...params: SqlParam[]): IterableIterator<SqlRow>;
}

export interface DbDriver {
  prepare(sql: string): Statement;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  close(): void;
  pragma(stmt: string): unknown;
  readonly filename: string;
}

export interface DriverModule {
  open(filename: string): DbDriver;
}

function pickRuntime(): "bun" | "node" {
  // `MINK_RUNTIME` is replaced at bundle time. When running source directly
  // (tests, `bun src/cli.ts`), the symbol is undefined and we fall back to
  // feature detection.
  try {
    if (typeof MINK_RUNTIME !== "undefined") {
      if (MINK_RUNTIME === "bun" || MINK_RUNTIME === "node") return MINK_RUNTIME;
    }
  } catch {
    // ReferenceError when the symbol is not declared — proceed to detect.
  }
  return typeof Bun !== "undefined" ? "bun" : "node";
}

let cached: DriverModule | undefined;

function loadDriver(): DriverModule {
  if (cached) return cached;
  const runtime = pickRuntime();
  // Conditional `require` keeps the unused branch out of the active bundle
  // when `bun build` does constant-folding on `pickRuntime()`'s result via
  // the `MINK_RUNTIME` define. At runtime, only the matching branch ever
  // executes, so the other module's `import 'bun:sqlite'` /
  // `import 'node:sqlite'` is never evaluated.
  if (runtime === "bun") {
    cached = require("./driver.bun") as DriverModule;
  } else {
    cached = require("./driver.node") as DriverModule;
  }
  return cached;
}

export function openDriver(filename: string): DbDriver {
  return loadDriver().open(filename);
}

export function currentRuntime(): "bun" | "node" {
  return pickRuntime();
}
