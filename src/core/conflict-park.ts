import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { minkRoot } from "./paths";
import { getOrCreateDeviceId } from "./device";

const GIT_TIMEOUT = 5_000;

function git(args: string): string {
  return execSync(`git ${args}`, {
    cwd: minkRoot(),
    timeout: GIT_TIMEOUT,
    stdio: ["pipe", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

function gitSafe(args: string): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

// Park the current local state onto a hidden ref so an unresolvable merge
// never blocks sync. Sequence:
//   1. If a merge is in progress, abort it cleanly (`git merge --abort`).
//   2. Save HEAD as `refs/mink/conflicts/<deviceId>/<iso-utc>`.
//   3. Hard-reset working tree to upstream (origin/<branch>) so subsequent
//      writes start from a clean, fast-forwardable state.
// Returns the parked refname (or null if the operation was a no-op or failed —
// callers must NEVER throw on the result).
export function parkConflictingState(reason: string): string | null {
  const root = minkRoot();
  const inMerge =
    existsSync(join(root, ".git", "MERGE_HEAD")) ||
    existsSync(join(root, ".git", "rebase-merge")) ||
    existsSync(join(root, ".git", "rebase-apply"));

  if (inMerge) {
    gitSafe("merge --abort");
    gitSafe("rebase --abort");
  }

  const branch = gitSafe("rev-parse --abbrev-ref HEAD") ?? "main";
  const upstream = `origin/${branch}`;

  // Don't park if there's nothing to save (HEAD already matches upstream).
  const headSha = gitSafe("rev-parse HEAD");
  const upstreamSha = gitSafe(`rev-parse ${upstream}`);
  if (headSha && headSha === upstreamSha) {
    return null;
  }

  const deviceId = getOrCreateDeviceId();
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  const ref = `refs/mink/conflicts/${deviceId}/${iso}`;

  if (!headSha) return null;

  if (gitSafe(`update-ref ${ref} ${headSha}`) === null) {
    return null;
  }
  gitSafe(`reset --hard ${upstream}`);

  return ref;
}

// List previously-parked conflict refs. Used by `mink sync reconcile list`.
export function listParkedConflicts(): string[] {
  const out = gitSafe("for-each-ref --format=%(refname) refs/mink/conflicts");
  if (!out) return [];
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("refs/mink/conflicts/"));
}

export function dropParkedConflict(ref: string): boolean {
  if (!ref.startsWith("refs/mink/conflicts/")) return false;
  return gitSafe(`update-ref -d ${ref}`) !== null;
}
