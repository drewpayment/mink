import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { resolveConfigValue } from "./global-config";
import { minkRoot } from "./paths";
import { safeAppendText, atomicWriteText } from "./fs-utils";
import { join } from "path";

export const PACKAGE_NAME = "@drewpayment/mink";
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const NETWORK_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const LOG_MAX_LINES = 1000;

export type UpgradeSource = "manual" | "scheduler";
export type PackageManager = "npm" | "bun";

export type UpgradeResult =
  | { status: "up-to-date"; current: string; latest: string }
  | { status: "update-available"; current: string; latest: string; packageManager?: PackageManager }
  | { status: "would-upgrade"; current: string; latest: string; packageManager: PackageManager; command: string }
  | { status: "upgraded"; from: string; to: string; packageManager: PackageManager }
  | { status: "skipped"; reason: string }
  | { status: "error"; reason: string; transient: boolean };

export interface UpgradeOptions {
  source: UpgradeSource;
  /** Skip the install step; only report whether an upgrade is available. */
  checkOnly?: boolean;
  /** Don't run the install command, but resolve everything else and report what would run. */
  dryRun?: boolean;
  /** Install even if the latest version is not strictly newer. */
  force?: boolean;
  /** Stream the install command's stdio to the parent terminal. False for scheduler runs. */
  interactive?: boolean;
  /** Override the registry URL (for tests). */
  registryUrlOverride?: string;
}

// ── Version compare ─────────────────────────────────────────────────────────

interface ParsedVersion {
  numbers: number[];
  prerelease: string | null;
}

export function parseSemver(input: string): ParsedVersion | null {
  const trimmed = input.trim().replace(/^v/, "");
  if (!trimmed) return null;
  const [versionPart, ...prereleaseParts] = trimmed.split("-");
  const numbers = versionPart.split(".").map((s) => Number.parseInt(s, 10));
  if (numbers.some((n) => Number.isNaN(n))) return null;
  return {
    numbers,
    prerelease: prereleaseParts.length ? prereleaseParts.join("-") : null,
  };
}

/**
 * Compare two semver strings.
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 * A version with a prerelease tag is considered older than the same version without one
 * (e.g. 1.0.0-rc.1 < 1.0.0). Prerelease vs prerelease falls back to lexicographic compare.
 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  const len = Math.max(pa.numbers.length, pb.numbers.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.numbers[i] ?? 0;
    const bi = pb.numbers[i] ?? 0;
    if (ai > bi) return 1;
    if (ai < bi) return -1;
  }

  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  if (pa.prerelease > pb.prerelease) return 1;
  if (pa.prerelease < pb.prerelease) return -1;
  return 0;
}

// ── CLI install path resolution ─────────────────────────────────────────────

export interface CliInstallInfo {
  /** Absolute path to the running cli.js (or src/cli.ts in dev mode). */
  cliPath: string;
  /** Absolute path to the package.json that owns the running CLI. */
  packageJsonPath: string;
  /** Version reported by that package.json. */
  currentVersion: string;
  /** True when running under src/cli.ts via bun/tsx. */
  isDevMode: boolean;
}

/**
 * Resolve the install location of the *running* CLI by walking up from
 * `import.meta.url` until we find a package.json. We treat anything ending
 * in `.ts` or living inside the working source tree as dev mode.
 */
export function getInstallInfo(): CliInstallInfo {
  const selfPath = new URL(import.meta.url).pathname;
  const isDevMode = selfPath.endsWith(".ts");

  // Walk up directories until we find package.json
  let dir = dirname(selfPath);
  let packageJsonPath: string | null = null;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      packageJsonPath = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  if (!packageJsonPath) {
    throw new Error("Unable to locate package.json for the running mink CLI");
  }

  let currentVersion = "0.0.0";
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    if (typeof pkg.version === "string") currentVersion = pkg.version;
  } catch {
    // fall through with 0.0.0
  }

  return {
    cliPath: selfPath,
    packageJsonPath,
    currentVersion,
    isDevMode,
  };
}

// ── Registry fetch ──────────────────────────────────────────────────────────

async function fetchLatestVersion(
  url: string,
  currentVersion: string
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": `mink-self-update/${currentVersion}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      throw new Error(`registry returned ${res.status}`);
    }
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version !== "string") {
      throw new Error("registry response missing version field");
    }
    return body.version;
  } finally {
    clearTimeout(timer);
  }
}

// ── Package manager detection ───────────────────────────────────────────────

