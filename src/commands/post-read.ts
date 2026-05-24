import { relative } from "path";
import { readStdinJson } from "../core/stdin";
import { sessionPath, actionLogShardPath } from "../core/paths";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { createSessionState, isSessionState, recordRead } from "../core/session";
import { FileIndexRepo } from "../repositories/file-index-repo";
import { estimateTokens, isBinaryFile } from "../core/token-estimate";
import { createActionLogWriter } from "../core/action-log";
import { getOrCreateDeviceId } from "../core/device";
import type { SessionState } from "../types/session";
import type { IndexLookup } from "../types/file-index";
import type { PostToolUseInput } from "../types/hook-input";

export interface PostReadResult {
  estimatedTokens: number;
  indexHit: boolean;
  source: "content" | "index-fallback" | "none";
}

export function analyzePostRead(
  filePath: string,
  content: string | null,
  index: IndexLookup | null
): PostReadResult {
  // Binary file — skip token estimation
  if (isBinaryFile(filePath, content ?? undefined)) {
    const entry = index ? index.lookupEntry(filePath) : null;
    return { estimatedTokens: 0, indexHit: !!entry, source: "none" };
  }

  // Content available — estimate from actual content
  if (content !== null && content.length > 0) {
    const entry = index ? index.lookupEntry(filePath) : null;
    return {
      estimatedTokens: estimateTokens(content, filePath),
      indexHit: !!entry,
      source: "content",
    };
  }

  // No content — try file index fallback
  if (index) {
    const entry = index.lookupEntry(filePath);
    if (entry) {
      return {
        estimatedTokens: entry.estimatedTokens,
        indexHit: true,
        source: "index-fallback",
      };
    }
  }

  return { estimatedTokens: 0, indexHit: false, source: "none" };
}

function isPostToolUseInput(value: unknown): value is PostToolUseInput {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.tool_name !== "string") return false;
  if (typeof obj.tool_input !== "object" || obj.tool_input === null) return false;
  return true;
}

function extractContent(input: PostToolUseInput): string | null {
  if (!input.tool_output) return null;
  if (typeof input.tool_output.content === "string") {
    return input.tool_output.content;
  }
  return null;
}

export async function postRead(cwd: string): Promise<void> {
  // 5-second safety timeout
  const timer = setTimeout(() => process.exit(0), 5000);

  try {
    const input = await readStdinJson();
    if (!isPostToolUseInput(input)) return;
    if (input.tool_name !== "Read") return;

    const absolutePath = input.tool_input.file_path;
    if (!absolutePath) return;

    const filePath = relative(cwd, absolutePath);

    // Load session state (create fresh if missing)
    const rawState = safeReadJson(sessionPath(cwd));
    const state: SessionState = isSessionState(rawState)
      ? rawState
      : createSessionState();

    // File index repository — one-key lookup, no whole-index load.
    const repo = FileIndexRepo.for(cwd);

    // Extract content from tool output
    const content = extractContent(input);

    const result = analyzePostRead(filePath, content, repo);

    // Record the read in session state
    recordRead(state, filePath, result.estimatedTokens, result.indexHit);

    // Append read entry to this device's action log shard
    try {
      const logWriter = createActionLogWriter(
        actionLogShardPath(cwd, getOrCreateDeviceId())
      );
      logWriter.appendReadEntry(
        new Date().toISOString(),
        filePath,
        result.indexHit,
        result.estimatedTokens
      );
    } catch {
      // Never crash
    }

    // Persist state
    atomicWriteJson(sessionPath(cwd), state);
  } catch {
    // Never crash — exit silently
  } finally {
    clearTimeout(timer);
  }
}
