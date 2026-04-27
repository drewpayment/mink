import { describe, test, expect } from "bun:test";
import {
  calculateBackoffMs,
  addToDeadLetter,
  removeFromDeadLetter,
  listDeadLetterEntries,
  createInitialManifest,
  recoverManifest,
} from "../../src/core/scheduler";
import type {
  SchedulerManifest,
  DeadLetterEntry,
  TaskRunRecord,
} from "../../src/types/scheduler";

// ── Backoff ─────────────────────────────────────────────────────────────────

describe("calculateBackoffMs", () => {
  test("attempt 0 returns base delay", () => {
    expect(calculateBackoffMs(60_000, 0)).toBe(60_000);
  });

  test("attempt 1 returns base * 2", () => {
    expect(calculateBackoffMs(60_000, 1)).toBe(120_000);
  });

  test("attempt 2 returns base * 4", () => {
    expect(calculateBackoffMs(60_000, 2)).toBe(240_000);
  });

  test("works with different base delay", () => {
    expect(calculateBackoffMs(1000, 3)).toBe(8000);
  });
});

// ── Dead Letter Queue ───────────────────────────────────────────────────────

describe("dead letter queue operations", () => {
  function emptyManifest(): SchedulerManifest {
    return {
      tasks: [],
      deadLetterQueue: [],
      lastHeartbeat: new Date().toISOString(),
    };
  }

  function makeEntry(taskId: string): DeadLetterEntry {
    return {
      taskId,
      deadLetteredAt: new Date().toISOString(),
      failureTimestamps: [new Date().toISOString()],
      errorMessages: ["test error"],
      attemptCount: 3,
    };
  }

  test("addToDeadLetter adds an entry", () => {
    const manifest = emptyManifest();
    addToDeadLetter(manifest, makeEntry("task-a"));
    expect(manifest.deadLetterQueue.length).toBe(1);
    expect(manifest.deadLetterQueue[0].taskId).toBe("task-a");
  });

  test("addToDeadLetter replaces existing entry for same task", () => {
    const manifest = emptyManifest();
    addToDeadLetter(manifest, makeEntry("task-a"));
    addToDeadLetter(manifest, makeEntry("task-a"));
    expect(manifest.deadLetterQueue.length).toBe(1);
  });

  test("addToDeadLetter keeps entries for different tasks", () => {
    const manifest = emptyManifest();
    addToDeadLetter(manifest, makeEntry("task-a"));
    addToDeadLetter(manifest, makeEntry("task-b"));
    expect(manifest.deadLetterQueue.length).toBe(2);
  });

  test("removeFromDeadLetter removes and returns entry", () => {
    const manifest = emptyManifest();
    addToDeadLetter(manifest, makeEntry("task-a"));
    const removed = removeFromDeadLetter(manifest, "task-a");
    expect(removed).toBeDefined();
    expect(removed!.taskId).toBe("task-a");
    expect(manifest.deadLetterQueue.length).toBe(0);
  });

  test("removeFromDeadLetter returns undefined for missing task", () => {
    const manifest = emptyManifest();
    const removed = removeFromDeadLetter(manifest, "task-x");
    expect(removed).toBeUndefined();
  });

  test("listDeadLetterEntries returns current queue", () => {
    const manifest = emptyManifest();
    addToDeadLetter(manifest, makeEntry("task-a"));
    addToDeadLetter(manifest, makeEntry("task-b"));
    const entries = listDeadLetterEntries(manifest);
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.taskId)).toEqual(["task-a", "task-b"]);
  });
});

// ── Initial Manifest ────────────────────────────────────────────────────────

