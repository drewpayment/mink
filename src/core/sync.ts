import { existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { minkRoot } from "./paths";
import { resolveConfigValue, setConfigValue } from "./global-config";
import { updateDeviceHeartbeat } from "./device";

// ── Constants ──────────────────────────────────────────────────────────────

const GIT_TIMEOUT = 5_000;
const PUSH_TIMEOUT = 10_000;
const FETCH_TIMEOUT = 15_000;

const GITIGNORE_CONTENTS = `# Runtime state — machine-specific
scheduler.pid
scheduler.log

# Device identity and local config — machine-specific
device-id
config.local

# Local backups — machine-specific snapshots
projects/*/backups/
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

export function syncPull(
  onMessage: (msg: string) => void = (msg) => console.error(msg)
): void {
  if (!isSyncInitialized()) return;

  ensureGitignore();

  const root = minkRoot();

  try {
    // Stash any uncommitted local changes as safety net
    const status = gitSafe("status --porcelain");
    const hasLocalChanges = status !== null && status.trim().length > 0;

    if (hasLocalChanges) {
      gitSafe("stash push -m mink-sync-pull");
    }

    // Determine branch
    const branch = gitSafe("rev-parse --abbrev-ref HEAD") ?? "main";

    // Pull with rebase
    try {
      git(`pull --rebase origin ${branch}`, FETCH_TIMEOUT);
    } catch (err) {
      // Check if rebase is in progress and abort
      if (existsSync(join(root, ".git", "rebase-merge")) ||
          existsSync(join(root, ".git", "rebase-apply"))) {
        gitSafe("rebase --abort");
        onMessage(
          "[mink] sync pull: rebase conflict detected — aborted rebase, local state preserved"
        );
        onMessage(
          "[mink] resolve manually with 'mink sync pull' or 'cd ~/.mink && git pull --rebase origin main'"
        );
      } else {
        onMessage(
          `[mink] sync pull failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
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
  try { updateDeviceHeartbeat(); } catch { /* never crash hooks */ }

  const root = minkRoot();

  try {
    // Check for changes
    const status = gitSafe("status --porcelain");
    if (!status || !status.trim()) {
      // No local changes — still try to push any unpushed commits
      const branch = gitSafe("rev-parse --abbrev-ref HEAD") ?? "main";
      try {
        git(`push origin ${branch}`, PUSH_TIMEOUT);
        setConfigValue("sync.last-push", new Date().toISOString());
      } catch {
        // No unpushed commits or network error — silent
      }
      return;
    }

    // Stage all changes (respects .gitignore)
    git("add -A");

    // Commit
    const now = new Date();
    const timestamp = now.toISOString().replace("T", " ").slice(0, 16);
    git(`commit -m "mink: sync ${timestamp}"`);

    // Determine branch
    const branch = gitSafe("rev-parse --abbrev-ref HEAD") ?? "main";

    // Pull with rebase to reconcile any remote changes
    try {
      git(`pull --rebase origin ${branch}`, FETCH_TIMEOUT);
    } catch {
      // Check for rebase conflict
      if (existsSync(join(root, ".git", "rebase-merge")) ||
          existsSync(join(root, ".git", "rebase-apply"))) {
        gitSafe("rebase --abort");
        onMessage(
          "[mink] sync: rebase conflict during push — local commit preserved, skipping push"
        );
        onMessage(
          "[mink] resolve manually with 'mink sync pull' then 'mink sync push'"
        );
        return;
      }
    }

    // Push (best-effort)
    try {
      git(`push origin ${branch}`, PUSH_TIMEOUT);
      setConfigValue("sync.last-push", new Date().toISOString());
    } catch {
      onMessage(
        "[mink] sync push failed — local commit preserved, will retry next session"
      );
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
