import type { TaskDefinition } from "../types/scheduler";
import { resolveConfigValue } from "./global-config";
import { parseCronExpression } from "./cron-parser";

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
    id: "cli-self-update",
    name: "CLI Self-Update",
    description: "Check npm for a newer mink release and install it (gated by cli.auto-update)",
    schedule: "0 4 * * *",
    actionType: "function",
    enabled: true,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 60_000 },
    timeoutMs: 10 * 60_000,
  },
];

// ── Public API ──────────────────────────────────────────────────────────────

function resolveTaskSchedule(taskId: string, defaultSchedule: string): string {
  if (taskId !== "cli-self-update") return defaultSchedule;
  try {
    const value = resolveConfigValue("cli.auto-update-schedule").value;
    parseCronExpression(value);
    return value;
  } catch {
    return defaultSchedule;
  }
}

function applyDynamicOverrides(task: TaskDefinition): TaskDefinition {
  if (task.id !== "cli-self-update") return task;
  return { ...task, schedule: resolveTaskSchedule(task.id, task.schedule) };
}

export function getBuiltInTasks(): TaskDefinition[] {
  return BUILT_IN_TASKS.map(applyDynamicOverrides);
}

export function getTaskById(id: string): TaskDefinition | undefined {
  const task = BUILT_IN_TASKS.find((t) => t.id === id);
  return task ? applyDynamicOverrides(task) : undefined;
}

// ── AI CLI Execution ────────────────────────────────────────────────────────

const API_KEY_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_KEY",
  "AI_API_KEY",
];

async function executeAiCli(
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !API_KEY_ENV_VARS.includes(key)) {
      env[key] = value;
    }
  }

  const proc = Bun.spawn(["claude", "--print", prompt], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timer);

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`AI CLI exited with code ${exitCode}: ${stderr}`);
    }

    return await new Response(proc.stdout).text();
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.message.includes("ENOENT")) {
      throw new Error(
        "AI CLI (claude) is not available. Install it or ensure it is on PATH."
      );
    }
    throw err;
  }
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

    case "cli-self-update": {
      const { runSelfUpgrade } = await import("./self-update");
      const result = await runSelfUpgrade({
        source: "scheduler",
        interactive: false,
      });
      // Surface non-success results so the scheduler retry/dead-letter logic
      // can react. "skipped" and "up-to-date" are normal outcomes.
      if (result.status === "error") {
        const err = new Error(result.reason);
        if (!result.transient) {
          // Non-transient errors (e.g. no package manager) shouldn't keep retrying;
          // tag the message so the dead-letter logs reflect the cause.
          err.message = `[non-transient] ${err.message}`;
        }
        throw err;
      }
      console.log(`[mink] cli-self-update: ${result.status}`);
      break;
    }

    default:
      throw new Error(`No executor defined for task: ${taskId}`);
  }
}
