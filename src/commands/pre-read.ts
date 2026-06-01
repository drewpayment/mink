import { relative } from "path";
import { readStdinJson } from "../core/stdin";
import { sessionPath } from "../core/paths";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { createSessionState, isSessionState } from "../core/session";
import { FileIndexRepo } from "../repositories/file-index-repo";
import { CountersRepo } from "../repositories/counters-repo";
import type { SessionState } from "../types/session";
import type { FileIndexEntry, IndexLookup } from "../types/file-index";
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
  index: IndexLookup | null
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

  // File index lookup. Hit/miss telemetry is persisted by the caller into
  // the counters table, not by mutating the index — keeps the file_index
  // row's last_modified stable so the sync merge driver doesn't churn it
  // on every read.
  if (index) {
    entry = index.lookupEntry(filePath);
    if (entry) {
      indexHit = true;
      warnings.push(
        `[mink] ${filePath} — ${entry.description} (~${entry.estimatedTokens} tokens)`
      );
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

    // File index repository — one-key lookup per hook.
    const repo = FileIndexRepo.for(cwd);

    const result = analyzePreRead(filePath, state, repo);

    // Emit warnings to stderr
    for (const warning of result.warnings) {
      process.stderr.write(warning + "\n");
    }

    // Persist state changes
    atomicWriteJson(sessionPath(cwd), state);
    try {
      const counters = CountersRepo.for(cwd);
      if (result.indexHit) counters.incrementHit();
      else counters.incrementMiss();
    } catch {
      // Counter table is best-effort telemetry — never block the read hook
    }
  } catch {
    // Never crash — exit silently
  } finally {
    clearTimeout(timer);
  }
}
