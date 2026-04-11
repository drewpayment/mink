import { parseCronExpression, nextRunAfter, isInCurrentPeriod } from "./cron-parser";
import { getBuiltInTasks, getTaskById, executeTask } from "./task-registry";
import { schedulerManifestPath } from "./paths";
import { atomicWriteJson, safeReadJson } from "./fs-utils";
import type {
  SchedulerManifest,
  TaskRunRecord,
  DeadLetterEntry,
  HealthStatus,
  TaskStatus,
} from "../types/scheduler";

// ── Backoff ─────────────────────────────────────────────────────────────────

export function calculateBackoffMs(
  baseDelayMs: number,
  attempt: number
): number {
  return baseDelayMs * Math.pow(2, attempt);
}

// ── Dead Letter Operations ──────────────────────────────────────────────────

export function addToDeadLetter(
  manifest: SchedulerManifest,
  entry: DeadLetterEntry
): void {
  // Remove existing entry for same task if present
  manifest.deadLetterQueue = manifest.deadLetterQueue.filter(
    (e) => e.taskId !== entry.taskId
  );
  manifest.deadLetterQueue.push(entry);
}

export function removeFromDeadLetter(
  manifest: SchedulerManifest,
  taskId: string
): DeadLetterEntry | undefined {
  const idx = manifest.deadLetterQueue.findIndex((e) => e.taskId === taskId);
  if (idx === -1) return undefined;
  return manifest.deadLetterQueue.splice(idx, 1)[0];
}

export function listDeadLetterEntries(
  manifest: SchedulerManifest
): DeadLetterEntry[] {
  return manifest.deadLetterQueue;
}

// ── Manifest Management ─────────────────────────────────────────────────────

export function createInitialManifest(now: Date = new Date()): SchedulerManifest {
  const tasks: TaskRunRecord[] = getBuiltInTasks().map((task) => {
    const schedule = parseCronExpression(task.schedule);
    return {
      taskId: task.id,
      lastRunAt: null,
      lastSuccessAt: null,
      lastFailureAt: null,
      nextRunAt: nextRunAfter(schedule, now).toISOString(),
      status: "idle" as TaskStatus,
      consecutiveFailures: 0,
      currentAttempt: 0,
    };
  });

  return {
    tasks,
    deadLetterQueue: [],
    lastHeartbeat: now.toISOString(),
  };
}

export function loadManifest(cwd: string): SchedulerManifest | null {
  const raw = safeReadJson(schedulerManifestPath(cwd));
  if (
    raw &&
    typeof raw === "object" &&
    "tasks" in (raw as object) &&
    "deadLetterQueue" in (raw as object)
  ) {
    return raw as SchedulerManifest;
  }
  return null;
}

export function saveManifest(cwd: string, manifest: SchedulerManifest): void {
  atomicWriteJson(schedulerManifestPath(cwd), manifest);
}

function getOrCreateManifest(cwd: string, now: Date): SchedulerManifest {
  const existing = loadManifest(cwd);
  if (existing) return existing;
  const fresh = createInitialManifest(now);
  saveManifest(cwd, fresh);
  return fresh;
}

// ── Crash Recovery ──────────────────────────────────────────────────────────

export function recoverManifest(
  manifest: SchedulerManifest,
  now: Date
): void {
  for (const record of manifest.tasks) {
    const task = getTaskById(record.taskId);
    if (!task) continue;

    const schedule = parseCronExpression(task.schedule);

    if (record.status === "running") {
      // Crashed during execution — treat as failure
      record.status = "retrying";
      record.currentAttempt++;
      record.consecutiveFailures++;
      record.lastFailureAt = now.toISOString();

      if (record.currentAttempt >= task.retryPolicy.maxAttempts) {
        record.status = "dead-lettered";
        addToDeadLetter(manifest, {
          taskId: record.taskId,
          deadLetteredAt: now.toISOString(),
          failureTimestamps: [now.toISOString()],
          errorMessages: ["Daemon crashed during execution"],
          attemptCount: record.currentAttempt,
        });
        record.currentAttempt = 0;
      }
    }

    // For idle/retrying tasks, check if they need schedule recalculation
    if (record.status === "idle" && record.lastRunAt) {
      const lastRun = new Date(record.lastRunAt);
      if (isInCurrentPeriod(schedule, lastRun, now)) {
        // Already ran in current period — advance to next
        record.nextRunAt = nextRunAfter(schedule, lastRun).toISOString();
      } else {
        // Missed the window — due now
        record.nextRunAt = now.toISOString();
      }
    } else if (record.status === "idle" && !record.lastRunAt) {
      // Never ran — recalculate next run
      record.nextRunAt = nextRunAfter(schedule, now).toISOString();
    }
  }
}

// ── Scheduler ───────────────────────────────────────────────────────────────

export interface Scheduler {
  start(): void;
  stop(): void;
  runTask(taskId: string): Promise<void>;
  getHealth(): HealthStatus;
  getManifest(): SchedulerManifest;
}

