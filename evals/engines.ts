// Engine adapters for the mink-agent retrieval eval.
//
// Each adapter is a single async function: given a question and a run
// context (cwd + env pointed at the isolated fixture vault), it drives a
// headless agent CLI and returns whatever text it printed. The runner
// grades that text against the case's expected paths/substrings.
//
// Only `claude` is implemented today, matching how `mink agent` / `mink
// chat` currently ride Claude Code's own auth. `copilot` and `pi` are
// stubbed so the phase-3 chat work (see docs/plans/2026-07-agent-retrieval-and-chat.md)
// can slot in an adapter without touching the runner or grading logic.

import { spawnSync } from "child_process";

export interface EngineContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface EngineResult {
  ok: boolean;
  output: string;
  error?: string;
}

export type EngineFn = (question: string, ctx: EngineContext) => EngineResult;

/**
 * Drives Claude Code headlessly: `claude -p --agent mink-agent "<question>"`.
 * This is the same invocation shape `mink chat`'s claude adapter will use
 * (phase 3) and mirrors what a user gets from `mink agent` interactively.
 */
function runClaudeEngine(question: string, ctx: EngineContext): EngineResult {
  const result = spawnSync(
    "claude",
    ["-p", "--agent", "mink-agent", question],
    {
      cwd: ctx.cwd,
      env: ctx.env,
      encoding: "utf-8",
      timeout: ctx.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    }
  );

  if (result.error) {
    return { ok: false, output: "", error: result.error.message };
  }
  if (typeof result.status === "number" && result.status !== 0) {
    return {
      ok: false,
      output: result.stdout ?? "",
      error: `claude exited ${result.status}: ${(result.stderr ?? "").slice(0, 500)}`,
    };
  }
  return { ok: true, output: result.stdout ?? "" };
}

function unimplementedEngine(name: string): EngineFn {
  return (_question, _ctx) => ({
    ok: false,
    output: "",
    error: `[mink eval] engine "${name}" is not implemented yet — see docs/plans/2026-07-agent-retrieval-and-chat.md phase 3`,
  });
}

export const ENGINES: Record<string, EngineFn> = {
  claude: runClaudeEngine,
  // copilot: drive `copilot` CLI's headless/programmatic mode (phase 3).
  copilot: unimplementedEngine("copilot"),
  // pi: drive the Pi CLI's headless mode (phase 3).
  pi: unimplementedEngine("pi"),
};

export function isClaudeOnPath(): boolean {
  const result = spawnSync("claude", ["--version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}
