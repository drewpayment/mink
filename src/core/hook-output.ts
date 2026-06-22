// Helpers for PostToolUse hooks that replace a tool's result (spec 21). The
// replacement mechanism is Claude Code's `hookSpecificOutput.updatedToolOutput`
// (verified against the hooks reference): whatever JSON we print to stdout here
// substitutes the original output before the model sees it.

import type { PostToolUseInput } from "../types/hook-input";

// Best-effort extraction of the human-visible text from a PostToolUse payload,
// across the shapes Claude Code uses for different tools (Bash stdout, Grep
// content, MCP results). Returns null when no text is present, in which case the
// caller must not compress (there is nothing to safely capture or replace).
export function extractToolOutputText(input: PostToolUseInput): string | null {
  const tr = input.tool_response as Record<string, unknown> | undefined;
  if (tr) {
    if (typeof tr.content === "string") return tr.content;
    if (Array.isArray(tr.content)) {
      const parts = (tr.content as Array<{ text?: unknown }>)
        .map((p) => (p && typeof p.text === "string" ? p.text : ""))
        .filter((s) => s.length > 0);
      if (parts.length > 0) return parts.join("");
    }
    if (typeof tr.stdout === "string" && tr.stdout.length > 0) return tr.stdout;
    if (typeof tr.text === "string") return tr.text;
    const file = tr.file as { content?: unknown } | undefined;
    if (file && typeof file.content === "string") return file.content;
  }
  const to = input.tool_output;
  if (to && typeof to.content === "string") return to.content;
  return null;
}

// Print the replacement so Claude Code swaps it in for the original output.
export function emitUpdatedToolOutput(text: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolOutput: text,
      },
    })
  );
}
