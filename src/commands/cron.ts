import { startDaemon, stopDaemon, getDaemonStatus, removePidFile } from "../core/daemon";
import { createScheduler, loadManifest, removeFromDeadLetter, saveManifest, createInitialManifest, recoverManifest } from "../core/scheduler";
import { getBuiltInTasks, getTaskById, executeTask } from "../core/task-registry";
import { schedulerManifestPath } from "../core/paths";

// ── Subcommand: start ───────────────────────────────────────────────────────

function cronStart(cwd: string): void {
  startDaemon(cwd);
}

// ── Subcommand: stop ────────────────────────────────────────────────────────

async function cronStop(): Promise<void> {
  await stopDaemon();
}

// ── Subcommand: status ──────────────────────────────────────────────────────

function cronStatus(cwd: string): void {
  const status = getDaemonStatus(cwd);

  if (!status.running) {
    console.log("[mink] scheduler is not running");
  } else {
    const uptimeMs = Date.now() - new Date(status.startedAt!).getTime();
    const uptimeMin = Math.floor(uptimeMs / 60_000);
    const uptimeHrs = Math.floor(uptimeMin / 60);
    const uptimeStr =
      uptimeHrs > 0
        ? `${uptimeHrs}h ${uptimeMin % 60}m`
        : `${uptimeMin}m`;

    console.log(`[mink] scheduler running (PID: ${status.pid})`);
    console.log(`  Started: ${status.startedAt}`);
    console.log(`  Uptime:  ${uptimeStr}`);
    console.log(`  Project: ${status.projectCwd}`);
  }

  const manifest = loadManifest(cwd);
  if (manifest) {
    console.log(`  Last heartbeat: ${manifest.lastHeartbeat}`);
    console.log(`  Dead letter queue: ${manifest.deadLetterQueue.length} task(s)`);
    console.log();
    cronList(cwd);
  }
}

// ── Subcommand: list ────────────────────────────────────────────────────────

function cronList(cwd: string): void {
  const tasks = getBuiltInTasks();
  const manifest = loadManifest(cwd);

  console.log("Tasks:");
  console.log(
    "  " +
      "ID".padEnd(30) +
      "Schedule".padEnd(18) +
      "Status".padEnd(16) +
      "Last Run"
  );
  console.log("  " + "-".repeat(80));

  for (const task of tasks) {
    const record = manifest?.tasks.find((r) => r.taskId === task.id);
    const status = record?.status ?? "idle";
    const lastRun = record?.lastRunAt
      ? new Date(record.lastRunAt).toISOString().replace("T", " ").slice(0, 19)
      : "never";

    console.log(
      "  " +
        task.id.padEnd(30) +
        task.schedule.padEnd(18) +
        status.padEnd(16) +
        lastRun
    );
  }
}

// ── Subcommand: run ─────────────────────────────────────────────────────────

