import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { projectIdFor } from "./project-id";

// Resolved per-call so tests can override via MINK_ROOT_OVERRIDE without
// reloading modules. Production callers get the default homedir/.mink path.
function resolveMinkRoot(): string {
  return process.env.MINK_ROOT_OVERRIDE || join(homedir(), ".mink");
}

const MINK_ROOT = resolveMinkRoot();

export function minkRoot(): string {
  // Re-resolve when the test override is in play so individual tests can
  // point at their own temp dir without contaminating each other.
  if (process.env.MINK_ROOT_OVERRIDE) {
    return process.env.MINK_ROOT_OVERRIDE;
  }
  return MINK_ROOT;
}

// Locates the on-disk project state directory for `cwd`. Walks the alias list
// when the primary identifier's directory does not exist, so historical
// references (notes, dashboard URLs) keep resolving after a v3 migration
// renames the project directory.
export function projectDir(cwd: string): string {
  const id = projectIdFor(cwd);
  const primary = join(minkRoot(), "projects", id);
  if (existsSync(primary)) return primary;
  // Lazy require: project-registry imports paths, so a top-level import would
  // create a cycle. Only walk aliases on a cold miss.
  try {
    const { findProjectDirByIdOrAlias } = require("./project-registry");
    const aliased = findProjectDirByIdOrAlias(id);
    if (aliased) return aliased;
  } catch {
    // best-effort
  }
  return primary;
}

export function sessionPath(cwd: string): string {
  return join(projectDir(cwd), "session.json");
}

export function fileIndexPath(cwd: string): string {
  return join(projectDir(cwd), "file-index.json");
}

export function configPath(cwd: string): string {
  return join(projectDir(cwd), "config.json");
}

export function learningMemoryPath(cwd: string): string {
  return join(projectDir(cwd), "learning-memory.md");
}

export function tokenLedgerPath(cwd: string): string {
  return join(projectDir(cwd), "token-ledger.json");
}

export function tokenLedgerArchivePath(cwd: string): string {
  return join(projectDir(cwd), "token-ledger-archive.json");
}

export function bugMemoryPath(cwd: string): string {
  return join(projectDir(cwd), "bug-memory.json");
}

export function actionLogPath(cwd: string): string {
  return join(projectDir(cwd), "action-log.md");
}

export function schedulerPidPath(): string {
  return join(minkRoot(), "scheduler.pid");
}

export function schedulerLogPath(): string {
  return join(minkRoot(), "scheduler.log");
}

export function schedulerManifestPath(cwd: string): string {
  return join(projectDir(cwd), "scheduler-manifest.json");
}

export function channelPidPath(): string {
  return join(minkRoot(), "channel.pid");
}

export function channelLogPath(): string {
  return join(minkRoot(), "channel.log");
}

export function globalConfigPath(): string {
  return join(minkRoot(), "config");
}

export function localConfigPath(): string {
  return join(minkRoot(), "config.local");
}

export function deviceIdPath(): string {
  return join(minkRoot(), "device-id");
}

export function deviceRegistryPath(): string {
  return join(minkRoot(), "devices.json");
}

export function projectMetaPath(cwd: string): string {
  return join(projectDir(cwd), "project-meta.json");
}

export function backupDirPath(cwd: string): string {
  return join(projectDir(cwd), "backups");
}

// ── Sync v2 — shard-aware paths ────────────────────────────────────────────
// Per-device shards isolate machine-rewritten state files so two devices never
// write to the same path. Aggregators in state-aggregator.ts compose the
// authoritative view by reading every device's shard plus the legacy paths
// above. The legacy helpers (tokenLedgerPath, bugMemoryPath, actionLogPath,
// tokenLedgerArchivePath) remain valid for fallback reads during the migration
// window — they are NOT removed.

export function syncVersionPath(): string {
  return join(minkRoot(), ".mink-sync-version");
}

export function projectStateDir(cwd: string): string {
  return join(projectDir(cwd), "state");
}

export function deviceShardDir(cwd: string, deviceId: string): string {
  return join(projectStateDir(cwd), deviceId);
}

export function tokenLedgerShardPath(cwd: string, deviceId: string): string {
  return join(deviceShardDir(cwd, deviceId), "token-ledger.json");
}

export function tokenLedgerArchiveShardPath(cwd: string, deviceId: string): string {
  return join(deviceShardDir(cwd, deviceId), "token-ledger-archive.json");
}

export function bugMemoryShardPath(cwd: string, deviceId: string): string {
  return join(deviceShardDir(cwd, deviceId), "bug-memory.json");
}

export function actionLogShardPath(cwd: string, deviceId: string): string {
  return join(deviceShardDir(cwd, deviceId), "action-log.md");
}

export function learningMemorySidecarPath(cwd: string, deviceId: string): string {
  return join(projectDir(cwd), `learning-memory.${deviceId}.md`);
}

// Per-device telemetry counters split out of file-index.json (gitignored, not synced).
export function fileIndexCountersPath(cwd: string): string {
  return join(projectDir(cwd), ".mink-state-counters.json");
}

export function designCapturesDir(cwd: string): string {
  return join(projectDir(cwd), "design-captures");
}

export function designReportPath(cwd: string): string {
  return join(projectDir(cwd), "design-report.json");
}

export function frameworkAdvisorPath(cwd: string): string {
  return join(projectDir(cwd), "framework-advisor.md");
}

export function frameworkAdvisorJsonPath(cwd: string): string {
  return join(projectDir(cwd), "framework-advisor.json");
}