export function createScheduler(
  projectCwd: string,
  options: {
    tickMs?: number;
    heartbeatMs?: number;
    startedAt?: Date;
  } = {}
): Scheduler {
  const tickMs = options.tickMs ?? 60_000;
  const heartbeatMs = options.heartbeatMs ?? 30 * 60 * 1000;
  const startedAt = options.startedAt ?? new Date();

  let tickInterval: ReturnType<typeof setInterval> | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  let manifest: SchedulerManifest;
  let activeTasks: string[] = [];
  let ticking = false;

  // Initialize manifest
  manifest = getOrCreateManifest(projectCwd, startedAt);
  recoverManifest(manifest, startedAt);
  saveManifest(projectCwd, manifest);

  async function tick(): Promise<void> {
    if (ticking) return; // Prevent overlapping ticks
    ticking = true;

    try {
      const now = new Date();
      const queue: string[] = [];

      for (const record of manifest.tasks) {
        const task = getTaskById(record.taskId);
        if (!task || !task.enabled) continue;
        if (record.status === "dead-lettered") continue;

        if (record.status === "retrying") {
          // Check if backoff delay has elapsed
          const retryAfter =
            new Date(record.lastFailureAt!).getTime() +
            calculateBackoffMs(
              task.retryPolicy.baseDelayMs,
              record.currentAttempt - 1
            );
          if (now.getTime() >= retryAfter) {
            queue.push(record.taskId);
          }
        } else if (
          record.status === "idle" &&
          now.getTime() >= new Date(record.nextRunAt).getTime()
        ) {
          queue.push(record.taskId);
        }
      }

      // Execute sequentially, sorted by task ID for determinism
      queue.sort();

      for (const taskId of queue) {
        await executeTaskWithRetry(taskId, now);
      }
    } finally {
      ticking = false;
    }
  }

  async function executeTaskWithRetry(
    taskId: string,
    now: Date
  ): Promise<void> {
    const task = getTaskById(taskId);
    if (!task) return;

    const record = manifest.tasks.find((r) => r.taskId === taskId);
    if (!record) return;

    record.status = "running";
    record.lastRunAt = now.toISOString();
    activeTasks.push(taskId);
    saveManifest(projectCwd, manifest);

    try {
      await executeTask(taskId, projectCwd);

      // Success
      record.status = "idle";
      record.lastSuccessAt = now.toISOString();
      record.consecutiveFailures = 0;
      record.currentAttempt = 0;
      const schedule = parseCronExpression(task.schedule);
      record.nextRunAt = nextRunAfter(schedule, now).toISOString();

      console.log(`[mink] task ${taskId} completed successfully`);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : String(err);
      record.currentAttempt++;
      record.consecutiveFailures++;
      record.lastFailureAt = now.toISOString();

      console.error(`[mink] task ${taskId} failed: ${errorMsg}`);

      if (record.currentAttempt >= task.retryPolicy.maxAttempts) {
        record.status = "dead-lettered";
        addToDeadLetter(manifest, {
          taskId,
          deadLetteredAt: now.toISOString(),
          failureTimestamps: [now.toISOString()],
          errorMessages: [errorMsg],
          attemptCount: record.currentAttempt,
        });
        record.currentAttempt = 0;
        console.error(
          `[mink] task ${taskId} moved to dead letter queue after ${task.retryPolicy.maxAttempts} failures`
        );
      } else {
        record.status = "retrying";
        console.log(
          `[mink] task ${taskId} will retry (attempt ${record.currentAttempt}/${task.retryPolicy.maxAttempts})`
        );
      }
    } finally {
      activeTasks = activeTasks.filter((id) => id !== taskId);
      saveManifest(projectCwd, manifest);
    }
  }

  function emitHeartbeat(): void {
    manifest.lastHeartbeat = new Date().toISOString();
    saveManifest(projectCwd, manifest);
    console.log(`[mink] heartbeat at ${manifest.lastHeartbeat}`);
  }

  return {
    start(): void {
      tickInterval = setInterval(() => {
        tick().catch((err) => {
          console.error(`[mink] scheduler tick error: ${err}`);
        });
      }, tickMs);

      heartbeatInterval = setInterval(emitHeartbeat, heartbeatMs);

      // Emit initial heartbeat
      emitHeartbeat();

      // Run first tick immediately
      tick().catch((err) => {
        console.error(`[mink] scheduler initial tick error: ${err}`);
      });

      console.log("[mink] scheduler started");
    },

    stop(): void {
      if (tickInterval) {
        clearInterval(tickInterval);
        tickInterval = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
      console.log("[mink] scheduler stopped");
    },

    async runTask(taskId: string): Promise<void> {
      const task = getTaskById(taskId);
      if (!task) {
        throw new Error(`Unknown task: ${taskId}`);
      }
      // Reload manifest to get latest state
      const fresh = loadManifest(projectCwd);
      if (fresh) manifest = fresh;

      await executeTaskWithRetry(taskId, new Date());
    },

    getHealth(): HealthStatus {
      return {
        pid: process.pid,
        startedAt: startedAt.toISOString(),
        lastHeartbeatAt: manifest.lastHeartbeat,
        uptimeMs: Date.now() - startedAt.getTime(),
        activeTasks: [...activeTasks],
        deadLetterCount: manifest.deadLetterQueue.length,
        taskCount: manifest.tasks.length,
      };
    },

    getManifest(): SchedulerManifest {
      return manifest;
    },
  };
}
