import { relative } from "path";
import { readStdinJson } from "../core/stdin";
import { sessionPath, fileIndexPath } from "../core/paths";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { createSessionState, isSessionState } from "../core/session";
import {
  isFileIndex,
  lookupEntry,
  recordHit,
  recordMiss,
} from "../core/index-store";
import type { SessionState } from "../types/session";
import type { FileIndex, FileIndexEntry } from "../types/file-index";
import type { PreToolUseInput } from "../types/hook-input";

export interface PreReadResult {
  warnings: string[];
  indexHit: boolean;
  repeatedRead: boolean;
  entry: FileIndexEntry | null;
}

export function analyzePreRead(
  filePath: string,
  state: SessionState,
  index: FileIndex | null
): PreReadResult {
  const warnings: string[] = [];
  let repeatedRead = false;
  let indexHit = false;
  let entry: FileIndexEntry | null = null;

  // Check for repeated read
  const existing = state.reads[filePath];
  if (existing) {
    repeatedRead = true;
    warnings.push(
      `[mink] ${filePath} was already read this session (~${existing.estimatedTokens} tokens)`
    );
    state.counters.repeatedReadWarnings++;
  }

  // File index lookup
  if (index) {
    entry = lookupEntry(index, filePath);
    if (entry) {
      indexHit = true;
      recordHit(index);
      warnings.push(
        `[mink] ${filePath} — ${entry.description} (~${entry.estimatedTokens} tokens)`
      );
    } else {
      recordMiss(index);
    }
  }

  return { warnings, indexHit, repeatedRead, entry };
}

function isPreToolUseInput(value: unknown): value is PreToolUseInput {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.tool_name !== "string") return false;
  if (typeof obj.tool_input !== "object" || obj.tool_input === null) return false;
  return true;
}

export async function preRead(cwd: string): Promise<void> {
  // 5-second safety timeout
  const timer = setTimeout(() => process.exit(0), 5000);

  try {
    const input = await readStdinJson();
    if (!isPreToolUseInput(input)) return;
    if (input.tool_name !== "Read") return;

    const absolutePath = input.tool_input.file_path;
    if (!absolutePath) return;

    const filePath = relative(cwd, absolutePath);

    // Load session state (create fresh if missing)
    const rawState = safeReadJson(sessionPath(cwd));
    const state: SessionState = isSessionState(rawState)
      ? rawState
      : createSessionState();

    // Load file index (null if missing/corrupt)
    const rawIndex = safeReadJson(fileIndexPath(cwd));
    const index: FileIndex | null = isFileIndex(rawIndex) ? rawIndex : null;

    const result = analyzePreRead(filePath, state, index);

    // Emit warnings to stderr
    for (const warning of result.warnings) {
      process.stderr.write(warning + "\n");
    }

    // Persist state changes
    atomicWriteJson(sessionPath(cwd), state);
    if (index) {
      atomicWriteJson(fileIndexPath(cwd), index);
    }
  } catch {
    // Never crash — exit silently
  } finally {
    clearTimeout(timer);
  }
}
