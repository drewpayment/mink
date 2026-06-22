import { execSync } from "child_process";
import { mkdirSync, existsSync } from "fs";
import { resolve, dirname, basename, join } from "path";
import { projectDir, projectMetaPath } from "../core/paths";
import { resolveProjectIdentity } from "../core/project-id";
import { atomicWriteJson, atomicWriteText, safeReadJson } from "../core/fs-utils";
import { getOrCreateDeviceId } from "../core/device";
import { getRepoRoot, getRepoRemote } from "../core/git-identity";
import {
  isWikiEnabled,
  isVaultInitialized,
  isInsideVault,
  vaultProjects,
} from "../core/vault";

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

// Exported for unit testing — accepts the caller's effective import.meta.url
// path so test cases can simulate every runtime form without juggling
// real filesystem layouts.
export function resolveCliPathFrom(selfPath: string): string {
  // After `bun build`, import.meta.url for any bundled module points to
  // whichever bundle was loaded:
  //   - dist/cli.js       (legacy single-file build)
  //   - dist/cli.bun.js   (current Bun bundle)
  //   - dist/cli.node.js  (current Node bundle)
  // In source-dev mode it points to src/commands/init.ts. Mapping any of the
  // bundled forms to dist/cli.js (the bin shim) keeps buildHooksConfig on the
  // portable `mink <subcmd>` path; only the source-dev fallback emits a
  // `bun run <abs>/cli.ts` command.
  const selfDir = dirname(selfPath);

  // Running from any of the dist bundles → use the bin shim path. That file
  // ships as the npm `bin` entry, so it always sits next to the bundles.
  if (
    selfPath.endsWith("dist/cli.js") ||
    selfPath.endsWith("dist/cli.bun.js") ||
    selfPath.endsWith("dist/cli.node.js")
  ) {
    return join(selfDir, "cli.js");
  }

  // Source-dev: init.ts lives at src/commands/init.ts. Walk up to the package
  // root and prefer dist/cli.js if a build is present, otherwise the source.
  const packageRoot = resolve(selfDir, "..", "..");
  const distShim = join(packageRoot, "dist", "cli.js");
  if (existsSync(distShim)) return distShim;
  return join(packageRoot, "src", "cli.ts");
}

export function resolveCliPath(): string {
  return resolveCliPathFrom(new URL(import.meta.url).pathname);
}

export function buildHooksConfig(cliPath: string): HooksConfig {
  // For installed packages emit the `mink` bin shim so the resulting
  // .claude/settings.json is portable across machines, users, and runtimes
  // when committed to git (issue #55). For source-dev mode (cli.ts) the shim
  // isn't on PATH, so fall back to `bun run <abs path>`.
  const isTsSource = cliPath.endsWith(".ts");
  const prefix = isTsSource ? `bun run ${cliPath}` : "mink";
  const hook = (cmd: string): HookCommand[] => [{ type: "command", command: cmd }];
  return {
    SessionStart: [{ matcher: "", hooks: hook(`${prefix} session-start`) }],
    Stop: [{ matcher: "", hooks: hook(`${prefix} session-stop`) }],
    PreToolUse: [
      { matcher: "Read", hooks: hook(`${prefix} pre-read`) },
      { matcher: "Edit", hooks: hook(`${prefix} pre-write`) },
      { matcher: "Write", hooks: hook(`${prefix} pre-write`) },
    ],
    PostToolUse: [
      { matcher: "Read", hooks: hook(`${prefix} post-read`) },
      { matcher: "Edit", hooks: hook(`${prefix} post-write`) },
      { matcher: "Write", hooks: hook(`${prefix} post-write`) },
      // Tool-output compression (spec 21) — a no-op until enabled via config.
      { matcher: "Bash", hooks: hook(`${prefix} post-tool`) },
      { matcher: "Grep", hooks: hook(`${prefix} post-tool`) },
    ],
  };
}