describe("createInitialManifest", () => {
  test("creates manifest with all 7 built-in tasks", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);
    expect(manifest.tasks.length).toBe(7);
    expect(manifest.deadLetterQueue.length).toBe(0);
    expect(manifest.lastHeartbeat).toBe(now.toISOString());
  });

  test("all tasks start as idle with no run history", () => {
    const manifest = createInitialManifest(new Date("2026-04-11T10:00:00.000Z"));
    for (const record of manifest.tasks) {
      expect(record.status).toBe("idle");
      expect(record.lastRunAt).toBeNull();
      expect(record.lastSuccessAt).toBeNull();
      expect(record.lastFailureAt).toBeNull();
      expect(record.consecutiveFailures).toBe(0);
      expect(record.currentAttempt).toBe(0);
    }
  });

  test("nextRunAt is computed for each task", () => {
    const manifest = createInitialManifest(new Date("2026-04-11T10:00:00.000Z"));
    for (const record of manifest.tasks) {
      // nextRunAt should be a valid ISO date string in the future
      const nextRun = new Date(record.nextRunAt);
      expect(nextRun.getTime()).toBeGreaterThan(
        new Date("2026-04-11T10:00:00.000Z").getTime()
      );
    }
  });

  test("task IDs match built-in tasks", () => {
    const manifest = createInitialManifest();
    const ids = manifest.tasks.map((t) => t.taskId);
    expect(ids).toContain("file-index-rescan");
    expect(ids).toContain("action-log-consolidation");
    expect(ids).toContain("waste-detection");
    expect(ids).toContain("learning-memory-reflection");
    expect(ids).toContain("project-suggestions");
  });
});

// ── Crash Recovery ──────────────────────────────────────────────────────────

describe("recoverManifest", () => {
  test("recovers running task as retrying", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);
    const record = manifest.tasks.find(
      (t) => t.taskId === "file-index-rescan"
    )!;
    record.status = "running";
    record.lastRunAt = "2026-04-11T06:00:00.000Z";

    recoverManifest(manifest, now);

    expect(record.status).toBe("retrying");
    expect(record.currentAttempt).toBe(1);
    expect(record.consecutiveFailures).toBe(1);
  });

  test("dead-letters running task at max attempts", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);
    const record = manifest.tasks.find(
      (t) => t.taskId === "file-index-rescan"
    )!;
    record.status = "running";
    record.currentAttempt = 2; // Will become 3 (= max)

    recoverManifest(manifest, now);

    expect(record.status).toBe("dead-lettered");
    expect(manifest.deadLetterQueue.length).toBe(1);
    expect(manifest.deadLetterQueue[0].taskId).toBe("file-index-rescan");
  });

  test("preserves idle tasks that already ran in current period", () => {
    const now = new Date("2026-04-11T07:00:00.000Z");
    const manifest = createInitialManifest(now);
    const record = manifest.tasks.find(
      (t) => t.taskId === "file-index-rescan"
    )!;
    record.status = "idle";
    record.lastRunAt = "2026-04-11T06:00:00.000Z";
    // Next run for */6 after 06:00 is 12:00

    recoverManifest(manifest, now);

    expect(record.status).toBe("idle");
    expect(record.nextRunAt).toBe("2026-04-11T12:00:00.000Z");
  });

  test("makes missed tasks due now", () => {
    // Task ran at 06:00, now is 13:00 — missed the 12:00 slot
    const now = new Date("2026-04-11T13:00:00.000Z");
    const manifest = createInitialManifest(now);
    const record = manifest.tasks.find(
      (t) => t.taskId === "file-index-rescan"
    )!;
    record.status = "idle";
    record.lastRunAt = "2026-04-11T06:00:00.000Z";

    recoverManifest(manifest, now);

    expect(record.status).toBe("idle");
    expect(record.nextRunAt).toBe(now.toISOString());
  });
});

// ── Health Status ───────────────────────────────────────────────────────────

describe("health status", () => {
  test("createInitialManifest produces valid heartbeat", () => {
    const now = new Date("2026-04-11T10:00:00.000Z");
    const manifest = createInitialManifest(now);
    expect(manifest.lastHeartbeat).toBe("2026-04-11T10:00:00.000Z");
  });
});
