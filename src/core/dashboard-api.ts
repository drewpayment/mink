import { existsSync, readFileSync } from "fs";
import {
  projectDir,
  fileIndexPath,
  tokenLedgerPath,
  bugMemoryPath,
  actionLogPath,
  learningMemoryPath,
  projectMetaPath,
  sessionPath,
  configPath,
  schedulerManifestPath,
  designReportPath,
} from "./paths";
import { safeReadJson } from "./fs-utils";
import { isFileIndex } from "./index-store";
import { loadLedger } from "./token-ledger";
import { parseLearningMemory } from "./learning-memory";
import { loadBugMemory } from "./bug-memory";
import { safeReadLog, parseLogSessions } from "./action-log";
import { getDaemonStatus, startDaemon, stopDaemon } from "./daemon";
import { loadManifest, removeFromDeadLetter, saveManifest } from "./scheduler";
import { getBuiltInTasks, executeTask } from "./task-registry";
import {
  resolveAllConfig,
  setConfigValue,
  resetConfigKey,
  resetAllConfig,
} from "./global-config";
import {
  getSyncStatus,
  syncPull,
  syncPush,
  disconnectSync,
  isSyncInitialized,
} from "./sync";
import {
  getChannelStatus,
  getChannelLogs,
  startChannelProcess,
  stopChannelProcess,
  isChannelRunning,
} from "./channel-process";
import { resolveConfigValue } from "./global-config";
import { resolveVaultPath, isVaultInitialized } from "./vault";
import type { ChannelPlatform } from "../types/channel";
import { minkRoot } from "./paths";
import { execSync } from "child_process";
import { isValidConfigKey, CONFIG_KEYS } from "../types/config";
import type { ConfigKey } from "../types/config";
import type {
  OverviewPayload,
  TokenLedgerPayload,
  FileIndexPayload,
  SchedulerPayload,
  BugLogPayload,
  ActionLogPayload,
  ActionResult,
  FileStatus,
  DesignPayload,
  ConfigPanelPayload,
  ConfigEntry,
  ConfigValueSource,
  ConfigValueType,
  SyncPanelPayload,
  SyncPendingChange,
  ChannelPanelPayload,
  ChannelLogLine,
} from "../types/dashboard";
import { isDesignEvalReport } from "../types/design-eval";
import type { DesignEvalReport } from "../types/design-eval";
import type { FileIndex, FileIndexEntry } from "../types/file-index";
import type { LearningMemory } from "../types/learning-memory";

// ── Secret Masking ─────────────────────────────────────────────────────────

const SECRET_KEY_PATTERNS = [/token/i, /secret/i, /password/i, /api[-_]?key/i];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

export function maskSecret(value: string, showLast: number = 4): string {
  if (!value) return "";
  if (value.length <= showLast) return "••••";
  return "••••" + value.slice(-showLast);
}

// ── File Status Checks ─────────────────────────────────────────────────────

function checkJsonFile(
  name: string,
  filePath: string,
  validator?: (v: unknown) => boolean
): FileStatus {
  if (!existsSync(filePath)) return { name, status: "missing" };
  const data = safeReadJson(filePath);
  if (data === null) return { name, status: "corrupt" };
  if (validator && !validator(data)) return { name, status: "corrupt" };
  return { name, status: "ok" };
}

function checkTextFile(name: string, filePath: string): FileStatus {
  if (!existsSync(filePath)) return { name, status: "missing" };
  try {
    readFileSync(filePath, "utf-8");
    return { name, status: "ok" };
  } catch {
    return { name, status: "corrupt" };
  }
}

// ── Panel Loaders ──────────────────────────────────────────────────────────

