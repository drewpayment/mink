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
