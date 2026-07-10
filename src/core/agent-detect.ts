import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Supported host coding assistants Mink can attach to. Adding a new host is a
// matter of appending an entry here plus an installer in init.ts.
export type AgentId = "claude" | "pi";

export interface AgentMeta {
  id: AgentId;
  label: string;
  /** Project-local config directory that signals the host is used here. */
  projectDir: string;
  /** Per-user global config directory that signals the host is installed. */
  globalDir: string;
  /** Executable name to probe on PATH. */
  bin: string;
}

export const AGENTS: AgentMeta[] = [
  {
    id: "claude",
    label: "Claude Code",
    projectDir: ".claude",
    globalDir: join(homedir(), ".claude"),
    bin: "claude",
  },
  {
    id: "pi",
    label: "Pi",
    projectDir: ".pi",
    globalDir: join(homedir(), ".pi"),
    bin: "pi",
  },
];

export interface AgentInfo extends AgentMeta {
  detected: boolean;
  /** Human-readable reasons the host was (or was not) detected. */
  signals: string[];
}

function commandExists(bin: string): boolean {
  try {
    const probe = process.platform === "win32" ? `where ${bin}` : `command -v ${bin}`;
    execSync(probe, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Inspect a single host's footprint relative to `cwd`. Detection is best-effort
 * and layered, strongest signal first: a project-local config directory is the
 * clearest sign the host is actually used here; a global config directory or a
 * binary on PATH only prove the host is installed somewhere.
 */
export function detectAgent(meta: AgentMeta, cwd: string): AgentInfo {
  const signals: string[] = [];
  if (existsSync(join(cwd, meta.projectDir))) {
    signals.push(`project config (${meta.projectDir}/)`);
  }
  if (existsSync(meta.globalDir)) {
    signals.push("global config");
  }
  if (commandExists(meta.bin)) {
    signals.push("on PATH");
  }
  return { ...meta, detected: signals.length > 0, signals };
}

export function detectAgents(cwd: string): AgentInfo[] {
  return AGENTS.map((m) => detectAgent(m, cwd));
}

export function resolveTargetsFromFlag(flag: string): AgentId[] {
  const normalized = flag.trim().toLowerCase();
  if (normalized === "all") return AGENTS.map((a) => a.id);
  const ids = normalized
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = AGENTS.map((a) => a.id) as string[];
  const resolved = ids.filter((id): id is AgentId => valid.includes(id));
  return resolved;
}