export function loadOverview(cwd: string): OverviewPayload {
  // Project metadata
  let project: OverviewPayload["project"] = null;
  const meta = safeReadJson(projectMetaPath(cwd)) as {
    name?: string;
    description?: string;
  } | null;
  if (meta && typeof meta === "object") {
    project = {
      name: meta.name ?? "Unknown",
      description: meta.description ?? "",
      cwd,
    };
  }

  // Daemon status
  const daemonStatus = getDaemonStatus(cwd);
  const daemon: OverviewPayload["daemon"] = {
    running: daemonStatus.running,
    pid: daemonStatus.pid,
    startedAt: daemonStatus.startedAt,
    uptimeMs: daemonStatus.startedAt
      ? Date.now() - new Date(daemonStatus.startedAt).getTime()
      : undefined,
  };

  // Token ledger summary
  const ledger = loadLedger(tokenLedgerPath(cwd));
  const summary = {
    totalSessions: ledger.lifetime.totalSessions,
    totalTokens: ledger.lifetime.totalTokens,
    totalReads: ledger.lifetime.totalReads,
    totalWrites: ledger.lifetime.totalWrites,
    estimatedSavings: ledger.lifetime.totalEstimatedSavings,
  };

  // State file health
  const stateFiles: FileStatus[] = [
    checkJsonFile("session.json", sessionPath(cwd)),
    checkJsonFile("file-index.json", fileIndexPath(cwd), isFileIndex),
    checkJsonFile("config.json", configPath(cwd)),
    checkTextFile("learning-memory.md", learningMemoryPath(cwd)),
    checkJsonFile("token-ledger.json", tokenLedgerPath(cwd)),
    checkJsonFile("bug-memory.json", bugMemoryPath(cwd)),
    checkTextFile("action-log.md", actionLogPath(cwd)),
    checkJsonFile("scheduler-manifest.json", schedulerManifestPath(cwd)),
  ];

  return { project, daemon, summary, stateFiles };
}

export function loadTokenLedgerPanel(cwd: string): TokenLedgerPayload {
  const ledger = loadLedger(tokenLedgerPath(cwd));
  return {
    lifetime: ledger.lifetime,
    sessions: ledger.sessions,
    wasteFlags: ledger.wasteFlags ?? [],
  };
}

export function loadFileIndexPanel(cwd: string): FileIndexPayload {
  const raw = safeReadJson(fileIndexPath(cwd));
  if (raw && isFileIndex(raw)) {
    const index = raw as FileIndex;
    const entries: FileIndexEntry[] = Object.values(index.entries);
    return { header: index.header, entries };
  }
  return {
    header: {
      lastScanTimestamp: "",
      totalFiles: 0,
      lifetimeHits: 0,
      lifetimeMisses: 0,
    },
    entries: [],
  };
}

export function loadSchedulerPanel(cwd: string): SchedulerPayload {
  const manifest = loadManifest(cwd);
  const definitions = getBuiltInTasks();

  const tasks = definitions.map((def) => {
    const state = manifest?.tasks.find((t) => t.taskId === def.id) ?? null;
    return { definition: def, state };
  });

  return {
    tasks,
    deadLetterQueue: manifest?.deadLetterQueue ?? [],
    lastHeartbeat: manifest?.lastHeartbeat ?? null,
  };
}

export function loadLearningMemoryPanel(cwd: string): LearningMemory {
  const memPath = learningMemoryPath(cwd);
  if (!existsSync(memPath)) {
    return {
      projectName: "unknown",
      sections: {
        "User Preferences": [],
        "Key Learnings": [],
        "Do-Not-Repeat": [],
        "Decision Log": [],
      },
    };
  }
  try {
    const content = readFileSync(memPath, "utf-8");
    return parseLearningMemory(content);
  } catch {
    return {
      projectName: "unknown",
      sections: {
        "User Preferences": [],
        "Key Learnings": [],
        "Do-Not-Repeat": [],
        "Decision Log": [],
      },
    };
  }
}

export function loadActionLogPanel(cwd: string): ActionLogPayload {
  const content = safeReadLog(actionLogPath(cwd));
  const sessions = parseLogSessions(content);
  return { sessions };
}

export function loadBugLogPanel(cwd: string): BugLogPayload {
  const memory = loadBugMemory(bugMemoryPath(cwd));
  return { entries: memory.entries, nextId: memory.nextId };
}

export function loadDesignPanel(cwd: string): DesignPayload {
  const raw = safeReadJson(designReportPath(cwd));
  if (!raw || !isDesignEvalReport(raw)) {
    return { images: [] };
  }

  const report = raw as DesignEvalReport;
  return {
    images: report.captures.map((c) => ({
      url: `/api/design-images/${c.fileName}`,
      route: c.route,
      viewport: c.viewport,
      section: c.section,
      timestamp: c.timestamp,
    })),
  };
}

// ── Config Panel ───────────────────────────────────────────────────────────

const BOOLEAN_VALUES = new Set(["true", "false"]);
const GROUP_LABELS: Record<string, string> = {
  wiki: "Wiki",
  notes: "Notes",
  sync: "Sync",
  channel: "Channels",
};

