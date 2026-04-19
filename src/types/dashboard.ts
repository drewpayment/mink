import type { LifetimeCounters, LedgerSession } from "./token-ledger";
import type { WasteFlag } from "./waste-detection";
import type { FileIndexHeader, FileIndexEntry } from "./file-index";
import type { BugEntry } from "./bug-memory";
import type { LearningMemory } from "./learning-memory";
import type { ParsedSession } from "./action-log";
import type { TaskDefinition, TaskRunRecord, DeadLetterEntry } from "./scheduler";

// ── State File Identifiers ─────────────────────────────────────────────────

export type StateFileId =
  | "token-ledger"
  | "file-index"
  | "learning-memory"
  | "bug-memory"
  | "action-log"
  | "scheduler-manifest"
  | "session"
  | "project-meta"
  | "design-report"
  | "project-switched"
  | "daemon-status"
  | "config-changed"
  | "sync-status"
  | "channel-status"
  | "channel-logs";

// ── SSE Event ──────────────────────────────────────────────────────────────

export interface StateChangeEvent {
  fileId: StateFileId;
  projectId?: string;
  timestamp: string;
}

// ── File Status ────────────────────────────────────────────────────────────

export interface FileStatus {
  name: string;
  status: "ok" | "missing" | "corrupt";
}

// ── API Payloads ───────────────────────────────────────────────────────────

export interface OverviewPayload {
  project: { name: string; description: string; cwd: string } | null;
  daemon: {
    running: boolean;
    pid?: number;
    startedAt?: string;
    uptimeMs?: number;
  };
  summary: {
    totalSessions: number;
    totalTokens: number;
    totalReads: number;
    totalWrites: number;
    estimatedSavings: number;
  };
  stateFiles: FileStatus[];
}

export interface TokenLedgerPayload {
  lifetime: LifetimeCounters;
  sessions: LedgerSession[];
  wasteFlags: WasteFlag[];
}

export interface FileIndexPayload {
  header: FileIndexHeader;
  entries: FileIndexEntry[];
}

export interface SchedulerTaskPayload {
  definition: TaskDefinition;
  state: TaskRunRecord | null;
}

export interface SchedulerPayload {
  tasks: SchedulerTaskPayload[];
  deadLetterQueue: DeadLetterEntry[];
  lastHeartbeat: string | null;
}

export interface BugLogPayload {
  entries: BugEntry[];
  nextId: number;
}

export interface ActionLogPayload {
  sessions: ParsedSession[];
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

export interface DesignImagePayload {
  url: string;
  route: string;
  viewport: string;
  section: number;
  timestamp: string;
}

export interface DesignPayload {
  images: DesignImagePayload[];
}

export type ConfigValueSource = "default" | "shared" | "local" | "env";
export type ConfigValueType = "string" | "boolean" | "number";

export interface ConfigEntry {
  key: string;
  value: string;
  source: ConfigValueSource;
  type: ConfigValueType;
  group: string;
  scope: "shared" | "local";
  description: string;
  isSecret: boolean;
}

export interface ConfigPanelPayload {
  entries: ConfigEntry[];
}

export interface SyncPendingChange {
  op: "A" | "M" | "D" | "?";
  file: string;
}

export interface SyncPanelPayload {
  initialized: boolean;
  enabled: boolean;
  branch: string;
  remote: string;
  ahead: number;
  behind: number;
  lastPush: string;
  lastPull: string;
  pending: SyncPendingChange[];
}

export interface ChannelLogLine {
  t: string;
  m: string;
}

export interface ChannelPanelPayload {
  status: "running" | "stopped";
  platform: "discord" | "telegram" | null;
  session: string;
  startedAt: string;
  uptimeSec: number;
  autoStart: boolean;
  tokenMasked: string;
  allowlist: string[];
  logs: ChannelLogLine[];
}
