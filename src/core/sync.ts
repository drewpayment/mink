import { existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { minkRoot, syncVersionPath } from "./paths";
import { resolveConfigValue, setConfigValue } from "./global-config";
import { updateDeviceHeartbeat } from "./device";
import { parkConflictingState } from "./conflict-park";

// ── Constants ──────────────────────────────────────────────────────────────

const GIT_TIMEOUT = 5_000;
const PUSH_TIMEOUT = 10_000;
const FETCH_TIMEOUT = 15_000;

// Sync layout version. Bumped when the on-disk shape of `~/.mink/` changes in
// a way that older devices cannot read. Migration runs on first session-start
// after upgrade when readSyncVersion() < MINK_SYNC_VERSION.
//
// v1 → v2: per-device shards under projects/<id>/state/<deviceId>/
// v2 → v3: stable identity — adds aliases[] and pathsByDevice{} on project-meta;
//          when projects.identity=git-remote, renames per-project directories
//          from path-derived IDs to git-derived IDs and records prior ID as
//          alias. Migration is a no-op when the flag is off.
export const MINK_SYNC_VERSION = 3;

export function readSyncVersion(): number {
  try {
    const raw = readFileSync(syncVersionPath(), "utf-8").trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  } catch {
    // Pre-versioned repos default to v1.
    return 1;
  }
}

export function writeSyncVersion(version: number): void {
  writeFileSync(syncVersionPath(), `${version}\n`);
}

const GITIGNORE_CONTENTS = `# Runtime state — machine-specific
scheduler.pid
scheduler.log
channel.pid
channel.log

# Device identity and local config — machine-specific
device-id
config.local

# Migration coordination — never sync this
.sync-migrate.lock

# Local backups and per-device caches — machine-specific snapshots
projects/*/backups/
projects/*/session.json
projects/*/scheduler-manifest.json
projects/*/design-captures/
projects/*/.mink-state-counters.json

# Wiki derived/regenerable pages — each device rebuilds locally
wiki/_index.md
wiki/.mink-index.json
wiki/projects/*/conventions.md
wiki/projects/*/architecture.md
`;

const GITATTRIBUTES_CONTENTS = `# Sync v2 — merge drivers eliminate conflicts on shared files.
# Drivers are registered in .git/config by ensureMergeDriversRegistered().
projects/*/file-index.json merge=mink-json-union
projects/*/learning-memory.*.md merge=union
projects/*/learning-memory.md merge=mink-learning-memory
wiki/areas/daily/*.md merge=union
wiki/projects/*/sessions/*.md merge=union
devices.json merge=mink-devices
`;

// ── Helpers ────────────────────────────────────────────────────────────────

function git(args: string, timeoutMs: number = GIT_TIMEOUT): string {
  return execSync(`git ${args}`, {
    cwd: minkRoot(),
    timeout: timeoutMs,
    stdio: ["pipe", "pipe", "pipe"],
  }).toString().trim();
}

function gitSafe(args: string, timeoutMs: number = GIT_TIMEOUT): string | null {
  try {
    return git(args, timeoutMs);
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export function isSyncInitialized(): boolean {
  const enabled = resolveConfigValue("sync.enabled").value;
  if (enabled !== "true") return false;
  return existsSync(join(minkRoot(), ".git"));
}

export function ensureGitignore(): void {
  const gitignorePath = join(minkRoot(), ".gitignore");
  writeFileSync(gitignorePath, GITIGNORE_CONTENTS);
}

export function ensureGitAttributes(): void {
  const path = join(minkRoot(), ".gitattributes");
  writeFileSync(path, GITATTRIBUTES_CONTENTS);
}

const MERGE_DRIVERS = [
  "mink-json-union",
  "mink-learning-memory",
  "mink-devices",
] as const;

// Register the custom merge drivers in the local repo's .git/config so git
// invokes `mink sync merge-driver <name>` whenever it encounters a conflict
// on a path matched by .gitattributes. We point at the absolute path to the
// currently-running mink CLI so a stale registration after npm relinks gets
// refreshed every time `ensureMergeDriversRegistered()` runs.
export function ensureMergeDriversRegistered(): void {
  const cliPath = process.argv[1] ?? "mink";
  for (const name of MERGE_DRIVERS) {
    const command = `${cliPath} sync merge-driver ${name} %O %A %B %P`;
    gitSafe(`config merge.${name}.name "Mink ${name}"`);
    gitSafe(`config merge.${name}.driver "${command}"`);
    gitSafe(`config merge.${name}.recursive binary`);
  }
}

export interface SyncStatusInfo {
  enabled: boolean;
  gitInitialized: boolean;
  remoteUrl: string;
  lastPush: string;
  lastPull: string;
  pendingChanges: number;
  branch: string;
}

export function getSyncStatus(): SyncStatusInfo {
  const enabled = resolveConfigValue("sync.enabled").value === "true";
  const gitInitialized = existsSync(join(minkRoot(), ".git"));
  const remoteUrl = resolveConfigValue("sync.remote-url").value;
  const lastPush = resolveConfigValue("sync.last-push").value;
  const lastPull = resolveConfigValue("sync.last-pull").value;

  let pendingChanges = 0;
  let branch = "";

  if (gitInitialized) {
    const status = gitSafe("status --porcelain");
    if (status !== null) {
      pendingChanges = status
        .split("\n")
        .filter((l) => l.trim().length > 0).length;
    }
    branch = gitSafe("rev-parse --abbrev-ref HEAD") ?? "";
  }

  return {
    enabled,
    gitInitialized,
    remoteUrl,
    lastPush,
    lastPull,
    pendingChanges,
    branch,
  };
}

export function initSync(remoteUrl: string): void {
  const root = minkRoot();
  const gitDir = join(root, ".git");

  if (existsSync(gitDir)) {
    console.log("[mink] sync is already initialized in " + root);
    console.log("[mink] run 'mink sync disconnect' first to reinitialize");
    return;
  }

  // Write .gitignore before any git operations
  ensureGitignore();

  // Initialize git repo
  git("init");
  git(`remote add origin ${remoteUrl}`);

  // Install merge drivers + attributes now that .git exists. Drivers must be
  // registered before the first pull so any incoming conflicts can be auto-
  // resolved without surfacing to the user.
  ensureGitAttributes();
  ensureMergeDriversRegistered();

  // Try to fetch from remote
  const fetchResult = gitSafe("fetch origin", FETCH_TIMEOUT);

  if (fetchResult !== null) {
    // Check if remote has any branches
    const remoteBranches = gitSafe("branch -r");
    if (remoteBranches && remoteBranches.trim().length > 0) {
      // Remote has content — detect default branch and pull
      const defaultBranch = detectRemoteDefaultBranch();
      try {
        git("add -A");
        // Commit local content first so merge has a base
        const status = gitSafe("status --porcelain");
        if (status && status.trim().length > 0) {
          git(`commit -m "mink: local state before sync"`);
        }
        git(`pull --rebase origin ${defaultBranch}`, FETCH_TIMEOUT);
      } catch {
        // Rebase failed — abort and warn
        gitSafe("rebase --abort");
        console.error(
          "[mink] warning: could not merge remote content. Local state preserved."
        );
        console.error(
          "[mink] you may need to resolve conflicts manually with 'mink sync pull'"
        );
      }
    } else {
      // Remote is empty — do initial push
      git("add -A");
      git(`commit -m "mink: initial sync"`);
      git("branch -M main");
      git("push -u origin main", PUSH_TIMEOUT);
    }
  } else {
    // Fetch failed (network or empty repo) — commit locally and try push
    git("add -A");
    git(`commit -m "mink: initial sync"`);
    git("branch -M main");
    try {
      git("push -u origin main", PUSH_TIMEOUT);
    } catch {
      console.error(
        "[mink] push failed — local commit preserved, will retry on next sync"
      );
    }
  }

  // Save config
  setConfigValue("sync.enabled", "true");
  setConfigValue("sync.remote-url", remoteUrl);
  setConfigValue("sync.last-push", new Date().toISOString());

  console.log("[mink] sync initialized successfully");
  console.log("[mink] remote: " + remoteUrl);
  console.log("[mink] auto-sync: pull on session-start, push on session-stop");
  console.log("[mink] manual sync: run 'mink sync' at any time");
}

// Sync v2 helper: fetch + merge --no-edit using the registered merge drivers.
// Anything still conflicting after the drivers run gets parked to a hidden
// ref so sync can never block. Returns true on a clean merge.
function attemptMergeOrPark(
  branch: string,
  reason: string,
  onMessage: (msg: string) => void
): boolean {
  try {
    git(`merge --no-edit origin/${branch}`, FETCH_TIMEOUT);
    return true;
  } catch {
    const parked = parkConflictingState(reason);
    if (parked) {
      onMessage(
        `[mink] sync: parked conflicting state to ${parked} — sync continues, run 'mink sync reconcile list' to inspect`
      );
    }
    return false;
  }
}

export function syncPull(
  onMessage: (msg: string) => void = (msg) => console.error(msg)
): void {
  if (!isSyncInitialized()) return;

  ensureGitignore();
  ensureGitAttributes();
  ensureMergeDriversRegistered();

  try {
    // Stash any uncommitted local changes as safety net
    const status = gitSafe("status --porcelain");
    const hasLocalChanges = status !== null && status.trim().length > 0;

    if (hasLocalChanges) {
      gitSafe("stash push -m mink-sync-pull");
    }

    // Determine branch
    const branch = gitSafe("rev-parse --abbrev-ref HEAD") ?? "main";

    // Fetch + merge --no-edit. Custom merge drivers (file-index union,
    // learning-memory section merge, devices registry union) resolve every
    // anticipated conflict; anything left over gets parked to a hidden ref
    // and the working tree advances to upstream HEAD so sync never gets stuck.
    const fetched = gitSafe(`fetch origin ${branch}`, FETCH_TIMEOUT);
    if (fetched !== null) {
      attemptMergeOrPark(branch, "pull", onMessage);
    } else {
      onMessage(
        "[mink] sync pull: fetch failed (network or auth) — local state preserved"
      );
    }

    // Pop stash if we stashed earlier
    if (hasLocalChanges) {
      try {
        gitSafe("stash pop");
      } catch {
        onMessage(
          "[mink] sync pull: stash pop had conflicts — your local changes are in git stash"
        );
      }
    }

    setConfigValue("sync.last-pull", new Date().toISOString());

    try { updateDeviceHeartbeat(); } catch { /* never crash hooks */ }
  } catch (err) {
    onMessage(
      `[mink] sync pull error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function syncPush(
  onMessage: (msg: string) => void = (msg) => console.error(msg)
): void {
  if (!isSyncInitialized()) return;

  ensureGitignore();
  ensureGitAttributes();
  ensureMergeDriversRegistered();
  try {
    updateDeviceHeartbeat();
  } catch {
    /* never crash hooks */
  }

  try {
    const status = gitSafe("status --porcelain");
    const hasChanges = status !== null && status.trim().length > 0;
    const branch = gitSafe("rev-parse --abbrev-ref HEAD") ?? "main";

    if (hasChanges) {
      git("add -A");
      const now = new Date();
      const timestamp = now.toISOString().replace("T", " ").slice(0, 16);
      gitSafe(`commit -m "mink: sync ${timestamp}"`);
    }

    // Reconcile with remote before pushing. Custom merge drivers handle
    // anticipated conflicts; anything they can't is parked to a hidden ref.
    const fetched = gitSafe(`fetch origin ${branch}`, FETCH_TIMEOUT);
    if (fetched !== null) {
      attemptMergeOrPark(branch, "push", onMessage);
    }

    // Push. Single retry on rejection (race with a simultaneous push from
    // another device). After that we leave the commit local for next session
    // — matches spec 15's push-failure handling.
    try {
      git(`push origin ${branch}`, PUSH_TIMEOUT);
      setConfigValue("sync.last-push", new Date().toISOString());
    } catch {
      const refetched = gitSafe(`fetch origin ${branch}`, FETCH_TIMEOUT);
      if (refetched !== null) {
        attemptMergeOrPark(branch, "push-retry", onMessage);
      }
      try {
        git(`push origin ${branch}`, PUSH_TIMEOUT);
        setConfigValue("sync.last-push", new Date().toISOString());
      } catch {
        onMessage(
          "[mink] sync push failed — local commit preserved, will retry next session"
        );
      }
    }
  } catch (err) {
    onMessage(
      `[mink] sync push error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export function disconnectSync(): void {
  const root = minkRoot();
  const gitDir = join(root, ".git");

  if (!existsSync(gitDir)) {
    console.log("[mink] sync is not initialized — nothing to disconnect");
    return;
  }

  // Remove .git directory
  const { rmSync } = require("fs");
  rmSync(gitDir, { recursive: true, force: true });

  // Clear sync config keys
  setConfigValue("sync.enabled", "false");
  setConfigValue("sync.remote-url", "");
  setConfigValue("sync.last-push", "");
  setConfigValue("sync.last-pull", "");

  console.log("[mink] sync disconnected — git tracking removed, data preserved");
}

// ── Internal Helpers ───────────────────────────────────────────────────────

function detectRemoteDefaultBranch(): string {
  // Try common default branch names
  const remoteBranches = gitSafe("branch -r") ?? "";
  if (remoteBranches.includes("origin/main")) return "main";
  if (remoteBranches.includes("origin/master")) return "master";

  // Fall back to first remote branch
  const first = remoteBranches
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b.startsWith("origin/") && !b.includes("HEAD"))
    .map((b) => b.replace("origin/", ""))[0];

  return first ?? "main";
}
