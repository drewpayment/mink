// Project database lifecycle. The handle is opened lazily and cached per
// process (hook commands are short-lived; their first call to a repository
// triggers the open, and the handle is closed via the registered exit hook).
//
// On first open for a project that has on-disk JSON state, the lazy JSON
// importer runs (see `migrate-json.ts`). The importer is idempotent — once
// `meta.migrated_from_json_at` is set, it returns immediately.

import { mkdirSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { minkRoot, projectDbPath } from "../core/paths";
import { openDriver, type DbDriver } from "./driver";
import { applySchema } from "./schema";
import { migrateJsonIfNeeded } from "./migrate-json";

export { projectDbPath } from "../core/paths";

interface ConnectionEntry {
  driver: DbDriver;
  closed: boolean;
}

const handles = new Map<string, ConnectionEntry>();
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  const closeAll = (): void => {
    for (const entry of handles.values()) {
      if (entry.closed) continue;
      try {
        entry.driver.close();
      } catch {
        // best effort — process is shutting down
      }
      entry.closed = true;
    }
  };
  process.on("exit", closeAll);
}

// Test-only — drop cached handles between tests that wipe MINK_ROOT_OVERRIDE.
// Production code never calls this; the exit hook handles real shutdown.
export function _resetDbCacheForTests(): void {
  for (const entry of handles.values()) {
    if (entry.closed) continue;
    try {
      entry.driver.close();
    } catch {
      // ignore
    }
    entry.closed = true;
  }
  handles.clear();
}

function applyPragmas(db: DbDriver): void {
  // WAL: enables concurrent readers during a writer; survives crashes.
  // synchronous=NORMAL: safe with WAL, ~2-5x faster than FULL.
  // foreign_keys=ON: required for bug_tags / bug_related cascades.
  // busy_timeout: matches the existing 5s hook safety timeout in
  // src/core/runtime.ts — under contention SQLite will retry rather than
  // throw SQLITE_BUSY immediately.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
}

export function openProjectDb(cwd: string): DbDriver {
  const path = projectDbPath(cwd);
  const cached = handles.get(path);
  if (cached && !cached.closed) return cached.driver;

  mkdirSync(dirname(path), { recursive: true });
  const driver = openDriver(path);
  applyPragmas(driver);
  applySchema(driver);

  // Run migration AFTER applySchema so the importer can write into existing
  // tables. The importer no-ops once `meta.migrated_from_json_at` is set.
  try {
    migrateJsonIfNeeded(driver, cwd);
  } catch (err) {
    // Migration failures should not block the process — log and continue
    // with an empty DB. Phase 2 callers will fall back to legacy JSON reads.
    // (We rethrow for tests via MINK_DB_STRICT_MIGRATE=1.)
    if (process.env.MINK_DB_STRICT_MIGRATE === "1") throw err;
    console.warn(
      `[mink] JSON → SQLite migration failed for ${cwd}: ${
        (err as Error).message
      }`
    );
  }

  installExitHook();
  handles.set(path, { driver, closed: false });
  return driver;
}

// Force a WAL checkpoint and close the handle for the given cwd. Used by
// `mink sync` before pushing so the .db is self-contained (the -wal/-shm
// sidecars are not synced).
export function checkpointAndClose(cwd: string): void {
  const path = projectDbPath(cwd);
  const entry = handles.get(path);
  if (!entry || entry.closed) return;
  try {
    entry.driver.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch {
    // best effort
  }
  try {
    entry.driver.close();
  } catch {
    // best effort
  }
  entry.closed = true;
  handles.delete(path);
}

// Checkpoint and close EVERY cached handle in this process. Called before a
// sync touches the working tree: an open handle keeps recent writes in the
// gitignored mink.db-wal sidecar, and SQLite can auto-checkpoint (rewriting
// pages in the main mink.db) at any moment. If `git add` reads mink.db during
// that checkpoint it captures a torn, corrupt file. Closing first flushes the
// WAL into the main file and removes the sidecars, so what git sees is a
// single self-contained, consistent database.
export function checkpointAndCloseAll(): void {
  for (const [path, entry] of handles) {
    if (entry.closed) continue;
    try {
      entry.driver.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // best effort
    }
    try {
      entry.driver.close();
    } catch {
      // best effort
    }
    entry.closed = true;
    handles.delete(path);
  }
}

// Enumerate every on-disk project database (~/.mink/projects/*/mink.db).
// Used by sync to flush and integrity-check each DB before git stages it.
export function listProjectDbPaths(): string[] {
  const projectsDir = join(minkRoot(), "projects");
  let names: string[];
  try {
    names = readdirSync(projectsDir);
  } catch {
    return [];
  }
  const paths: string[] = [];
  for (const name of names) {
    const dbPath = join(projectsDir, name, "mink.db");
    try {
      if (statSync(dbPath).isFile()) paths.push(dbPath);
    } catch {
      // no database in this project directory
    }
  }
  return paths;
}

// Flush every on-disk project DB's WAL into its main file and verify each one
// is structurally sound, returning the paths that failed the check. Opening a
// fresh connection and running `wal_checkpoint(TRUNCATE)` makes the main file
// self-contained (any committed frames sitting in a sibling's WAL are folded
// in, since the WAL is shared across connections). `quick_check` then detects
// page-level corruption — exactly what a torn sync write produces — without
// the full per-row index scan of `integrity_check`. Callers keep the corrupt
// paths out of the commit so a local corruption never propagates to other
// devices.
export function checkpointAndVerifyProjectDbs(): { corrupt: string[] } {
  const corrupt: string[] = [];
  for (const path of listProjectDbPaths()) {
    let driver: DbDriver | null = null;
    try {
      driver = openDriver(path);
      driver.exec("PRAGMA busy_timeout = 5000");
      driver.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      const rows = driver.pragma("quick_check") as Array<Record<string, unknown>>;
      const first = rows && rows.length > 0 ? Object.values(rows[0])[0] : undefined;
      if (first !== "ok") corrupt.push(path);
    } catch {
      // Could not even open/checkpoint it — treat as corrupt so it stays out
      // of the commit.
      corrupt.push(path);
    } finally {
      try {
        driver?.close();
      } catch {
        // best effort
      }
    }
  }
  return { corrupt };
}
