import {
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  renameSync,
  rmSync,
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
//   2. If the new identifier differs from the on-disk directory name, snapshots
//      the project to a rollback backup, then renames the directory (preferring
//      `git mv` so history is preserved when sync is initialised), records the
//      old identifier as an alias, and lifts the singular `cwd` into the
//      per-device path map keyed by this device.
//   3. If the working-copy path is missing from the local filesystem (the
//      project's repo was cloned on a different machine), the project is left
//      alone — the device that owns the cwd will handle the rename.
//
// Idempotent: re-running after a clean pass walks every project, finds every
// id matches its directory name, and does nothing.

// Plan actions:
//   rename          old dir present, new dir absent → rename old → new, record alias.
//   skip-converged  old dir + new dir both present, alias NOT yet recorded → record
//                   alias on new meta and evict old dir to .identity-rollback/. Named
//                   "skip-converged" because the rename itself is unnecessary; the
//                   convergence work (alias + eviction) is the action.
//   skip-evict      old dir + new dir both present, alias already recorded → only
//                   evict the old dir. Reached when a previous migration recorded
//                   the alias but didn't (or couldn't) finish evicting. Without
//                   this, dry-run would keep proposing skip-converged forever.
//   skip-no-cwd     project's working-copy path is on a different device — leave alone.
//   skip-unchanged  newId === oldId — no work needed at all.
export type IdentityPlanAction =
  | "rename"
  | "skip-converged"
  | "skip-evict"
  | "skip-no-cwd"
  | "skip-unchanged";

export interface IdentityPlanEntry {
  oldId: string;
  newId: string | null;
  cwd: string | null;
  action: IdentityPlanAction;
  reason?: string;
}

// Walks every project on disk and returns the rename plan without touching it.
// Backbone for both --dry-run and the real migration so they share logic.
//
// Accepts an optional `flagOverride` so callers that have already snapshotted
// `projects.identity` (e.g. migrateSyncLayout, before its git-stash) can pass
// the snapshot in rather than re-reading from disk inside a stash window where
// the config file's uncommitted writes are temporarily hidden.
export function planIdentityMigration(flagOverride?: string): IdentityPlanEntry[] {
  const plan: IdentityPlanEntry[] = [];
  const flag = flagOverride ?? resolveConfigValue("projects.identity").value;
  if (flag !== "git-remote") {
    return plan;
  }

  const projectsRoot = join(minkRoot(), "projects");
  if (!existsSync(projectsRoot)) return plan;

  let entries: string[];
  try {
    entries = readdirSync(projectsRoot);
  } catch {
    return plan;
  }

  for (const oldId of entries) {
    const oldProjDir = join(projectsRoot, oldId);
    try {
      if (!statSync(oldProjDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const meta = getProjectMeta(oldProjDir);
    if (!meta) continue;

    if (!existsSync(meta.cwd)) {
      plan.push({
        oldId,
        newId: null,
        cwd: meta.cwd,
        action: "skip-no-cwd",
        reason: "working-copy path not reachable on this device",
      });
      continue;
    }

    let newId: string;
    try {
      newId = resolveProjectIdentity(
        meta.cwd,
        flag === "git-remote" || flag === "path-derived" ? flag : undefined
      ).id;
    } catch {
      continue;
    }

    if (newId === oldId) {
      plan.push({ oldId, newId, cwd: meta.cwd, action: "skip-unchanged" });
      continue;
    }

    const newProjDir = join(projectsRoot, newId);
    if (existsSync(newProjDir)) {
      // If the canonical (new) project already records this oldId in its
      // aliases list, the convergence bookkeeping is already done — only the
      // leftover old directory remains to be cleaned up. Surfacing this as a
      // distinct action (skip-evict) makes dry-run idempotent: once the alias
      // is recorded AND the old directory is gone, the planner stops seeing
      // the project entirely. Pre-fix it would keep proposing the same
      // skip-converged action forever.
      const newMeta = getProjectMeta(newProjDir);
      const aliasAlreadyRecorded = newMeta?.aliases?.includes(oldId) ?? false;
      plan.push({
        oldId,
        newId,
        cwd: meta.cwd,
        action: aliasAlreadyRecorded ? "skip-evict" : "skip-converged",
        reason: aliasAlreadyRecorded
          ? "alias already recorded; will evict leftover old directory"
          : "destination already exists (from sync); will record alias and evict old directory",
      });
      continue;
    }

    plan.push({ oldId, newId, cwd: meta.cwd, action: "rename" });
  }
  return plan;
}

const IDENTITY_BACKUP_DIRNAME = ".identity-rollback";

function identityBackupRoot(timestamp: string): string {
  return join(minkRoot(), IDENTITY_BACKUP_DIRNAME, timestamp);
}

function ensureIdentityBackupTimestamp(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(
    now.getUTCDate()
  ).padStart(2, "0")}-${String(now.getUTCHours()).padStart(2, "0")}${String(
    now.getUTCMinutes()
  ).padStart(2, "0")}${String(now.getUTCSeconds()).padStart(2, "0")}`;
}

// Copies a project directory tree to the rollback backup. Skips `backups/` so
// nested backups don't double the snapshot size. Returns the backup path or
// null on failure (caller logs but does not abort migration on backup failure).
function backupProjectForRollback(srcDir: string, backupDir: string): string | null {
  try {
    mkdirSync(backupDir, { recursive: true });
    copyDirRecursive(srcDir, backupDir, new Set(["backups"]));
    return backupDir;
  } catch {
    return null;
  }
}

function copyDirRecursive(src: string, dest: string, excludeNames: Set<string>): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    if (excludeNames.has(entry.name)) continue;
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, excludeNames);
    } else if (entry.isFile()) {
      writeFileSync(destPath, readFileSync(srcPath));
    }
  }
}

// Accepts the identity-mode value as a parameter so the caller can snapshot it
// before any disk side-effects (notably the migrating git-stash in
// migrateSyncLayout, which would hide uncommitted writes to the config file
// that drives this very decision). Falls back to a fresh read for callers that
// don't operate inside a stash window (e.g. session-start triggers and the
// --dry-run path).
export interface IdentityMigrationOutcome {
  renamed: number;
  converged: number;
  evicted: number;
  visited: number;
  backupDir: string | null;
  renames: Array<{ from: string; to: string }>;
  evictions: string[];
}

function migrateProjectIdentities(
  deviceId: string,
  flag: string = resolveConfigValue("projects.identity").value
): IdentityMigrationOutcome {
  if (flag !== "git-remote") {
    return {
      renamed: 0,
      converged: 0,
      evicted: 0,
      visited: 0,
      backupDir: null,
      renames: [],
      evictions: [],
    };
  }

  const plan = planIdentityMigration(flag);
  // Any action that moves an old directory aside needs a backup destination.
  // rename, skip-converged (record alias + evict), and skip-evict (alias
  // already recorded; only evict) all qualify.
  const willTouchOldDir = plan.filter(
    (p) =>
      p.action === "rename" ||
      p.action === "skip-converged" ||
      p.action === "skip-evict"
  );

  // Compute the backup root up-front so all snapshots for this migration pass
  // land in one timestamped directory the user can find and reason about.
  let backupRoot: string | null = null;
  if (willTouchOldDir.length > 0) {
    backupRoot = identityBackupRoot(ensureIdentityBackupTimestamp());
  }

  let renamed = 0;
  let converged = 0;
  let evicted = 0;
  const renames: Array<{ from: string; to: string }> = [];
  const evictions: string[] = [];
  let visited = plan.length;
  const projectsRoot = join(minkRoot(), "projects");

  for (const entry of plan) {
    const oldProjDir = join(projectsRoot, entry.oldId);

    // Lift cwd into pathsByDevice for every project we can see, even
    // skip-unchanged ones, so older records gain the multi-device shape.
    if (entry.cwd && entry.action !== "skip-no-cwd") {
      try {
        setProjectPathForDevice(oldProjDir, deviceId, entry.cwd);
      } catch {
        // best-effort
      }
    }

    if (
      (entry.action === "skip-converged" || entry.action === "skip-evict") &&
      entry.newId
    ) {
      const newProjDir = join(projectsRoot, entry.newId);
      // Record the alias and lift the device path before evicting. If the new
      // dir has no project-meta.json (e.g. the daemon wrote state under the
      // git-derived id before any init or migrate ran), addProjectAlias would
      // silently no-op and we'd leave the old dir stranded forever. Repair
      // that case by writing the old meta forward — the daemon-authored
      // payload state under the new dir is preserved; only the missing meta
      // gets reconstructed, with the alias already in place.
      let aliasOnRecord = false;
      try {
        if (entry.action === "skip-evict") {
          aliasOnRecord = true;
        } else {
          addProjectAlias(newProjDir, entry.oldId);
          let newMeta = getProjectMeta(newProjDir);
          if (!newMeta) {
            const oldMeta = getProjectMeta(oldProjDir);
            if (oldMeta) {
              atomicWriteJson(join(newProjDir, "project-meta.json"), {
                cwd: oldMeta.cwd,
                name: oldMeta.name,
                initTimestamp: oldMeta.initTimestamp,
                version: oldMeta.version,
                aliases: [...(oldMeta.aliases ?? []), entry.oldId],
                pathsByDevice: oldMeta.pathsByDevice,
              });
              newMeta = getProjectMeta(newProjDir);
            }
          }
          aliasOnRecord = newMeta?.aliases?.includes(entry.oldId) ?? false;
        }
        if (entry.cwd) {
          setProjectPathForDevice(newProjDir, deviceId, entry.cwd);
        }
      } catch {
        // best-effort
      }

      if (aliasOnRecord && backupRoot) {
        // Snapshot the old dir before eviction so any local-only state
        // (writes that landed here before sync converged) is recoverable.
        const ok = backupProjectForRollback(
          oldProjDir,
          join(backupRoot, entry.oldId)
        );
        if (ok) {
          let removed = false;
          try {
            rmSync(oldProjDir, { recursive: true, force: true });
            removed = true;
          } catch {
            // best-effort; leave the directory rather than partially deleted
          }
          if (removed) {
            evictions.push(entry.oldId);
            evicted++;
            if (entry.action === "skip-converged") converged++;
          }
        }
      }
      continue;
    }

    if (entry.action !== "rename" || !entry.newId) continue;

    // Snapshot the project before the rename so the user can recover if the
    // alias-based rollback ever fails.
    if (backupRoot) {
      backupProjectForRollback(oldProjDir, join(backupRoot, entry.oldId));
    }

    const newProjDir = join(projectsRoot, entry.newId);
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
      addProjectAlias(newProjDir, entry.oldId);
      if (entry.cwd) {
        setProjectPathForDevice(newProjDir, deviceId, entry.cwd);
      }
    } catch {
      // best-effort
    }
    renamed++;
    renames.push({ from: entry.oldId, to: entry.newId });
  }

  return {
    renamed,
    converged,
    evicted,
    visited,
    backupDir: backupRoot,
    renames,
    evictions,
  };
}

// ── v3 identity rollback ──────────────────────────────────────────────────
//
// Reverses the most recent identity rename for every project that has at
// least one alias recorded. Picks the most recently appended alias as the
// target id, renames the project directory back, and pops that entry from
// the alias list. Idempotent: a project with no aliases is left alone.
//
// This is the primary rollback path. The pre-migration backup is a fallback
// for when alias-based rollback can't proceed (e.g. metadata corruption).

export interface RollbackEntry {
  currentId: string;
  restoredId: string;
  ok: boolean;
}

export function rollbackProjectIdentities(): RollbackEntry[] {
  const results: RollbackEntry[] = [];
  const projectsRoot = join(minkRoot(), "projects");
  if (!existsSync(projectsRoot)) return results;

  let entries: string[];
  try {
    entries = readdirSync(projectsRoot);
  } catch {
    return results;
  }

  for (const currentId of entries) {
    const projDir = join(projectsRoot, currentId);
    try {
      if (!statSync(projDir).isDirectory()) continue;
    } catch {
      continue;
    }

    const meta = getProjectMeta(projDir);
    if (!meta || !meta.aliases || meta.aliases.length === 0) continue;

    const restoredId = meta.aliases[meta.aliases.length - 1];
    const targetDir = join(projectsRoot, restoredId);

    if (existsSync(targetDir)) {
      // Refuse to overwrite an existing directory at the target id.
      results.push({ currentId, restoredId, ok: false });
      continue;
    }

    // Pop the alias before renaming so the resulting on-disk metadata file
    // reflects the rolled-back state even if the rename itself succeeds.
    const remainingAliases = meta.aliases.slice(0, -1);
    const metaPath = join(projDir, "project-meta.json");
    try {
      const raw = safeReadJson(metaPath);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const obj = raw as Record<string, unknown>;
        obj.aliases = remainingAliases;
        atomicWriteJson(metaPath, obj);
      }
    } catch {
      // best-effort; rollback continues
    }

    const moved =
      gitSafe(`mv "${projDir}" "${targetDir}"`) !== null ||
      (() => {
        try {
          renameSync(projDir, targetDir);
          return true;
        } catch {
          return false;
        }
      })();

    results.push({ currentId, restoredId, ok: moved });
  }
  return results;
}

export interface MigrateResult {
  ranMigration: boolean;
  fromVersion: number;
  toVersion: number;
  message?: string;
  identity?: IdentityMigrationOutcome;
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
  // Snapshot the identity mode BEFORE the migrating stash below. The stash
  // hides any uncommitted edits to ~/.mink/config — including the very
  // `projects.identity = git-remote` write that should be driving this
  // migration. Reading the flag after the stash would see the stale,
  // last-committed config and the v3 identity step would no-op.
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
    // Pass the pre-stash snapshot of identityMode so we don't re-read the
    // config from a stash-hidden working tree.
    let identity: IdentityMigrationOutcome = {
      renamed: 0,
      converged: 0,
      evicted: 0,
      visited: 0,
      backupDir: null,
      renames: [],
      evictions: [],
    };
    try {
      identity = migrateProjectIdentities(deviceId, identityMode);
    } catch {
      // best-effort; never block the rest of migration
    }

    // Only stamp the version marker once nothing is left to migrate. If we
    // still have pending projects, leave the marker as-is so the next session
    // knows to keep going.
    if (remaining === 0 && listProjectsNeedingMigration().length === 0) {
      writeSyncVersion(MINK_SYNC_VERSION);
    }

    if (
      isSyncInitialized() &&
      (processed > 0 || identity.renamed > 0 || identity.evicted > 0)
    ) {
      // Skip the lock file — it's part of migration coordination, not state.
      gitSafe("add -A");
      gitSafe(`reset HEAD ".sync-migrate.lock"`);
      const identityNote =
        identity.renamed > 0 || identity.evicted > 0
          ? `, ${identity.renamed} renamed + ${identity.evicted} evicted for identity v3`
          : "";
      gitSafe(
        `commit -m "mink: migrate sync layout v${fromVersion} -> v${MINK_SYNC_VERSION} (device ${deviceId.slice(0, 8)}, ${processed} projects${identityNote})"`
      );
    }

    if (stashed) {
      gitSafe("stash pop");
    }

    return {
      ranMigration: true,
      fromVersion,
      toVersion: MINK_SYNC_VERSION,
      identity,
    };
  } finally {
    releaseLock();
  }
}

export function syncMigrateCommand(args: string[] = []): void {
  const dryRun = args.includes("--dry-run");
  const rollback = args.includes("--rollback");

  if (rollback && dryRun) {
    console.error("[mink] --rollback and --dry-run cannot be combined");
    process.exit(1);
  }

  if (dryRun) {
    const plan = planIdentityMigration();
    if (plan.length === 0) {
      console.log(
        "[mink] sync migrate --dry-run: no projects to rename (flag is off or no projects on disk)"
      );
      return;
    }
    const renames = plan.filter((p) => p.action === "rename");
    const converged = plan.filter((p) => p.action === "skip-converged");
    const evictOnly = plan.filter((p) => p.action === "skip-evict");
    const skippedNoCwd = plan.filter((p) => p.action === "skip-no-cwd");
    const unchanged = plan.filter((p) => p.action === "skip-unchanged");

    console.log(
      `[mink] sync migrate --dry-run: ${renames.length} rename(s), ${converged.length} converge (alias + evict), ${evictOnly.length} evict-only, ${skippedNoCwd.length} skipped (no cwd), ${unchanged.length} unchanged`
    );
    for (const p of renames) {
      console.log(`  rename:   ${p.oldId} → ${p.newId}`);
    }
    for (const p of converged) {
      console.log(`  converge: ${p.oldId} → ${p.newId} (record alias on ${p.newId}, evict ${p.oldId} to .identity-rollback/)`);
    }
    for (const p of evictOnly) {
      console.log(`  evict:    ${p.oldId} → .identity-rollback/ (alias already on ${p.newId})`);
    }
    for (const p of skippedNoCwd) {
      console.log(`  skip:     ${p.oldId} — ${p.reason}`);
    }
    return;
  }

  if (rollback) {
    const results = rollbackProjectIdentities();
    if (results.length === 0) {
      console.log("[mink] sync migrate --rollback: nothing to roll back");
      return;
    }
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    console.log(
      `[mink] sync migrate --rollback: ${ok.length} restored, ${failed.length} failed`
    );
    for (const r of ok) {
      console.log(`  restored: ${r.currentId} → ${r.restoredId}`);
    }
    for (const r of failed) {
      console.log(
        `  failed:   ${r.currentId} → ${r.restoredId} (destination already exists or rename blocked)`
      );
    }
    if (ok.length > 0) {
      console.log(
        "\n[mink] tip: set projects.identity=path-derived to prevent the next session-start from re-migrating"
      );
    }
    return;
  }

  const result = migrateSyncLayout();
  if (!result.ranMigration) {
    console.log(`[mink] sync migrate: ${result.message ?? "no-op"}`);
    return;
  }
  console.log(
    `[mink] sync migrate: v${result.fromVersion} → v${result.toVersion} complete`
  );
  const identity = result.identity;
  if (identity && (identity.renamed > 0 || identity.evicted > 0)) {
    console.log(
      `  identity: ${identity.renamed} renamed, ${identity.converged} converged, ${identity.evicted} evicted`
    );
    for (const r of identity.renames) {
      console.log(`    renamed: ${r.from} → ${r.to}`);
    }
    for (const id of identity.evictions) {
      console.log(`    evicted: ${id} → .identity-rollback/`);
    }
    if (identity.backupDir) {
      console.log(`  rollback snapshot: ${identity.backupDir}`);
    }
  }
}
