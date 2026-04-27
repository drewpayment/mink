import type { LifetimeCounters, LedgerSession } from "./token-ledger";
import type { WasteFlag } from "./waste-detection";
import type { FileIndexHeader, FileIndexEntry } from "./file-index";
import type { BugEntry } from "./bug-memory";
import type {
  LearningMemory,
  RuleMeta,
  SectionName,
  SuggestedRule,
} from "./learning-memory";
import type { ParsedSession } from "./action-log";
import type { TaskDefinition, TaskRunRecord, DeadLetterEntry } from "./scheduler";
import type { VaultIndexEntry } from "./note";

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
  | "channel-logs"
  | "vault-index";

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

export interface LearningEntryPayload {
  section: SectionName;
  index: number;
  text: string;
  meta?: RuleMeta;
}

export interface LearningMemoryPayload extends LearningMemory {
  entries: LearningEntryPayload[];
  suggestionCount: number;
  ai: {
    enabled: boolean;
    scheduledMining: boolean;
    manualTriggers: boolean;
    autoAcceptThreshold: number;
  };
}

export interface SuggestionsPayload {
  pending: SuggestedRule[];
  completed: SuggestedRule[];
}

export type LearningSuggestionsPayload = SuggestionsPayload;

export interface RefineRulePayload {
  refinedText: string;
  rationale: string;
  confidence: number;
}

export interface ProposeRulesResult {
  ok: boolean;
  autoAccepted: number;
  queued: number;
  total: number;
  message?: string;
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

export interface WikiTreeNode {
  name: string;
  path: string;
  count: number;
  depth: number;
}

export interface WikiPanelPayload {
  initialized: boolean;
  vaultPath: string;
  totalNotes: number;
  inboxCount: number;
  recent: VaultIndexEntry[];
  tags: Array<[string, number]>;
  tree: WikiTreeNode[];
}

export interface WikiNotePayload {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  backlinks: Array<{ path: string; title: string }>;
}
