// Connection lifecycle for the wiki search database (`<vault>/.mink-search.db`).
// Mirrors storage/db.ts's per-path caching, but keyed by vault path instead
// of by project — there is one search DB per vault, not per project, and the
// vault path can change between calls in tests (MINK_WIKI_PATH override) or
// if the user repoints `wiki.path`. The cache checks the resolved path on
// every open and transparently reconnects when it differs.

import { mkdirSync } from "fs";
import { dirname, join } from "path";
import { resolveVaultPath } from "../core/vault";
import { openDriver, type DbDriver } from "./driver";
import { applyWikiSearchSchema } from "./wiki-search-schema";

export function wikiSearchDbPath(): string {
  return join(resolveVaultPath(), ".mink-search.db");
}

interface CacheEntry {
  path: string;
  driver: DbDriver;
}

let cached: CacheEntry | null = null;
let exitHookInstalled = false;

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    if (!cached) return;
    try {
      cached.driver.close();
    } catch {
      // best effort — process is shutting down
    }
    cached = null;
  });
}

function applyPragmas(db: DbDriver): void {
  // Same rationale as storage/db.ts: WAL for concurrent readers during a
  // writer, NORMAL sync (safe under WAL), busy_timeout so hook-path writers
  // retry instead of throwing SQLITE_BUSY under light contention.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA busy_timeout = 5000");
}

export function openWikiSearchDb(): DbDriver {
  const path = wikiSearchDbPath();
  if (cached && cached.path === path) return cached.driver;
  if (cached) {
    try {
      cached.driver.close();
    } catch {
      // best effort
    }
    cached = null;
  }

  mkdirSync(dirname(path), { recursive: true });
  const driver = openDriver(path);
  applyPragmas(driver);
  applyWikiSearchSchema(driver);

  installExitHook();
  cached = { path, driver };
  return driver;
}

// Test-only — drop the cached handle so a test that swaps MINK_WIKI_PATH
// gets a fresh connection instead of quietly reusing a stale one whose
// backing directory may have been rmSync'd.
export function _resetWikiSearchDbForTests(): void {
  if (cached) {
    try {
      cached.driver.close();
    } catch {
      // ignore
    }
    cached = null;
  }
}
