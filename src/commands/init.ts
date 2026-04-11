import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { projectDir } from "../core/paths";
import { generateProjectId } from "../core/project-id";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";

interface HookCommand {
  type: "command";
  command: string;
}

interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}

type HooksConfig = Record<string, HookEntry[]>;

export function detectRuntime(): "bun" | "node" {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return "bun";
  } catch {
    return "node";
  }
}

export function buildHooksConfig(
  runtime: "bun" | "node",
  cliPath: string
): HooksConfig {
  const prefix = runtime === "bun" ? `bun run ${cliPath}` : `node ${cliPath}`;
  const hook = (cmd: string): HookCommand[] => [{ type: "command", command: cmd }];
  return {
    SessionStart: [{ matcher: "", hooks: hook(`${prefix} session-start`) }],
    Stop: [{ matcher: "", hooks: hook(`${prefix} session-stop`) }],
  };
}

function isMinkCommand(cmd: string): boolean {
  return (
    cmd.includes("cli") &&
    (cmd.includes("session-start") ||
      cmd.includes("session-stop"))
  );
}

function isMinkHook(entry: HookEntry | Record<string, unknown>): boolean {
  // Handle current format: { matcher, hooks: [{ type, command }] }
  if (Array.isArray((entry as HookEntry).hooks)) {
    return (entry as HookEntry).hooks.some((h) => isMinkCommand(h.command));
  }
  // Handle legacy format: { matcher, command }
  if (typeof (entry as Record<string, unknown>).command === "string") {
    return isMinkCommand((entry as Record<string, unknown>).command as string);
  }
  return false;
}

export function mergeHooksIntoSettings(
  settingsPath: string,
  newHooks: HooksConfig
): void {
  mkdirSync(dirname(settingsPath), { recursive: true });

  const existing = (safeReadJson(settingsPath) as Record<string, unknown>) ?? {};
  const existingHooks = (existing.hooks ?? {}) as HooksConfig;

  // For each hook type mink manages, remove old mink entries then add new ones
  for (const [event, entries] of Object.entries(newHooks)) {
    const current = existingHooks[event] ?? [];
    const withoutMink = current.filter((e) => !isMinkHook(e));
    existingHooks[event] = [...withoutMink, ...entries];
  }

  existing.hooks = existingHooks;
  atomicWriteJson(settingsPath, existing);
}

export async function init(cwd: string): Promise<void> {
  const runtime = detectRuntime();
  const cliPath = resolve(dirname(new URL(import.meta.url).pathname), "../cli.ts");
  const hooks = buildHooksConfig(runtime, cliPath);
  const settingsPath = resolve(cwd, ".claude", "settings.json");

  mergeHooksIntoSettings(settingsPath, hooks);

  const dir = projectDir(cwd);
  mkdirSync(dir, { recursive: true });

  const projectId = generateProjectId(cwd);
  console.log(`[mink] initialized`);
  console.log(`  project:  ${projectId}`);
  console.log(`  state:    ${dir}`);
  console.log(`  runtime:  ${runtime}`);
  console.log(`  hooks:    ${settingsPath}`);

  // Run initial scan
  const { scan } = await import("./scan");
  scan(cwd, { check: false });

  // Seed learning memory if it doesn't exist
  const { existsSync } = await import("fs");
  const { learningMemoryPath } = await import("../core/paths");
  const memPath = learningMemoryPath(cwd);
  if (!existsSync(memPath)) {
    const { seedLearningMemory } = await import("../core/seed");
    const { serializeLearningMemory } = await import("../core/learning-memory");
    const { atomicWriteText } = await import("../core/fs-utils");
    const mem = seedLearningMemory(cwd);
    atomicWriteText(memPath, serializeLearningMemory(mem));
  }
}
