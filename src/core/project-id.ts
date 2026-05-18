import { createHash } from "crypto";
import { basename, join } from "path";
import { existsSync, readFileSync } from "fs";
import { deriveGitIdentity, getRepoRoot } from "./git-identity";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 6);
}

// Legacy identity: hash of the absolute path. Retained for two reasons:
// 1) The path-derived fallback tier of the new resolver returns this verbatim
//    so non-git directories continue to behave exactly as before.
// 2) The v2→v3 migration computes the prior identifier with this function so
//    it can locate and rename the old per-project state directory.
export function generateProjectId(absolutePath: string): string {
  const normalized = absolutePath.replace(/\/+$/, "");
  const slug = slugify(basename(normalized));
  const hash = shortHash(normalized);
  return `${slug}-${hash}`;
}

// ── Stable-identity resolver ──────────────────────────────────────────────
//
// Three-tier priority order:
//   1. Explicit override file inside the user's repo (.mink/project.json)
//   2. Git-derived: normalized remote URL + repo-root-relative subpath
//   3. Path-derived fallback (legacy generateProjectId)
//
// Gated by the `projects.identity` config key. When the value is
// `path-derived` (default during rollout) the resolver short-circuits to the
// legacy behavior so existing users see no change until they opt in.

export type IdentitySource = "override" | "git-remote" | "path-derived";

export interface ProjectIdentity {
  id: string;
  source: IdentitySource;
}

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const OVERRIDE_RELATIVE_PATH = ".mink/project.json";

export function validateProjectIdentifier(id: unknown): id is string {
  return typeof id === "string" && IDENTIFIER_PATTERN.test(id);
}

// Reads .mink/project.json from the repo containing `cwd` (or `cwd` itself if
// it is not inside a git repo). Returns the validated identifier, or null when
// the file is missing, unreadable, malformed, or declares an invalid identifier.
//
// Malformed overrides are reported once to stderr so the user notices when
// their pin file has been ignored — silent fall-through would let typos linger.
export function readProjectOverride(cwd: string): string | null {
  const root = getRepoRoot(cwd) ?? cwd;
  const overridePath = join(root, OVERRIDE_RELATIVE_PATH);
  if (!existsSync(overridePath)) return null;

  let raw: string;
  try {
    raw = readFileSync(overridePath, "utf-8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    warnInvalidOverride(overridePath, "file is not valid JSON");
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    warnInvalidOverride(overridePath, "expected a JSON object");
    return null;
  }

  const id = (parsed as Record<string, unknown>).projectId;
  if (id === undefined) return null;
  if (!validateProjectIdentifier(id)) {
    warnInvalidOverride(
      overridePath,
      "projectId must start with a letter or digit, contain only [a-z0-9._-], and be 1–128 characters"
    );
    return null;
  }
  return id;
}

const warnedOverrides = new Set<string>();
function warnInvalidOverride(path: string, reason: string): void {
  if (warnedOverrides.has(path)) return;
  warnedOverrides.add(path);
  console.warn(`[mink] ignoring ${path}: ${reason}`);
}

// Returns the git-derived identifier for `cwd` when it lives inside a git repo
// with a normalizable remote. Returns null otherwise so the caller can fall
// through to the path-derived tier.
function gitDerivedIdentity(cwd: string): string | null {
  const components = deriveGitIdentity(cwd);
  if (!components) return null;
  // Slug derives from the normalized remote or subpath — never from the local
  // checkout's directory name — so two clones at differently-named paths
  // produce the same identifier.
  const remoteLeaf = components.remote.split("/").filter((p) => p).pop();
  const slugSource = components.subpath
    ? components.subpath.split("/").pop()!
    : remoteLeaf ?? "project";
  const slug = slugify(slugSource);
  const hash = shortHash(`git:${components.remote}:${components.subpath}`);
  return `${slug}-${hash}`;
}

function readIdentityMode(): "path-derived" | "git-remote" {
  const envOverride = process.env.MINK_PROJECTS_IDENTITY;
  if (envOverride === "git-remote" || envOverride === "path-derived") {
    return envOverride;
  }
  try {
    // Lazy require to avoid a cycle: global-config imports types/config which
    // is small; project-id is imported very widely.
    const { resolveConfigValue } = require("./global-config");
    const v = resolveConfigValue("projects.identity").value;
    if (v === "git-remote") return "git-remote";
  } catch {
    // fall through
  }
  return "path-derived";
}

// Accepts an optional `modeOverride` so callers that have already snapshotted
// `projects.identity` (e.g. the v3 migration, which runs inside a git-stash
// window where the config file's uncommitted writes are hidden from disk) can
// pass the snapshot in. Without the override, the internal mode read can
// disagree with the caller's view of the world and produce the wrong id.
export function resolveProjectIdentity(
  cwd: string,
  modeOverride?: "path-derived" | "git-remote"
): ProjectIdentity {
  const mode = modeOverride ?? readIdentityMode();
  if (mode === "path-derived") {
    return { id: generateProjectId(cwd), source: "path-derived" };
  }

  const override = readProjectOverride(cwd);
  if (override) return { id: override, source: "override" };

  const git = gitDerivedIdentity(cwd);
  if (git) return { id: git, source: "git-remote" };

  return { id: generateProjectId(cwd), source: "path-derived" };
}

export function projectIdFor(cwd: string): string {
  return resolveProjectIdentity(cwd).id;
}