async function cronRun(cwd: string, taskId: string | undefined): Promise<void> {
  if (!taskId) {
    console.error("Usage: mink cron run <task-id>");
    console.error(
      "Available tasks: " + getBuiltInTasks().map((t) => t.id).join(", ")
    );
    process.exit(1);
  }

  const task = getTaskById(taskId);
  if (!task) {
    console.error(`[mink] unknown task: ${taskId}`);
    console.error(
      "Available tasks: " + getBuiltInTasks().map((t) => t.id).join(", ")
    );
    process.exit(1);
  }

  console.log(`[mink] running task: ${task.name}`);

  // Execute directly, with retry logic
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < task.retryPolicy.maxAttempts; attempt++) {
    try {
      await executeTask(taskId, cwd);
      console.log(`[mink] task ${taskId} completed successfully`);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[mink] task ${taskId} failed (attempt ${attempt + 1}/${task.retryPolicy.maxAttempts}): ${lastError.message}`
      );

      if (attempt + 1 < task.retryPolicy.maxAttempts) {
        const delay = task.retryPolicy.baseDelayMs * Math.pow(2, attempt);
        console.log(`[mink] retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // All retries exhausted — dead letter
  console.error(
    `[mink] task ${taskId} failed after ${task.retryPolicy.maxAttempts} attempts`
  );

  // Update manifest if it exists
  let manifest = loadManifest(cwd);
  if (manifest) {
    const record = manifest.tasks.find((r) => r.taskId === taskId);
    if (record) {
      record.status = "dead-lettered";
    }
    manifest.deadLetterQueue.push({
      taskId,
      deadLetteredAt: new Date().toISOString(),
      failureTimestamps: [new Date().toISOString()],
      errorMessages: [lastError?.message ?? "Unknown error"],
      attemptCount: task.retryPolicy.maxAttempts,
    });
    saveManifest(cwd, manifest);
  }

  process.exit(1);
}

// ── Subcommand: dead-letter ─────────────────────────────────────────────────

async function cronDeadLetter(
  cwd: string,
  args: string[]
): Promise<void> {
  const action = args[0];

  if (action === "list") {
    const manifest = loadManifest(cwd);
    if (!manifest || manifest.deadLetterQueue.length === 0) {
      console.log("[mink] dead letter queue is empty");
      return;
    }

    console.log("Dead-lettered tasks:");
    for (const entry of manifest.deadLetterQueue) {
      console.log(`  ${entry.taskId}`);
      console.log(`    Dead-lettered: ${entry.deadLetteredAt}`);
      console.log(`    Attempts: ${entry.attemptCount}`);
      console.log(
        `    Last error: ${entry.errorMessages[entry.errorMessages.length - 1] ?? "unknown"}`
      );
    }
    return;
  }

  if (action === "retry") {
    const taskId = args[1];
    if (!taskId) {
      console.error("Usage: mink cron dead-letter retry <task-id>");
      process.exit(1);
    }

    const manifest = loadManifest(cwd);
    if (!manifest) {
      console.error("[mink] no scheduler manifest found");
      process.exit(1);
    }

    const entry = removeFromDeadLetter(manifest, taskId);
    if (!entry) {
      console.error(`[mink] task ${taskId} is not in the dead letter queue`);
      process.exit(1);
    }

    // Reset the task record
    const record = manifest.tasks.find((r) => r.taskId === taskId);
    if (record) {
      record.status = "idle";
      record.currentAttempt = 0;
    }
    saveManifest(cwd, manifest);

    console.log(`[mink] retrying dead-lettered task: ${taskId}`);
    try {
      await executeTask(taskId, cwd);
      console.log(`[mink] task ${taskId} completed successfully`);
      if (record) {
        record.lastSuccessAt = new Date().toISOString();
        record.lastRunAt = new Date().toISOString();
        record.consecutiveFailures = 0;
      }
      saveManifest(cwd, manifest);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[mink] task ${taskId} failed again: ${errorMsg}`);
      // Re-add to dead letter
      manifest.deadLetterQueue.push({
        taskId,
        deadLetteredAt: new Date().toISOString(),
        failureTimestamps: [...entry.failureTimestamps, new Date().toISOString()],
        errorMessages: [...entry.errorMessages, errorMsg],
        attemptCount: entry.attemptCount + 1,
      });
      if (record) {
        record.status = "dead-lettered";
      }
      saveManifest(cwd, manifest);
      process.exit(1);
    }
    return;
  }

  console.error("Usage: mink cron dead-letter <list|retry> [task-id]");
  process.exit(1);
}

// ── Subcommand: __daemon (internal) ─────────────────────────────────────────

async function cronDaemon(cwd: string): Promise<void> {
  console.log(`[mink] daemon starting for project: ${cwd}`);

  const scheduler = createScheduler(cwd);

  // Signal handlers for graceful shutdown
  process.on("SIGTERM", () => {
    console.log("[mink] received SIGTERM");
    scheduler.stop();
    removePidFile();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    console.log("[mink] received SIGINT");
    scheduler.stop();
    removePidFile();
    process.exit(0);
  });

  scheduler.start();

  // Keep the process alive
  await new Promise(() => {});
}

// ── Main Entry Point ────────────────────────────────────────────────────────

export async function cron(cwd: string, args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "start":
      return cronStart(cwd);
    case "stop":
      return await cronStop();
    case "status":
      return cronStatus(cwd);
    case "list":
      return cronList(cwd);
    case "run":
      return await cronRun(cwd, args[1]);
    case "dead-letter":
      return await cronDeadLetter(cwd, args.slice(1));
    case "__daemon":
      return await cronDaemon(cwd);
    default:
      console.error(
        `[mink] unknown cron subcommand: ${subcommand ?? "(none)"}`
      );
      console.error(
        "Usage: mink cron <start|stop|status|list|run|dead-letter>"
      );
      process.exit(1);
  }
}