function isOnPath(bin: string): boolean {
  const result = spawnSync(bin, ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

export function detectPackageManager(cliPath: string): PackageManager | null {
  // Honor explicit user override first.
  const configured = resolveConfigValue("cli.auto-update-package-manager").value;
  if (configured === "bun" && isOnPath("bun")) return "bun";
  if (configured === "npm" && isOnPath("npm")) return "npm";

  // Auto-detect: prefer bun if the install path looks bun-ish (e.g. ~/.bun/install).
  const looksLikeBun = /[\\/]\.bun[\\/]/.test(cliPath);
  if (looksLikeBun && isOnPath("bun")) return "bun";

  if (isOnPath("npm")) return "npm";
  if (isOnPath("bun")) return "bun";
  return null;
}

function buildInstallCommand(pm: PackageManager, version: string): string[] {
  const ref = `${PACKAGE_NAME}@${version}`;
  if (pm === "bun") return ["bun", "add", "-g", ref];
  return ["npm", "install", "-g", ref];
}

// ── Logging ─────────────────────────────────────────────────────────────────

export function selfUpdateLogPath(): string {
  return join(minkRoot(), "self-update.log");
}

function appendLogEntry(entry: Record<string, unknown>): void {
  const path = selfUpdateLogPath();
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + "\n";
  try {
    safeAppendText(path, line);
    rotateLogIfNeeded(path);
  } catch {
    // Logging failures must not crash the upgrade flow.
  }
}

function rotateLogIfNeeded(path: string): void {
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");
    if (lines.length <= LOG_MAX_LINES + 1) return;
    const trimmed = lines.slice(lines.length - LOG_MAX_LINES - 1).join("\n");
    atomicWriteText(path, trimmed);
  } catch {
    // ignore — best effort
  }
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function runSelfUpgrade(opts: UpgradeOptions): Promise<UpgradeResult> {
  const result = await runSelfUpgradeInner(opts);
  appendLogEntry({ source: opts.source, ...result });
  return result;
}

async function runSelfUpgradeInner(opts: UpgradeOptions): Promise<UpgradeResult> {
  // 1. Hard kill switch.
  if (process.env.MINK_DISABLE_AUTO_UPDATE === "1" && opts.source === "scheduler") {
    return { status: "skipped", reason: "MINK_DISABLE_AUTO_UPDATE=1" };
  }

  // 2. Scheduler runs respect the cli.auto-update flag; manual runs do not.
  if (opts.source === "scheduler") {
    const enabled = resolveConfigValue("cli.auto-update").value;
    if (enabled !== "true") {
      return { status: "skipped", reason: "cli.auto-update is disabled" };
    }
  }

  // 3. Resolve install info.
  let info: CliInstallInfo;
  try {
    info = getInstallInfo();
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : String(err),
      transient: false,
    };
  }

  // 4. Dev-mode guard — never auto-mutate the working source tree.
  if (info.isDevMode) {
    return {
      status: "skipped",
      reason: "running from source tree; refuse to self-upgrade in dev mode",
    };
  }

  // 5. Fetch latest from registry.
  let latest: string;
  try {
    latest = await fetchLatestVersion(
      opts.registryUrlOverride ?? NPM_REGISTRY_URL,
      info.currentVersion
    );
  } catch (err) {
    return {
      status: "error",
      reason:
        "failed to fetch latest version: " +
        (err instanceof Error ? err.message : String(err)),
      transient: true,
    };
  }

  // 6. Compare versions.
  const cmp = compareSemver(latest, info.currentVersion);
  if (cmp <= 0 && !opts.force) {
    return { status: "up-to-date", current: info.currentVersion, latest };
  }

  // 7. Resolve package manager (needed even for dry-run output).
  const pm = detectPackageManager(info.cliPath);
  if (!pm) {
    return {
      status: "error",
      reason: "no package manager (npm or bun) available on PATH",
      transient: false,
    };
  }

  const cmd = buildInstallCommand(pm, latest);

  if (opts.checkOnly) {
    return {
      status: "update-available",
      current: info.currentVersion,
      latest,
      packageManager: pm,
    };
  }

  if (opts.dryRun) {
    return {
      status: "would-upgrade",
      current: info.currentVersion,
      latest,
      packageManager: pm,
      command: cmd.join(" "),
    };
  }

  // 8. Run install.
  const stdio = opts.interactive ? "inherit" : "pipe";
  const spawned = spawnSync(cmd[0], cmd.slice(1), {
    stdio,
    timeout: INSTALL_TIMEOUT_MS,
  });
  if (spawned.error) {
    return {
      status: "error",
      reason: `install command failed to spawn: ${spawned.error.message}`,
      transient: true,
    };
  }
  if (spawned.status !== 0) {
    const stderr = spawned.stderr ? spawned.stderr.toString().trim() : "";
    return {
      status: "error",
      reason: `${cmd.join(" ")} exited with code ${spawned.status}${stderr ? ": " + stderr.slice(0, 500) : ""}`,
      transient: true,
    };
  }

  // 9. Verify post-install version by re-reading the on-disk package.json.
  let verifiedVersion = latest;
  try {
    const pkg = JSON.parse(readFileSync(info.packageJsonPath, "utf-8"));
    if (typeof pkg.version === "string") verifiedVersion = pkg.version;
  } catch {
    // package may have been replaced and the path may be stale; trust latest
  }

  return {
    status: "upgraded",
    from: info.currentVersion,
    to: verifiedVersion,
    packageManager: pm,
  };
}
