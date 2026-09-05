import { copyFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { atomicWriteJson } from "./fs-utils";

type Handler = { type?: string; command?: string; [key: string]: unknown };
type Group = { hooks: Handler[]; [key: string]: unknown };
type Config = { hooks?: Record<string, Group[]>; [key: string]: unknown };

export const CODEX_GUIDANCE =
  "Mink note access is available through the mink-note skill and the `mink note` CLI. " +
  "Search existing notes before capturing durable decisions or verified findings. " +
  "Keep state in the user's Mink vault, never in an in-repository .mink directory. " +
  "This experimental Codex integration records lifecycle receipts only; automatic " +
  "file accounting, shared session-ledger integration, and compression are not enabled. " +
  "Do not claim token savings from installed hooks. Use `mink codex-status` and Codex /hooks to verify setup.";

export function codexHooksPath(cwd: string): string {
  return join(cwd, ".codex", "hooks.json");
}

// Match only this adapter's exact command, including its source-dev form.
// Similar-looking user commands must survive installation and removal.
function isOwned(handler: Handler): boolean {
  return handler.type === "command" && typeof handler.command === "string" && (
    handler.command === "mink codex-hook" ||
    /^bun run '(?:[^']|'\\'')*\/src\/cli\.ts' codex-hook$/.test(handler.command)
  );
}

export function readCodexConfig(cwd: string): Config {
  const path = codexHooksPath(cwd);
  if (!existsSync(path)) return {};
  const config = JSON.parse(readFileSync(path, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config) ||
      (config.hooks !== undefined && (!config.hooks || typeof config.hooks !== "object" ||
        Array.isArray(config.hooks) || Object.values(config.hooks).some((groups) =>
          !Array.isArray(groups) || groups.some((g) => !g || typeof g !== "object" ||
            !Array.isArray(g.hooks) || g.hooks.some((h: unknown) => !h || typeof h !== "object")))))) {
    throw new Error(`Invalid Codex hooks configuration: ${path}; repair it before installing Mink`);
  }
  return config;
}

export function configuredCodexEvents(cwd: string): string[] {
  return Object.entries(readCodexConfig(cwd).hooks ?? {})
    .filter(([, groups]) => groups.some((g) => g.hooks.some(isOwned)))
    .map(([event]) => event);
}

/** Walk upward so hooks also work when Codex starts inside a repo subdirectory. */
export function codexProjectRoot(cwd: string): string {
  let root = resolve(cwd);
  while (true) {
    if (configuredCodexEvents(root).length > 0) return root;
    const parent = dirname(root);
    if (parent === root) return resolve(cwd);
    root = parent;
  }
}

function withoutMink(config: Config): Config {
  const hooks = { ...config.hooks };
  for (const [event, groups] of Object.entries(hooks)) {
    hooks[event] = groups.flatMap((group) => {
      if (!group.hooks.some(isOwned)) return [group];
      const remaining = group.hooks.filter((h) => !isOwned(h));
      return remaining.length ? [{ ...group, hooks: remaining }] : [];
    });
  }
  return { ...config, hooks };
}

export function installCodex(cwd: string, cliPath: string): { hooksPath: string; notePath: string } {
  const config = withoutMink(readCodexConfig(cwd));
  const command = cliPath.endsWith(".ts")
    ? `bun run '${cliPath.replaceAll("'", "'\\''")}' codex-hook`
    : "mink codex-hook";
  for (const event of ["SessionStart", "SessionEnd"]) {
    config.hooks![event] = [...(config.hooks![event] ?? []), {
      hooks: [{ type: "command", command, timeout: 3 }],
    }];
  }
  const hooksPath = codexHooksPath(cwd);
  atomicWriteJson(hooksPath, config);

  // Codex discovers repository skills in .agents/skills. Keep the shared note
  // skill as the source of truth; do not rewrite AGENTS.md or trust settings.
  const notePath = join(cwd, ".agents", "skills", "mink-note", "SKILL.md");
  const selfPath = fileURLToPath(import.meta.url);
  const source = resolve(dirname(selfPath), selfPath.endsWith(".ts") ? "../../skills" : "../skills",
    "mink-note/SKILL.md");
  mkdirSync(dirname(notePath), { recursive: true });
  copyFileSync(source, notePath);
  return { hooksPath, notePath };
}

/** Disable only Mink handlers. Retain the note skill and all captured state. */
export function removeCodexHooks(cwd: string): void {
  if (existsSync(codexHooksPath(cwd))) {
    atomicWriteJson(codexHooksPath(cwd), withoutMink(readCodexConfig(cwd)));
  }
}
