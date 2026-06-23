import { relative } from "path";
import { readFileSync } from "fs";
import { readStdinJson } from "../core/stdin";
import { sessionPath, actionLogShardPath } from "../core/paths";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { createSessionState, isSessionState, recordRead } from "../core/session";
import { FileIndexRepo } from "../repositories/file-index-repo";
import { estimateTokens, isBinaryFile } from "../core/token-estimate";
import { extractDescription } from "../core/description";
import { createActionLogWriter } from "../core/action-log";
import { getOrCreateDeviceId } from "../core/device";
import { compressToolOutput } from "../core/compress-tool-output";
import { emitUpdatedToolOutput } from "../core/hook-output";
import type { SessionState } from "../types/session";
import type { FileIndexEntry, IndexLookup } from "../types/file-index";
import type { PostToolUseInput } from "../types/hook-input";

export interface PostReadResult {
  estimatedTokens: number;
  indexHit: boolean;
  source: "content" | "index-fallback" | "none";
  // Populated when content was available and the file was not already in
  // the index — lets the caller seed the index lazily so that read-only
  // browsing sessions don't accumulate zero index hits.
  indexEntry: FileIndexEntry | null;
}

export function analyzePostRead(
  filePath: string,
  content: string | null,
  index: IndexLookup | null
): PostReadResult {
  // Binary file — skip token estimation
  if (isBinaryFile(filePath, content ?? undefined)) {
    const entry = index ? index.lookupEntry(filePath) : null;
    return {
      estimatedTokens: 0,
      indexHit: !!entry,
      source: "none",
      indexEntry: null,
    };
  }

  // Content available — estimate from actual content
  if (content !== null && content.length > 0) {
    const entry = index ? index.lookupEntry(filePath) : null;
    const tokens = estimateTokens(content, filePath);
    // On miss, build a seed entry so the index grows from reads, not just
    // writes and scans. Description failures must never throw out the read.
    let indexEntry: FileIndexEntry | null = null;
    if (!entry) {
      let description = "";
      try {
        description = extractDescription(filePath, content);
      } catch {
        description = "";
      }
      const now = new Date().toISOString();
      indexEntry = {
        filePath,
        description,
        estimatedTokens: tokens,
        lastModified: now,
        lastIndexed: now,
      };
    }
    return {
      estimatedTokens: tokens,
      indexHit: !!entry,
      source: "content",
      indexEntry,
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
        indexEntry: null,
      };
    }
  }

  return {
    estimatedTokens: 0,
    indexHit: false,
    source: "none",
    indexEntry: null,
  };
}

function isPostToolUseInput(value: unknown): value is PostToolUseInput {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.tool_name !== "string") return false;
  if (typeof obj.tool_input !== "object" || obj.tool_input === null) return false;
  return true;
}

// Pull file content out of the PostToolUse payload. Claude Code has shipped
// at least two payload shapes for the Read tool:
//   • legacy: `tool_output.content` is a plain string
//   • current: `tool_response` carries the content — either as a string, as
//     a Content[]-style array (`{ type: "text", text: "..." }`), or nested
//     under `tool_response.file.content`
// We accept any of them so a hook contract drift can't silently zero out
// token estimation again.
export function extractContent(input: PostToolUseInput): string | null {
  // Current shape — tool_response
  const tr = input.tool_response;
  if (tr) {
    if (typeof tr.content === "string") return tr.content;
    if (Array.isArray(tr.content)) {
      const parts = tr.content
        .map((p) => (p && typeof p.text === "string" ? p.text : ""))
        .filter((s) => s.length > 0);
      if (parts.length > 0) return parts.join("");
    }
    if (tr.file && typeof tr.file.content === "string") {
      return tr.file.content;
    }
    if (typeof tr.text === "string") return tr.text;
  }
  // Legacy shape — tool_output
  if (input.tool_output && typeof input.tool_output.content === "string") {
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

    // Primary path: read content from disk by file path. This is the
    // cleanest source because it doesn't depend on Claude Code's evolving
    // hook payload schema (which has silently dropped `tool_output.content`
    // in favor of nested `tool_response` shapes, breaking token
    // measurement). Mirrors post-write.ts's approach.
    let content: string | null = null;
    try {
      content = readFileSync(absolutePath, "utf-8");
    } catch {
      // File unreadable (permissions, deleted between read and hook) —
      // fall back to whatever the payload carries.
    }
    if (content === null) {
      content = extractContent(input);
    }

    const result = analyzePostRead(filePath, content, repo);

    // Seed the file index on a miss. Read-only browsing sessions otherwise
    // accumulate zero index hits because the index only grows via
    // `mink scan` (capped) or post-write.
    if (result.indexEntry) {
      try {
        repo.upsert(result.indexEntry);
      } catch {
        // Never crash the hook over an index upsert failure.
      }
    }

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

    // Tool-output compression (spec 22). Substitute a compact, reversible
    // summary for a large whole-file read. Skipped for ranged reads (their
    // output is only a slice) and a no-op unless compression is enabled. Uses
    // the on-disk content as the canonical original so signature extraction
    // works on raw source and `mink retrieve` returns the file itself.
    const isRanged =
      input.tool_input.offset != null || input.tool_input.limit != null;
    if (!isRanged && content && content.length > 0) {
      try {
        const outcome = compressToolOutput(cwd, "Read", content, filePath);
        if (outcome) emitUpdatedToolOutput(outcome.updatedToolOutput);
      } catch {
        // Compression is advisory — never break the read over it.
      }
    }
  } catch {
    // Never crash — exit silently
  } finally {
    clearTimeout(timer);
  }
}
