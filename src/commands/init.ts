import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { projectDir } from "../core/paths";
import { generateProjectId } from "../core/project-id";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";

interface HookEntry {
  matcher: string;
  command: string;
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
  return {
    SessionStart: [{ matcher: "", command: `${prefix} session-start` }],
    Stop: [{ matcher: "", command: `${prefix} session-stop` }],
    PreToolUse: [
      { matcher: "Read", command: `${prefix} pre-read` },
      { matcher: "Edit", command: `${prefix} pre-write` },
      { matcher: "Write", command: `${prefix} pre-write` },
    ],
    PostToolUse: [
      { matcher: "Read", command: `${prefix} post-read` },
      { matcher: "Edit", command: `${prefix} post-write` },
      { matcher: "Write", command: `${prefix} post-write` },
    ],
  };
}

function isMinkHook(entry: HookEntry): boolean {
  return (
    entry.command.includes("cli") &&
    (entry.command.includes("session-start") ||
      entry.command.includes("session-stop") ||
      entry.command.includes("pre-read") ||
      entry.command.includes("post-read") ||
      entry.command.includes("pre-write") ||
      entry.command.includes("post-write"))
  );
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
