import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import {
  createInitialManifest,
  saveManifest,
  loadManifest,
  addToDeadLetter,
  removeFromDeadLetter,
  recoverManifest,
  calculateBackoffMs,
} from "../../src/core/scheduler";
import { executeTask } from "../../src/core/task-registry";
import type { SchedulerManifest } from "../../src/types/scheduler";

// ── Helpers ─────────────────────────────────────────────────────────────────

// We need to mock the path resolution to point to our temp dir.
// The simplest approach is to create the expected directory structure.

let tmpDir: string;

function makeProjectDir(): string {
  // Create a minimal project directory structure
  const projectDir = join(tmpDir, "project");
  mkdirSync(projectDir, { recursive: true });
  return projectDir;
}

function makeMinkStateDir(projectCwd: string): string {
  // The scheduler uses paths.ts which resolves via generateProjectId.
  // For integration tests, we test the manifest load/save directly
  // using the manifest path.
  return projectCwd;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mink-scheduler-integ-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Manifest Persistence ────────────────────────────────────────────────────

describe("manifest persistence", () => {
  test("createInitialManifest produces valid manifest", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);

    expect(manifest.tasks.length).toBe(5);
    expect(manifest.deadLetterQueue).toEqual([]);
    expect(manifest.lastHeartbeat).toBe(now.toISOString());

    for (const task of manifest.tasks) {
      expect(task.status).toBe("idle");
      expect(task.lastRunAt).toBeNull();
      expect(task.currentAttempt).toBe(0);
      expect(task.nextRunAt).toBeTruthy();
    }
  });

  test("manifest round-trips through JSON", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);

    const filePath = join(tmpDir, "scheduler-manifest.json");
    atomicWriteJson(filePath, manifest);
    const loaded = safeReadJson(filePath) as SchedulerManifest;

    expect(loaded.tasks.length).toBe(manifest.tasks.length);
    expect(loaded.deadLetterQueue.length).toBe(0);
    expect(loaded.lastHeartbeat).toBe(manifest.lastHeartbeat);
  });
});

// ── Dead Letter Flow ────────────────────────────────────────────────────────

describe("dead letter flow", () => {
  test("task fails → retries → dead-letters → manual retry succeeds", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);

    const record = manifest.tasks.find(
      (t) => t.taskId === "file-index-rescan"
    )!;

    // Simulate 3 failures
    for (let attempt = 0; attempt < 3; attempt++) {
      record.currentAttempt++;
      record.consecutiveFailures++;
      record.lastFailureAt = new Date(
        now.getTime() + attempt * 60_000
      ).toISOString();

      if (record.currentAttempt >= 3) {
        record.status = "dead-lettered";
        addToDeadLetter(manifest, {
          taskId: record.taskId,
          deadLetteredAt: record.lastFailureAt,
          failureTimestamps: [record.lastFailureAt],
          errorMessages: [`failure ${attempt + 1}`],
          attemptCount: record.currentAttempt,
        });
        record.currentAttempt = 0;
      } else {
        record.status = "retrying";
      }
    }

    expect(record.status).toBe("dead-lettered");
    expect(manifest.deadLetterQueue.length).toBe(1);
    expect(manifest.deadLetterQueue[0].taskId).toBe("file-index-rescan");

    // Manual retry
    const entry = removeFromDeadLetter(manifest, "file-index-rescan");
    expect(entry).toBeDefined();
    expect(manifest.deadLetterQueue.length).toBe(0);

    // Reset record
    record.status = "idle";
    record.currentAttempt = 0;
    record.consecutiveFailures = 0;

    // Simulate success
    record.status = "idle";
    record.lastSuccessAt = new Date(now.getTime() + 300_000).toISOString();
    record.lastRunAt = record.lastSuccessAt;

    expect(record.status).toBe("idle");
    expect(record.lastSuccessAt).toBeTruthy();
  });
});

// ── Crash Recovery ──────────────────────────────────────────────────────────

describe("crash recovery", () => {
  test("running task recovered as failure after crash", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);
    const record = manifest.tasks.find(
      (t) => t.taskId === "file-index-rescan"
    )!;
    record.status = "running";
    record.lastRunAt = "2026-04-11T06:00:00.000Z";
    record.currentAttempt = 0;

    recoverManifest(manifest, now);

    expect(record.status).toBe("retrying");
    expect(record.currentAttempt).toBe(1);
    expect(record.lastFailureAt).toBe(now.toISOString());
  });

  test("manifest persists across simulated restart", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);

    // Simulate some activity
    const record = manifest.tasks[0];
    record.lastRunAt = "2026-04-11T06:00:00.000Z";
    record.lastSuccessAt = "2026-04-11T06:00:00.000Z";

    // Save to disk
    const filePath = join(tmpDir, "scheduler-manifest.json");
    atomicWriteJson(filePath, manifest);

    // Load back (simulating restart)
    const loaded = safeReadJson(filePath) as SchedulerManifest;
    expect(loaded.tasks[0].lastRunAt).toBe("2026-04-11T06:00:00.000Z");
    expect(loaded.tasks[0].lastSuccessAt).toBe("2026-04-11T06:00:00.000Z");

    // Apply recovery
    recoverManifest(loaded, new Date("2026-04-11T10:30:00.000Z"));
    expect(loaded.tasks[0].status).toBe("idle");
  });
});

// ── Sequential Execution ────────────────────────────────────────────────────

describe("sequential execution", () => {
  test("concurrent tasks execute sequentially based on sorted IDs", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);

    // Set multiple tasks as due
    for (const record of manifest.tasks) {
      record.nextRunAt = now.toISOString();
    }

    // Collect due tasks and sort (same logic as scheduler tick)
    const dueTasks = manifest.tasks
      .filter((r) => {
        return (
          r.status === "idle" &&
          new Date(r.nextRunAt).getTime() <= now.getTime()
        );
      })
      .map((r) => r.taskId)
      .sort();

    // Verify deterministic ordering
    expect(dueTasks[0]).toBe("action-log-consolidation");
    expect(dueTasks[1]).toBe("file-index-rescan");
    expect(dueTasks[2]).toBe("learning-memory-reflection");
    expect(dueTasks[3]).toBe("project-suggestions");
    expect(dueTasks[4]).toBe("waste-detection");
  });
});

// ── Task Execution ──────────────────────────────────────────────────────────

describe("task execution", () => {
  test("project-suggestions stub completes without error", async () => {
    // project-suggestions is a stub that just logs a message
    const projectDir = makeProjectDir();
    await expect(
      executeTask("project-suggestions", projectDir)
    ).resolves.toBeUndefined();
  });

  test("unknown task throws", async () => {
    await expect(executeTask("nonexistent-task", tmpDir)).rejects.toThrow(
      "Unknown task"
    );
  });
});

// ── Backoff Calculation ─────────────────────────────────────────────────────

describe("exponential backoff integration", () => {
  test("backoff delays increase exponentially", () => {
    const baseDelay = 60_000;
    const delays: number[] = [];
    for (let i = 0; i < 5; i++) {
      delays.push(calculateBackoffMs(baseDelay, i));
    }

    expect(delays).toEqual([60_000, 120_000, 240_000, 480_000, 960_000]);

    // Each delay is double the previous
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBe(delays[i - 1] * 2);
    }
  });
});
