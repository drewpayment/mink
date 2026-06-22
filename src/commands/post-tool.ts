// Generic PostToolUse compression hook (spec 21) for tools that produce large,
// non-file output — Bash, Grep/Glob, and MCP tools. The Read tool is handled by
// post-read (which has the on-disk content and ranged-read awareness); this hook
// compresses the payload text directly.
//
// Like every Mink hook: non-blocking, time-boxed, and silent on failure. It is a
// no-op unless compression is enabled, so wiring it up costs nothing until the
// user opts in.

import { readStdinJson } from "../core/stdin";
import { extractToolOutputText, emitUpdatedToolOutput } from "../core/hook-output";
import { compressToolOutput } from "../core/compress-tool-output";
import type { PostToolUseInput } from "../types/hook-input";

function isPostToolUseInput(value: unknown): value is PostToolUseInput {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.tool_name === "string";
}

// Tools whose output we compress here. Read is excluded (post-read owns it).
function isCompressibleTool(toolName: string): boolean {
  return (
    toolName === "Bash" ||
    toolName === "Grep" ||
    toolName === "Glob" ||
    toolName.startsWith("mcp__")
  );
}

export async function postTool(cwd: string): Promise<void> {
  const timer = setTimeout(() => process.exit(0), 5000);
  try {
    const input = await readStdinJson();
    if (!isPostToolUseInput(input)) return;
    if (!isCompressibleTool(input.tool_name)) return;

    const output = extractToolOutputText(input);
    if (!output) return;

    const outcome = compressToolOutput(cwd, input.tool_name, output);
    if (outcome) emitUpdatedToolOutput(outcome.updatedToolOutput);
  } catch {
    // Never crash — exit silently.
  } finally {
    clearTimeout(timer);
  }
}
