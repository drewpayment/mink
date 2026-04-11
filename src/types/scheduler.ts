// ── Cron ────────────────────────────────────────────────────────────────────

export interface CronSchedule {
  minute: number[];      // 0-59
  hour: number[];        // 0-23
  dayOfMonth: number[];  // 1-31
  month: number[];       // 1-12
  dayOfWeek: number[];   // 0-6 (0=Sunday)
}

// ── Task Definition ─────────────────────────────────────────────────────────

export type ActionType = "function" | "ai-cli";

export type TaskStatus = "idle" | "running" | "retrying" | "dead-lettered";

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
}

export interface TaskDefinition {
  id: string;
  name: string;
  description: string;
  schedule: string;
  actionType: ActionType;
  enabled: boolean;
  retryPolicy: RetryPolicy;
  timeoutMs: number;
}

// ── Task Execution State ────────────────────────────────────────────────────

export interface TaskRunRecord {
  taskId: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  nextRunAt: string;
  status: TaskStatus;
  consecutiveFailures: number;
  currentAttempt: number;
}

// ── Dead Letter ─────────────────────────────────────────────────────────────

export interface DeadLetterEntry {
  taskId: string;
  deadLetteredAt: string;
  failureTimestamps: string[];
  errorMessages: string[];
  attemptCount: number;
}

// ── Health ───────────────────────────────────────────────────────────────────

export interface HealthStatus {
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
  uptimeMs: number;
  activeTasks: string[];
  deadLetterCount: number;
  taskCount: number;
}

// ── Scheduler Manifest (persisted state) ────────────────────────────────────

export interface SchedulerManifest {
  tasks: TaskRunRecord[];
  deadLetterQueue: DeadLetterEntry[];
  lastHeartbeat: string;
}

// ── PID File ────────────────────────────────────────────────────────────────

export interface PidFileData {
  pid: number;
  startedAt: string;
  projectCwd: string;
}
