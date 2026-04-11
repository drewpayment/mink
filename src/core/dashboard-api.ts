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
} from "./paths";
import { safeReadJson } from "./fs-utils";
import { isFileIndex } from "./index-store";
import { loadLedger } from "./token-ledger";
import { parseLearningMemory } from "./learning-memory";
import { loadBugMemory } from "./bug-memory";
import { safeReadLog, parseLogSessions } from "./action-log";
import { getDaemonStatus } from "./daemon";
import { loadManifest, removeFromDeadLetter, saveManifest } from "./scheduler";
import { getBuiltInTasks, executeTask } from "./task-registry";
import type {
  OverviewPayload,
  TokenLedgerPayload,
  FileIndexPayload,
  SchedulerPayload,
  BugLogPayload,
  ActionLogPayload,
  ActionResult,
  FileStatus,
} from "../types/dashboard";
import type { FileIndex, FileIndexEntry } from "../types/file-index";
import type { LearningMemory } from "../types/learning-memory";

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