function groupFromKey(key: string): string {
  const prefix = key.split(".")[0] ?? "other";
  return GROUP_LABELS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function inferType(defaultValue: string, currentValue: string): ConfigValueType {
  const candidate = currentValue || defaultValue;
  if (BOOLEAN_VALUES.has(candidate)) return "boolean";
  if (candidate !== "" && !Number.isNaN(Number(candidate)) && /^-?\d+(\.\d+)?$/.test(candidate)) {
    return "number";
  }
  return "string";
}

function mapSource(
  source: "default" | "config file" | "environment variable",
  scope: "shared" | "local",
): ConfigValueSource {
  if (source === "environment variable") return "env";
  if (source === "default") return "default";
  return scope;
}

export function loadConfigPanel(): ConfigPanelPayload {
  const resolved = resolveAllConfig();

  const entries: ConfigEntry[] = resolved.map((r) => {
    const meta = CONFIG_KEYS.find((k) => k.key === r.key)!;
    const isSecret = isSecretKey(r.key);
    return {
      key: r.key,
      value: isSecret ? maskSecret(r.value) : r.value,
      source: mapSource(r.source, r.scope),
      type: inferType(meta.default, r.value),
      group: groupFromKey(r.key),
      scope: r.scope,
      description: meta.description,
      isSecret,
    };
  });

  return { entries };
}

// ── Sync Panel ─────────────────────────────────────────────────────────────

function parsePorcelain(output: string): SyncPendingChange[] {
  const changes: SyncPendingChange[] = [];
  for (const rawLine of output.split("\n")) {
    if (!rawLine.trim()) continue;
    // Porcelain v1 format: `XY file` where X = staged, Y = unstaged, and
    // untracked files are prefixed with "??".
    const xy = rawLine.slice(0, 2);
    const file = rawLine.slice(3);
    let op: SyncPendingChange["op"];
    if (xy === "??") op = "?";
    else if (xy.includes("D")) op = "D";
    else if (xy.includes("A") || xy.includes("?")) op = "A";
    else op = "M";
    changes.push({ op, file });
  }
  return changes;
}

function getAheadBehind(branch: string): { ahead: number; behind: number } {
  if (!branch) return { ahead: 0, behind: 0 };
  try {
    const raw = execSync(
      `git rev-list --left-right --count origin/${branch}...${branch}`,
      { cwd: minkRoot(), timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    )
      .toString()
      .trim();
    const [behindStr, aheadStr] = raw.split(/\s+/);
    return {
      behind: Number(behindStr) || 0,
      ahead: Number(aheadStr) || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

function getPendingChanges(): SyncPendingChange[] {
  try {
    const raw = execSync("git status --porcelain", {
      cwd: minkRoot(),
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString();
    return parsePorcelain(raw);
  } catch {
    return [];
  }
}

export function loadSyncPanel(): SyncPanelPayload {
  const status = getSyncStatus();
  const initialized = isSyncInitialized();
  const pending = status.gitInitialized ? getPendingChanges() : [];
  const { ahead, behind } = status.gitInitialized
    ? getAheadBehind(status.branch)
    : { ahead: 0, behind: 0 };

  return {
    initialized,
    enabled: status.enabled,
    branch: status.branch,
    remote: status.remoteUrl,
    ahead,
    behind,
    lastPush: status.lastPush,
    lastPull: status.lastPull,
    pending,
  };
}

// ── Channel Panel ──────────────────────────────────────────────────────────

const CHANNEL_LOG_LIMIT = 120;
const TIMESTAMP_PREFIX = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*/;

function parseChannelLogs(raw: string | null): ChannelLogLine[] {
  if (!raw) return [];
  const lines = raw.split("\n").map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trim()).filter(Boolean);
  const parsed: ChannelLogLine[] = lines.map((line) => {
    const match = line.match(TIMESTAMP_PREFIX);
    if (match) {
      return { t: match[1], m: line.slice(match[0].length) };
    }
    return { t: "", m: line };
  });
  return parsed.slice(-CHANNEL_LOG_LIMIT);
}

function parseAllowlist(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadChannelPanel(): ChannelPanelPayload {
  const running = isChannelRunning();
  const status = running ? getChannelStatus() : null;
  const rawLogs = running ? getChannelLogs() : null;
  const logs = parseChannelLogs(rawLogs);

  const token = resolveConfigValue("channel.discord.bot-token").value;
  const allowlistRaw = resolveConfigValue("channel.discord.allowlist").value;
  const autoStart = resolveConfigValue("channel.discord.enabled").value === "true";

  return {
    status: running ? "running" : "stopped",
    platform: status?.platform ?? null,
    session: status?.session ?? "",
    startedAt: status?.startedAt ?? "",
    uptimeSec: status?.uptime ?? 0,
    autoStart,
    tokenMasked: maskSecret(token),
    allowlist: parseAllowlist(allowlistRaw),
    logs,
  };
}

// ── Action Triggers ────────────────────────────────────────────────────────

export async function triggerTask(
  cwd: string,
  taskId: string
): Promise<ActionResult> {
  try {
    await executeTask(taskId, cwd);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerDeadLetterRetry(
  cwd: string,
  taskId: string
): Promise<ActionResult> {
  try {
    const manifest = loadManifest(cwd);
    if (!manifest) {
      return { success: false, error: "No scheduler manifest found" };
    }

    const entry = removeFromDeadLetter(manifest, taskId);
    if (!entry) {
      return { success: false, error: `Task ${taskId} not in dead letter queue` };
    }

    // Reset the task record
    const record = manifest.tasks.find((t) => t.taskId === taskId);
    if (record) {
      record.status = "idle";
      record.consecutiveFailures = 0;
      record.currentAttempt = 0;
    }

    saveManifest(cwd, manifest);
    await executeTask(taskId, cwd);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerRescan(cwd: string): Promise<ActionResult> {
  try {
    const { scan } = await import("../commands/scan");
    scan(cwd, { check: false });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerDaemonStart(cwd: string): Promise<ActionResult> {
  try {
    startDaemon(cwd);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerDaemonStop(): Promise<ActionResult> {
  try {
    await stopDaemon();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerDaemonRestart(cwd: string): Promise<ActionResult> {
  try {
    await stopDaemon();
    startDaemon(cwd);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerConfigSet(
  key: string,
  value: string,
): Promise<ActionResult> {
  try {
    if (!isValidConfigKey(key)) {
      return { success: false, error: `Unknown config key: ${key}` };
    }
    if (typeof value !== "string") {
      return { success: false, error: "Config value must be a string" };
    }
    setConfigValue(key as ConfigKey, value);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerSyncPull(): Promise<ActionResult> {
  try {
    if (!isSyncInitialized()) {
      return { success: false, error: "Sync is not initialized" };
    }
    const errors: string[] = [];
    syncPull((msg) => errors.push(msg));
    if (errors.length > 0) {
      return { success: false, error: errors.join("\n") };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerSyncPush(): Promise<ActionResult> {
  try {
    if (!isSyncInitialized()) {
      return { success: false, error: "Sync is not initialized" };
    }
    const errors: string[] = [];
    syncPush((msg) => errors.push(msg));
    if (errors.length > 0) {
      return { success: false, error: errors.join("\n") };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerChannelStart(): Promise<ActionResult> {
  try {
    if (!isVaultInitialized()) {
      return {
        success: false,
        error: "Vault is not initialized. Run `mink wiki init` first.",
      };
    }
    const platform = (resolveConfigValue("channel.default-platform").value as ChannelPlatform) || "discord";
    const token = resolveConfigValue("channel.discord.bot-token").value;
    if (!token) {
      return {
        success: false,
        error: "No bot token configured. Set channel.discord.bot-token first.",
      };
    }
    const skipPermissions = resolveConfigValue("channel.skip-permissions").value === "true";
    const vaultPath = resolveVaultPath();
    await startChannelProcess({ vaultPath, platform, token, skipPermissions });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerChannelStop(): Promise<ActionResult> {
  try {
    await stopChannelProcess();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerChannelRestart(): Promise<ActionResult> {
  const stop = await triggerChannelStop();
  if (!stop.success) return stop;
  return triggerChannelStart();
}

export async function triggerSyncDisconnect(): Promise<ActionResult> {
  try {
    disconnectSync();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerConfigReset(
  key?: string,
  all?: boolean,
): Promise<ActionResult> {
  try {
    if (all) {
      resetAllConfig();
      return { success: true };
    }
    if (!key) {
      return { success: false, error: "Missing key (or set all: true)" };
    }
    if (!isValidConfigKey(key)) {
      return { success: false, error: `Unknown config key: ${key}` };
    }
    resetConfigKey(key as ConfigKey);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
