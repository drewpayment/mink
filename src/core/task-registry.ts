import type { TaskDefinition } from "../types/scheduler";
import { executeAiCli } from "./llm-runner";

// Re-export so existing callers that imported it from task-registry keep working.
export { executeAiCli };

// ── Built-in Task Definitions ───────────────────────────────────────────────

const BUILT_IN_TASKS: TaskDefinition[] = [
  {
    id: "file-index-rescan",
    name: "File Index Rescan",
    description: "Full project scan to update the file index",
    schedule: "0 */6 * * *",
    actionType: "function",
    enabled: true,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 60_000 },
    timeoutMs: 120_000,
  },
  {
    id: "action-log-consolidation",
    name: "Action Log Consolidation",
    description: "Compress old sessions in the action log",
    schedule: "0 2 * * *",
    actionType: "function",
    enabled: true,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 60_000 },
    timeoutMs: 60_000,
  },
  {
    id: "waste-detection",
    name: "Waste Detection",
    description: "Analyze token usage for waste patterns",
    schedule: "0 0 * * 1",
    actionType: "function",
    enabled: true,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 60_000 },
    timeoutMs: 120_000,
  },
  {
    id: "learning-memory-reflection",
    name: "Learning Memory Reflection",
    description: "AI-assisted review and pruning of the learning memory",
    schedule: "0 3 * * 0",
    actionType: "ai-cli",
    enabled: true,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 60_000 },
    timeoutMs: 300_000,
  },
  {
    id: "project-suggestions",
    name: "Project Suggestions",
    description: "AI-assisted analysis generating improvement suggestions",
    schedule: "0 4 * * 1",
    actionType: "ai-cli",
    enabled: true,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 60_000 },
    timeoutMs: 300_000,
  },
  {
    id: "learning-rules-mine",
    name: "Learning Rules — Mine",
    description: "Mine the action log for new learning rules via the AI CLI",
    schedule: "30 3 * * *",
    actionType: "ai-cli",
    enabled: true,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 60_000 },
    timeoutMs: 300_000,
  },
  {
    id: "learning-rules-curate",
    name: "Learning Rules — Curate",
    description: "AI-driven dedupe and contradiction sweep over the learning memory",
    schedule: "30 4 * * 1",
    actionType: "ai-cli",
    enabled: true,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 60_000 },
    timeoutMs: 300_000,
  },
];

// ── Public API ──────────────────────────────────────────────────────────────

export function getBuiltInTasks(): TaskDefinition[] {
  return BUILT_IN_TASKS;
}

export function getTaskById(id: string): TaskDefinition | undefined {
  return BUILT_IN_TASKS.find((t) => t.id === id);
}

// ── Task Execution ──────────────────────────────────────────────────────────

export async function executeTask(
  taskId: string,
  projectCwd: string
): Promise<void> {
  const task = getTaskById(taskId);
  if (!task) {
    throw new Error(`Unknown task: ${taskId}`);
  }

  switch (taskId) {
    case "file-index-rescan": {
      const { scan } = await import("../commands/scan");
      scan(projectCwd, { check: false });
      break;
    }

    case "action-log-consolidation": {
      const { actionLogPath, configPath } = await import("./paths");
      const { consolidateLog } = await import("./action-log");
      const { safeReadJson } = await import("./fs-utils");
      const config = safeReadJson(configPath(projectCwd)) as {
        actionLogMaxEntries?: number;
        actionLogRetentionDays?: number;
      } | null;
      consolidateLog(actionLogPath(projectCwd), {
        maxEntries: config?.actionLogMaxEntries ?? 200,
        retentionDays: config?.actionLogRetentionDays ?? 7,
      });
      break;
    }

    case "waste-detection": {
      const { detectWaste } = await import("../commands/detect-waste");
      detectWaste(projectCwd);
      break;
    }

    case "learning-memory-reflection": {
      if (task.actionType === "ai-cli") {
        try {
          const { learningMemoryPath } = await import("./paths");
          const { readFileSync } = await import("fs");
          let memoryContent: string;
          try {
            memoryContent = readFileSync(
              learningMemoryPath(projectCwd),
              "utf-8"
            );
          } catch {
            console.log("[mink] no learning memory found, skipping reflection");
            return;
          }
          const prompt = `Review and suggest pruning for this learning memory. Remove duplicates and outdated entries. Return the cleaned markdown:\n\n${memoryContent}`;
          await executeAiCli(prompt, task.timeoutMs);
        } catch {
          // Fall back to local reflection
          console.log(
            "[mink] AI CLI unavailable, falling back to local reflection"
          );
        }
      }
      // Always run local reflection (either as primary or fallback)
      const { reflect } = await import("../commands/reflect");
      const { learningMemoryPath, configPath, projectDir } = await import(
        "./paths"
      );
      reflect(projectDir(projectCwd), learningMemoryPath(projectCwd), configPath(projectCwd));
      break;
    }

    case "project-suggestions": {
      console.log(
        "[mink] project-suggestions: not yet implemented — skipping"
      );
      break;
    }

    case "learning-rules-mine": {
      const { runMine } = await import("./llm-rules");
      await runMine(projectCwd, task.timeoutMs);
      break;
    }

    case "learning-rules-curate": {
      const { runCurate } = await import("./llm-rules");
      await runCurate(projectCwd, task.timeoutMs);
      break;
    }

    default:
      throw new Error(`No executor defined for task: ${taskId}`);
  }
}
