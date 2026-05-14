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
import {
  resolveProjectIdentity,
  generateProjectId,
} from "../core/project-id";
import {
  getProjectMeta,
  addProjectAlias,
  setProjectPathForDevice,
} from "../core/project-registry";
import { resolveConfigValue } from "../core/global-config";
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

// True if any legacy v1 state shape still lives at the top level of projDir
// AND no per-device shard has been populated yet. Once a shard directory has
// any contents, this project counts as migrated even if a stale legacy file
// is still on disk — that's the case where the user opened a session
// mid-migration and writes started landing in the shard. The aggregator unions
// across legacy + shards on read, so the stale file is harmless until cleaned
// up; what we must avoid is a permanent re-migrate loop on every session-start.
function projectNeedsMigration(projDir: string): boolean {
  const stateDir = join(projDir, "state");
  if (existsSync(stateDir)) {
    try {
      const shards = readdirSync(stateDir).filter((d) => {
        try {
          return statSync(join(stateDir, d)).isDirectory();
        } catch {
          return false;
        }
      });
      if (shards.length > 0) return false;
    } catch {
      // fall through
    }
  }
  for (const f of [
    "token-ledger.json",
    "token-ledger-archive.json",
    "bug-memory.json",
    "action-log.md",
  ]) {
    if (existsSync(join(projDir, f))) return true;
  }
  return false;
}

function listProjectsNeedingMigration(): string[] {
  return listProjects().filter(projectNeedsMigration);
}

// ── v3 identity migration ─────────────────────────────────────────────────
//
// When `projects.identity = git-remote`, walks every project on disk and:
//   1. Computes its new identifier from the recorded working-copy path.
//   2. If the new identifier differs from the on-disk directory name, renames
//      the directory (preferring `git mv` so history is preserved when sync
//      is initialised), records the old identifier as an alias, and lifts the
//      singular `cwd` into the per-device path map keyed by this device.
//   3. If the working-copy path is missing from the local filesystem (the
//      project's repo was cloned on a different machine), the project is left
//      alone — the device that owns the cwd will migrate it.
//
// Idempotent: re-running after a clean pass walks every project, finds every
// id matches its directory name, and does nothing.
function migrateProjectIdentities(deviceId: string): {
  renamed: number;
  visited: number;
} {
  if (resolveConfigValue("projects.identity").value !== "git-remote") {
    return { renamed: 0, visited: 0 };
  }

  let renamed = 0;
  let visited = 0;
  const projectsRoot = join(minkRoot(), "projects");
  if (!existsSync(projectsRoot)) return { renamed, visited };

  let entries: string[];
  try {
    entries = readdirSync(projectsRoot);
  } catch {
    return { renamed, visited };
  }

  for (const oldId of entries) {
    const oldProjDir = join(projectsRoot, oldId);
    let isDir = false;
    try {
      isDir = statSync(oldProjDir).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    visited++;

    const meta = getProjectMeta(oldProjDir);
    if (!meta) continue;

    // Skip projects whose cwd isn't reachable on this device — we cannot
    // reliably re-resolve identity without the underlying filesystem. The
    // device that owns the cwd will handle the rename and sync will carry it.
    if (!existsSync(meta.cwd)) continue;

    let resolution;
    try {
      resolution = resolveProjectIdentity(meta.cwd);
    } catch {
      continue;
    }

    const newId = resolution.id;

    // Always lift the singular cwd into the per-device map so older records
    // gain the multi-device shape even when their identifier hasn't changed.
    try {
      setProjectPathForDevice(oldProjDir, deviceId, meta.cwd);
    } catch {
      // best-effort; keep going
    }

    if (newId === oldId) continue;

    const newProjDir = join(projectsRoot, newId);
    if (existsSync(newProjDir)) {
      // A previous device already migrated this project and the new directory
      // arrived via sync. Record the old id as an alias on the new directory,
      // then remove the now-redundant old directory's metadata pointer. Leave
      // the actual files for the cross-device sync merge to reconcile rather
      // than blind-deleting.
      try {
        addProjectAlias(newProjDir, oldId);
        setProjectPathForDevice(newProjDir, deviceId, meta.cwd);
      } catch {
        // best-effort
      }
      continue;
    }

    const moved =
      gitSafe(`mv "${oldProjDir}" "${newProjDir}"`) !== null ||
      (() => {
        try {
          renameSync(oldProjDir, newProjDir);
          return true;
        } catch {
          return false;
        }
      })();

    if (!moved) continue;

    try {
      addProjectAlias(newProjDir, oldId);
      setProjectPathForDevice(newProjDir, deviceId, meta.cwd);
    } catch {
      // best-effort
    }
    renamed++;
  }

  return { renamed, visited };
}

export interface MigrateResult {
  ranMigration: boolean;
  fromVersion: number;
  toVersion: number;
  message?: string;
}

// Idempotent. Safe to invoke from `mink sync migrate` directly or from a
// session-start auto-trigger when readSyncVersion() < MINK_SYNC_VERSION.
//
// We treat the version marker as a hint, not a gate — a previous partial run
// (interrupted by the budget cap) may have written the latest version with
// projects still pending. We re-run as long as any project on disk still has
// legacy files at its top level, regardless of marker. The v3 identity step
// also runs whenever projects.identity=git-remote so a user who flips the
// flag after the version has already stamped to 3 still gets their projects
// migrated.
export function migrateSyncLayout(): MigrateResult {
  const fromVersion = readSyncVersion();
  const pending = listProjectsNeedingMigration();
  const identityMode = resolveConfigValue("projects.identity").value;
  if (
    fromVersion >= MINK_SYNC_VERSION &&
    pending.length === 0 &&
    identityMode !== "git-remote"
  ) {
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

    // Process pending projects only — already-migrated projects are skipped
    // for free, and we resume work from any prior partial run.
    let processed = 0;
    let remaining = 0;
    for (const projDir of listProjectsNeedingMigration()) {
      if (Date.now() - start > MIGRATE_BUDGET_MS) {
        remaining++;
        continue;
      }
      try {
        migrateProject(projDir, deviceId);
        processed++;
      } catch {
        // best-effort per project — never block migration on one project
      }
    }

    // v3 identity migration: rename per-project directories to their stable
    // git-derived identifier when the user has opted in. Cheap no-op when the
    // flag is off or every project's identifier already matches its directory.
    let identity = { renamed: 0, visited: 0 };
    try {
      identity = migrateProjectIdentities(deviceId);
    } catch {
      // best-effort; never block the rest of migration
    }

    // Only stamp the version marker once nothing is left to migrate. If we
    // still have pending projects, leave the marker as-is so the next session
    // knows to keep going.
    if (remaining === 0 && listProjectsNeedingMigration().length === 0) {
      writeSyncVersion(MINK_SYNC_VERSION);
    }

    if (isSyncInitialized() && (processed > 0 || identity.renamed > 0)) {
      // Skip the lock file — it's part of migration coordination, not state.
      gitSafe("add -A");
      gitSafe(`reset HEAD ".sync-migrate.lock"`);
      const summary =
        identity.renamed > 0
          ? `${processed} projects, ${identity.renamed} renamed for identity v3`
          : `${processed} projects`;
      gitSafe(
        `commit -m "mink: migrate sync layout v${fromVersion} -> v${MINK_SYNC_VERSION} (device ${deviceId.slice(0, 8)}, ${summary})"`
      );
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
