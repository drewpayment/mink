import { describe, test, expect } from "bun:test";
import {
  getBuiltInTasks,
  getTaskById,
} from "../../src/core/task-registry";
import { parseCronExpression } from "../../src/core/cron-parser";

describe("getBuiltInTasks", () => {
  test("returns 7 built-in tasks", () => {
    const tasks = getBuiltInTasks();
    expect(tasks.length).toBe(7);
  });

  test("all tasks have unique IDs", () => {
    const tasks = getBuiltInTasks();
    const ids = tasks.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  test("all tasks have valid cron schedule expressions", () => {
    const tasks = getBuiltInTasks();
    for (const task of tasks) {
      expect(() => parseCronExpression(task.schedule)).not.toThrow();
    }
  });

  test("all tasks have non-empty name and description", () => {
    const tasks = getBuiltInTasks();
    for (const task of tasks) {
      expect(task.name.length).toBeGreaterThan(0);
      expect(task.description.length).toBeGreaterThan(0);
    }
  });

  test("all tasks have positive timeout", () => {
    const tasks = getBuiltInTasks();
    for (const task of tasks) {
      expect(task.timeoutMs).toBeGreaterThan(0);
    }
  });

  test("all tasks are enabled by default", () => {
    const tasks = getBuiltInTasks();
    for (const task of tasks) {
      expect(task.enabled).toBe(true);
    }
  });

  test("retry policy defaults are valid", () => {
    const tasks = getBuiltInTasks();
    for (const task of tasks) {
      expect(task.retryPolicy.maxAttempts).toBe(3);
      expect(task.retryPolicy.baseDelayMs).toBeGreaterThan(0);
    }
  });

  test("ai-cli tasks have longer timeout than function tasks", () => {
    const tasks = getBuiltInTasks();
    const functionTasks = tasks.filter((t) => t.actionType === "function");
    const aiTasks = tasks.filter((t) => t.actionType === "ai-cli");

    const maxFunctionTimeout = Math.max(...functionTasks.map((t) => t.timeoutMs));
    const minAiTimeout = Math.min(...aiTasks.map((t) => t.timeoutMs));

    expect(minAiTimeout).toBeGreaterThan(maxFunctionTimeout);
  });
});

describe("getTaskById", () => {
  test("returns correct task for valid ID", () => {
    const task = getTaskById("file-index-rescan");
    expect(task).toBeDefined();
    expect(task!.id).toBe("file-index-rescan");
    expect(task!.name).toBe("File Index Rescan");
  });

  test("returns all 7 tasks by ID", () => {
    const ids = [
      "file-index-rescan",
      "action-log-consolidation",
      "waste-detection",
      "learning-memory-reflection",
      "project-suggestions",
      "learning-rules-mine",
      "learning-rules-curate",
    ];
    for (const id of ids) {
      expect(getTaskById(id)).toBeDefined();
    }
  });

  test("returns undefined for unknown ID", () => {
    expect(getTaskById("nonexistent")).toBeUndefined();
  });

  test("file-index-rescan has correct schedule", () => {
    const task = getTaskById("file-index-rescan");
    expect(task!.schedule).toBe("0 */6 * * *");
    expect(task!.actionType).toBe("function");
  });

  test("action-log-consolidation has correct schedule", () => {
    const task = getTaskById("action-log-consolidation");
    expect(task!.schedule).toBe("0 2 * * *");
    expect(task!.actionType).toBe("function");
  });

  test("waste-detection has correct schedule", () => {
    const task = getTaskById("waste-detection");
    expect(task!.schedule).toBe("0 0 * * 1");
    expect(task!.actionType).toBe("function");
  });

  test("learning-memory-reflection is AI-assisted", () => {
    const task = getTaskById("learning-memory-reflection");
    expect(task!.schedule).toBe("0 3 * * 0");
    expect(task!.actionType).toBe("ai-cli");
  });

  test("project-suggestions is AI-assisted", () => {
    const task = getTaskById("project-suggestions");
    expect(task!.schedule).toBe("0 4 * * 1");
    expect(task!.actionType).toBe("ai-cli");
  });
});