function isMinkCommand(cmd: string): boolean {
  const hasMinkSubcommand =
    cmd.includes("session-start") ||
    cmd.includes("session-stop") ||
    cmd.includes("pre-read") ||
    cmd.includes("post-read") ||
    cmd.includes("pre-write") ||
    cmd.includes("post-write") ||
    cmd.includes("post-tool");
  if (!hasMinkSubcommand) return false;
  // Match the new bin-shim format (`mink <subcmd>` or `/abs/path/to/mink <subcmd>`)
  // as well as legacy formats (`bun run .../cli.js ...`, `node .../cli.js ...`,
  // `bun run .../cli.ts ...`) so re-init replaces stale entries instead of
  // duplicating them.
  if (/(^|\/|\s)mink\s/.test(cmd)) return true;
  return cmd.includes("cli.js") || cmd.includes("cli.ts");
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

const MINK_RULE_CONTENT = `---
description: Mink context management — automatic via hooks
---

This project uses **Mink** (\`@drewpayment/mink\`) for cross-session context management.

## How it works
- Mink runs automatically through Claude Code hooks configured in \`.claude/settings.json\` (SessionStart, PreToolUse, PostToolUse, Stop).
- All state lives in \`~/.mink/\` on the user's machine — **not** in this repository. Do not create or write to any in-repo state directory (no \`.wolf/\`, \`.mink/\`, etc.).
- Read intelligence, write enforcement, bug memory, and the token ledger are handled by the hooks. You do not need to manually read or update any state files.

## When to act on Mink
- If the user asks to "save a note", "remember this", "log this to my wiki", or similar, use the \`mink-note\` skill — it captures into the user's \`~/.mink/\` vault.
- If a hook surfaces a learning, past bug, or repeat-read warning, treat that as authoritative project memory and follow it.
- The \`mink dashboard\` and \`mink agent\` commands are user tools — do not invoke them on the user's behalf.
`;

export function writeMinkRule(cwd: string): string {
  const rulePath = resolve(cwd, ".claude", "rules", "mink.md");
  mkdirSync(dirname(rulePath), { recursive: true });
  atomicWriteText(rulePath, MINK_RULE_CONTENT);
  return rulePath;
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

function isExistingInstallation(cwd: string): boolean {
  const dir = projectDir(cwd);
  if (!existsSync(dir)) return false;
  return existsSync(join(dir, "file-index.json"));
}

export async function init(cwd: string): Promise<void> {
  const runtime = detectRuntime();
  const cliPath = resolveCliPath();
  const hooks = buildHooksConfig(cliPath);
  const settingsPath = resolve(cwd, ".claude", "settings.json");
  const dir = projectDir(cwd);
  const upgrading = isExistingInstallation(cwd);

  if (upgrading) {
    console.log("[mink] existing installation detected, upgrading...");
    const { createBackup } = await import("../core/backup");
    const backupName = createBackup(cwd);
    console.log(`  backup: ${backupName}`);
  }

  mergeHooksIntoSettings(settingsPath, hooks);
  const rulePath = writeMinkRule(cwd);

  mkdirSync(dir, { recursive: true });

  const identity = resolveProjectIdentity(cwd);
  const projectId = identity.id;

  // Detect notes project type
  const isNotesProject =
    isWikiEnabled() && isVaultInitialized() && isInsideVault(cwd);

  // Write project metadata. Lift cwd into the per-device map alongside the
  // legacy singular field so older mink versions (which only read `cwd`) keep
  // working after a downgrade and new versions can track each device's path.
  const metaPath = projectMetaPath(cwd);
  const existingMeta = safeReadJson(metaPath) as Record<string, unknown> | null;
  const deviceId = getOrCreateDeviceId();
  const existingPathsByDevice =
    existingMeta?.pathsByDevice &&
    typeof existingMeta.pathsByDevice === "object" &&
    !Array.isArray(existingMeta.pathsByDevice)
      ? (existingMeta.pathsByDevice as Record<string, string>)
      : {};
  atomicWriteJson(metaPath, {
    ...(existingMeta ?? {}),
    cwd,
    name: basename(cwd),
    initTimestamp: existingMeta?.initTimestamp ?? new Date().toISOString(),
    version: "0.1.0",
    pathsByDevice: { ...existingPathsByDevice, [deviceId]: cwd },
    ...(isNotesProject ? { projectType: "notes" } : {}),
  });

  if (upgrading) {
    console.log(`[mink] upgrade complete`);
    console.log(`  project:  ${projectId}`);
    console.log(`  hooks:    ${settingsPath}`);
    console.log(`  rule:     ${rulePath}`);
  } else {
    console.log(`[mink] initialized`);
    console.log(`  project:  ${projectId} (${identity.source})`);
    console.log(`  state:    ${dir}`);
    console.log(`  runtime:  ${runtime}`);
    console.log(`  hooks:    ${settingsPath}`);
    console.log(`  rule:     ${rulePath}`);
  }

  // Surface a one-time hint when the project is in a git repo with no remote
  // configured — that's the only case where stable cross-machine identity is
  // a config-fix away.
  if (identity.source === "path-derived") {
    const root = getRepoRoot(cwd);
    if (root && !getRepoRemote(cwd)) {
      console.log(
        `  note:     this repo has no remote configured. Project state will not unify across machines until you add one and run \`mink config projects.identity git-remote\`.`
      );
    }
  }

  // Run initial scan
  const { scan } = await import("./scan");
  scan(cwd, { check: false });

  // Seed learning memory if it doesn't exist
  const { learningMemoryPath } = await import("../core/paths");
  const memPath = learningMemoryPath(cwd);
  if (!existsSync(memPath)) {
    const { seedLearningMemory } = await import("../core/seed");
    const { serializeLearningMemory } = await import("../core/learning-memory");
    const mem = seedLearningMemory(cwd);
    atomicWriteText(memPath, serializeLearningMemory(mem));
  }

  // Create wiki project overview if wiki is enabled
  if (isWikiEnabled() && isVaultInitialized() && !isNotesProject) {
    try {
      const projectSlug = basename(cwd);
      const overviewPath = join(vaultProjects(projectSlug), "overview.md");
      if (!existsSync(overviewPath)) {
        const now = new Date().toISOString();
        const overview = [
          `---`,
          `created: "${now}"`,
          `updated: "${now}"`,
          `tags: [project, ${projectSlug}]`,
          `category: projects`,
          `---`,
          ``,
          `# ${projectSlug}`,
          ``,
          `**Path**: \`${cwd}\``,
          `**Initialized**: ${now.split("T")[0]}`,
          ``,
          `## Overview`,
          ``,
          `## Key Decisions`,
          ``,
          `## Links`,
          ``,
        ].join("\n");
        atomicWriteText(overviewPath, overview);
        console.log(`  wiki:     ${overviewPath}`);
      }
    } catch {
      // Non-critical — don't fail init
    }
  }
}
