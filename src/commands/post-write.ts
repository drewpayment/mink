import { relative } from "path";
import { readFileSync } from "fs";
import { readStdinJson } from "../core/stdin";
import { sessionPath, fileIndexPath, actionLogShardPath } from "../core/paths";
import { getOrCreateDeviceId } from "../core/device";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { createSessionState, isSessionState, recordWrite } from "../core/session";
import {
  isFileIndex,
  lookupEntry,
  upsertEntry,
  createEmptyIndex,
} from "../core/index-store";
import { extractDescription } from "../core/description";
import { estimateTokens, isBinaryFile } from "../core/token-estimate";
import { isWriteExcluded } from "../core/write-exclusions";
import { createActionLogWriter } from "../core/action-log";
import type { SessionState } from "../types/session";
import type { FileIndex, FileIndexEntry } from "../types/file-index";
import type { PostToolUseInput } from "../types/hook-input";

export interface PostWriteResult {
  excluded: boolean;
  action: "create" | "edit";
  estimatedTokens: number;
  description: string;
  indexEntry: FileIndexEntry | null;
}

export function analyzePostWrite(
  filePath: string,
  fileContent: string | null,
  index: FileIndex | null
): PostWriteResult {
  // Check exclusions
  if (isWriteExcluded(filePath)) {
    return {
      excluded: true,
      action: "edit",
      estimatedTokens: 0,
      description: "",
      indexEntry: null,
    };
  }

  // Determine action from index presence
  const existingEntry = index ? lookupEntry(index, filePath) : null;
  const action: "create" | "edit" = existingEntry ? "edit" : "create";

  // Handle binary or unreadable content
  if (fileContent === null || isBinaryFile(filePath, fileContent)) {
    return {
      excluded: false,
      action,
      estimatedTokens: 0,
      description: "",
      indexEntry: null,
    };
  }

  // Extract description and estimate tokens
  const description = extractDescription(filePath, fileContent);
  const tokens = estimateTokens(fileContent, filePath);

  // Build index entry
  const now = new Date().toISOString();
  const indexEntry: FileIndexEntry = {
    filePath,
    description,
    estimatedTokens: tokens,
    lastModified: now,
    lastIndexed: now,
  };

  return {
    excluded: false,
    action,
    estimatedTokens: tokens,
    description,
    indexEntry,
  };
}

function isPostToolUseInput(value: unknown): value is PostToolUseInput {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.tool_name !== "string") return false;
  if (typeof obj.tool_input !== "object" || obj.tool_input === null) return false;
  return true;
}

export async function postWrite(cwd: string): Promise<void> {
  // 10-second safety timeout (longer due to file I/O + index updates)
  const timer = setTimeout(() => process.exit(0), 10000);

  try {
    const input = await readStdinJson();
    if (!isPostToolUseInput(input)) return;
    if (input.tool_name !== "Write" && input.tool_name !== "Edit") return;

    const absolutePath = input.tool_input.file_path;
    if (!absolutePath) return;

    const filePath = relative(cwd, absolutePath);

    // Read file content from disk (post-write — file now exists)
    let fileContent: string | null = null;
    try {
      fileContent = readFileSync(absolutePath, "utf-8");
    } catch {
      // File unreadable (permissions, race condition) — continue with null
    }

    // Load session state
    const rawState = safeReadJson(sessionPath(cwd));
    const state: SessionState = isSessionState(rawState)
      ? rawState
      : createSessionState();

    // Load file index
    const rawIndex = safeReadJson(fileIndexPath(cwd));
    const index: FileIndex = isFileIndex(rawIndex) ? rawIndex : createEmptyIndex();

    const result = analyzePostWrite(filePath, fileContent, index);

    if (result.excluded) return;

    // 1. File index update
    if (result.indexEntry) {
      upsertEntry(index, result.indexEntry);
    }

    // 2. Action log entry — write to this device's shard
    try {
      const logWriter = createActionLogWriter(
        actionLogShardPath(cwd, getOrCreateDeviceId())
      );
      logWriter.appendWriteEntry(
        new Date().toISOString(),
        filePath,
        result.action,
        result.description,
        result.estimatedTokens
      );
    } catch {
      // Never crash
    }

    // 3. Session state update
    recordWrite(state, filePath, result.action, result.estimatedTokens);

    // Persist state changes
    atomicWriteJson(sessionPath(cwd), state);
    atomicWriteJson(fileIndexPath(cwd), index);
  } catch {
    // Never crash — exit silently
  } finally {
    clearTimeout(timer);
  }
}
