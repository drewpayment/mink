import { execSync } from "child_process";
import { existsSync, realpathSync } from "fs";

const GIT_TIMEOUT_MS = 2_000;

function gitOut(cwd: string, args: string): string | null {
  if (!existsSync(cwd)) return null;
  try {
    return execSync(`git ${args}`, {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

function canonicalCwd(cwd: string): string {
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

export function getRepoRoot(cwd: string): string | null {
  const root = gitOut(canonicalCwd(cwd), "rev-parse --show-toplevel");
  return root && root.length > 0 ? root : null;
}

export function getRepoSubpath(cwd: string): string {
  const prefix = gitOut(canonicalCwd(cwd), "rev-parse --show-prefix");
  if (prefix === null) return "";
  return prefix.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\/+/, "");
}

// Resolves the project's primary remote URL. Prefers `origin` when present —
// otherwise falls back to the alphabetically-first remote so projects with a
// non-standard remote name still get a stable identity.
export function getRepoRemote(cwd: string): string | null {
  const c = canonicalCwd(cwd);
  const origin = gitOut(c, "config --get remote.origin.url");
  if (origin && origin.length > 0) return origin;

  const list = gitOut(c, "remote");
  if (!list) return null;
  const remotes = list
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .sort();
  if (remotes.length === 0) return null;
  const url = gitOut(c, `config --get remote.${remotes[0]}.url`);
  return url && url.length > 0 ? url : null;
}

// Reduces remote URL forms to a single canonical string so SSH/HTTPS, with or
// without credentials, with or without `.git`, and with mixed host casing all
// collapse to one representation per logical repository.
//
// Examples that all collapse to `github.com/owner/repo`:
//   git@github.com:Owner/Repo.git
//   https://github.com/owner/repo.git
//   https://user:token@github.com/owner/repo
//   ssh://git@github.com/owner/repo/
//
// Returns the original string only if it cannot be parsed — callers can still
// treat that as "no usable remote" and fall back to path-derived identity.
export function normalizeRemoteUrl(url: string): string {
  if (!url) return "";
  let s = url.trim();
  if (s.length === 0) return "";

  // Skip file/local protocol — these aren't shared identities.
  if (/^(file:|\.\.?\/|\/)/i.test(s)) return "";

  // SSH scp-style: git@host:owner/repo(.git) → ssh://git@host/owner/repo
  const scp = s.match(/^([^@\s]+)@([^:\s]+):(.+)$/);
  if (scp) {
    s = `ssh://${scp[1]}@${scp[2]}/${scp[3]}`;
  }

  // Strip leading scheme so we can normalize the rest uniformly.
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");

  // Strip embedded credentials: `user:pass@host/...` → `host/...`
  s = s.replace(/^[^@/]*@/, "");

  // Strip trailing slash and `.git`
  s = s.replace(/\/+$/, "").replace(/\.git$/i, "");

  // Lowercase the entire path. Major forges (GitHub, GitLab, Bitbucket) treat
  // repo names as case-insensitive for URL routing, so two checkouts whose
  // remotes differ only in casing point at the same logical repo. Users on
  // case-sensitive self-hosted forges can pin identity with the override file.
  return s.toLowerCase();
}

export interface GitIdentityComponents {
  remote: string;
  subpath: string;
}

// Returns the (remote, subpath) pair for `cwd` if it lives inside a git repo
// with a normalizable remote. Returns null when the directory is not a git
// repo, has no remote, or the remote URL is a local/file path. Callers should
// fall back to path-derived identity in those cases.
export function deriveGitIdentity(cwd: string): GitIdentityComponents | null {
  const root = getRepoRoot(cwd);
  if (!root) return null;
  const remoteRaw = getRepoRemote(cwd);
  if (!remoteRaw) return null;
  const remote = normalizeRemoteUrl(remoteRaw);
  if (!remote) return null;
  const subpath = getRepoSubpath(cwd);
  return { remote, subpath };
}
