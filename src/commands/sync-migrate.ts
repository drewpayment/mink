import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { execSync } from "child_process";
import {
  minkRoot,
  fileIndexCountersPath,
} from "../core/paths";
import {
  MINK_SYNC_VERSION,
  readSyncVersion,
  writeSyncVersion,
  ensureGitignore,
  ensureGitAttributes,
  ensureMergeDriversRegistered,
  isSyncInitialized,
} from "../core/sync";
import { getOrCreateDeviceId } from "../core/device";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";
import type { FileIndex } from "../types/file-index";

const MIGRATE_LOCK = ".sync-migrate.lock";
const MIGRATE_LOCK_STALE_MS = 300_000; // 5 minutes
const MIGRATE_BUDGET_MS = 5_000;

function gitSafe(args: string, timeoutMs: number = 5_000): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd: minkRoot(),
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function acquireLock(): boolean {
  const path = join(minkRoot(), MIGRATE_LOCK);
  if (existsSync(path)) {
    try {
      const ageMs = Date.now() - statSync(path).mtimeMs;
      if (ageMs < MIGRATE_LOCK_STALE_MS) return false;
    } catch {
      // If stat fails, treat as stale and reclaim.
    }
  }
  try {
    writeFileSync(path, `${process.pid}\n`);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    unlinkSync(join(minkRoot(), MIGRATE_LOCK));
  } catch {
    // ignore
  }
}

// Move a file from `from` to `to` using `git mv` when possible (preserves
// history) and a plain rename otherwise. Returns true if the move succeeded
// or the source did not exist.
function migrateFile(from: string, to: string): boolean {
  if (!existsSync(from)) return true;
  mkdirSync(join(to, ".."), { recursive: true });
  // Prefer `git mv` so blame/history follow the file. Fall back to a plain
  // rename if git can't handle it (e.g. the file isn't tracked yet).
  if (gitSafe(`mv "${from}" "${to}"`) !== null) return true;
  try {
    renameSync(from, to);
    return true;
  } catch {
    return false;
  }
}

function migrateProject(projDir: string, deviceId: string): void {
  const shardDir = join(projDir, "state", deviceId);
  mkdirSync(shardDir, { recursive: true });

  // Move per-device-rewritten files into the device shard. `git mv` preserves
  // history; if a sibling shard already exists for this file (re-running the
  // migration after a partial first run), we leave the sibling alone — it's
  // already in the right place.
  for (const file of [
    "token-ledger.json",
    "token-ledger-archive.json",
    "bug-memory.json",
    "action-log.md",
  ]) {
    const legacy = join(projDir, file);
    const shard = join(shardDir, file);
    if (existsSync(shard)) continue;
    migrateFile(legacy, shard);
  }

  // learning-memory.md: leave canonical in place. Touch an empty sidecar so
  // future incremental writes have a target.
  const sidecar = join(projDir, `learning-memory.${deviceId}.md`);
  if (!existsSync(sidecar)) {
    try {
      writeFileSync(sidecar, "");
    } catch {
      // best-effort
    }
  }

  // Drop session.json + scheduler-manifest.json from the index — they remain
  // on disk but stop being synced (they're now gitignored under v2).
  for (const f of ["session.json", "scheduler-manifest.json"]) {
    if (existsSync(join(projDir, f))) {
      gitSafe(`rm --cached "${join(projDir, f)}"`);
    }
  }

  // Split file-index counters out into a per-device counter file.
  const indexPath = join(projDir, "file-index.json");
  if (existsSync(indexPath)) {
    const raw = safeReadJson(indexPath) as FileIndex | null;
    if (
      raw &&
      typeof raw.header === "object" &&
      raw.header !== null &&
      (raw.header.lifetimeHits > 0 || raw.header.lifetimeMisses > 0)
    ) {
      // Carry forward the existing counters so the per-device telemetry
      // continues uninterrupted on this device.
      atomicWriteJson(fileIndexCountersPathFor(projDir), {
        fileIndexHits: raw.header.lifetimeHits,
        fileIndexMisses: raw.header.lifetimeMisses,
      });
      raw.header.lifetimeHits = 0;
      raw.header.lifetimeMisses = 0;
      atomicWriteJson(indexPath, raw);
    }
  }
}

function fileIndexCountersPathFor(projDir: string): string {
  return join(projDir, ".mink-state-counters.json");
}

function listProjects(): string[] {
  const projectsRoot = join(minkRoot(), "projects");
  if (!existsSync(projectsRoot)) return [];
  try {
    return readdirSync(projectsRoot)
      .filter((name) => {
        try {
          return statSync(join(projectsRoot, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .map((name) => join(projectsRoot, name));
  } catch {
    return [];
  }
}

export interface MigrateResult {
  ranMigration: boolean;
  fromVersion: number;
  toVersion: number;
  message?: string;
}

// Idempotent. Safe to invoke from `mink sync migrate` directly or from a
// session-start auto-trigger when readSyncVersion() < MINK_SYNC_VERSION.
export function migrateSyncLayout(): MigrateResult {
  const fromVersion = readSyncVersion();
  if (fromVersion >= MINK_SYNC_VERSION) {
    return {
      ranMigration: false,
      fromVersion,
      toVersion: MINK_SYNC_VERSION,
      message: `already at v${MINK_SYNC_VERSION}`,
    };
  }

  const start = Date.now();

  if (!acquireLock()) {
    return {
      ranMigration: false,
      fromVersion,
      toVersion: MINK_SYNC_VERSION,
      message: "another migration is in progress",
    };
  }

  try {
    // Refresh .gitignore/.gitattributes/merge drivers regardless of whether
    // sync is initialised — they're cheap and idempotent. The merge-driver
    // registration is a no-op when .git/ doesn't exist.
    ensureGitignore();
    if (isSyncInitialized()) {
      ensureGitAttributes();
      ensureMergeDriversRegistered();
    }

    const deviceId = getOrCreateDeviceId();

    // Stash uncommitted changes so the migrating commit doesn't sweep up
    // unrelated edits. Best-effort — if nothing to stash, this is a no-op.
    let stashed = false;
    if (isSyncInitialized()) {
      const status = gitSafe("status --porcelain");
      if (status && status.trim().length > 0) {
        if (gitSafe("stash push -m mink-sync-migrate") !== null) {
          stashed = true;
        }
      }
    }

    for (const projDir of listProjects()) {
      if (Date.now() - start > MIGRATE_BUDGET_MS) {
        // Out of budget — write the version even though some projects may
        // still need migration on next run. Each migrateProject is
        // independently idempotent, so deferring is safe.
        break;
      }
      try {
        migrateProject(projDir, deviceId);
      } catch {
        // best-effort per project — never block migration on one project
      }
    }

    writeSyncVersion(MINK_SYNC_VERSION);

    if (isSyncInitialized()) {
      gitSafe("add -A");
      gitSafe(`commit -m "mink: migrate sync layout v${fromVersion} → v${MINK_SYNC_VERSION} (device ${deviceId.slice(0, 8)})"`);
    }

    if (stashed) {
      gitSafe("stash pop");
    }

    return {
      ranMigration: true,
      fromVersion,
      toVersion: MINK_SYNC_VERSION,
    };
  } finally {
    releaseLock();
  }
}

export function syncMigrateCommand(): void {
  const result = migrateSyncLayout();
  if (!result.ranMigration) {
    console.log(`[mink] sync migrate: ${result.message ?? "no-op"}`);
    return;
  }
  console.log(
    `[mink] sync migrate: v${result.fromVersion} → v${result.toVersion} complete`
  );
}
