import { statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { isSessionState, buildSummary } from "../core/session";
import { reflect } from "./reflect";
import type { SessionState, SessionFinalizer } from "../types/session";

const noopFinalizer: SessionFinalizer = {
  appendSession() {},
  updateSession() {},
};

function hasActivity(state: SessionState): boolean {
  return Object.keys(state.reads).length > 0 || state.writes.length > 0;
}

function getEditCounts(state: SessionState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const write of state.writes) {
    counts[write.filePath] = (counts[write.filePath] || 0) + 1;
  }
  return counts;
}

function isLearningMemoryStale(memoryPath: string): boolean {
  try {
    const stat = statSync(memoryPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return ageMs > twentyFourHours;
  } catch {
    // File doesn't exist yet — not stale, just absent
    return false;
  }
}

export function sessionStop(
  sessionFile: string,
  finalizer: SessionFinalizer = noopFinalizer,
  onReminder: (msg: string) => void = (msg) => console.error(msg)
): void {
  const raw = safeReadJson(sessionFile);
  if (!isSessionState(raw)) {
    if (raw !== null) {
      console.error("[mink] session.json is corrupt — skipping finalization");
    }
    return;
  }

  const state: SessionState = raw;
  state.stopCount++;

  if (hasActivity(state)) {
    const summary = buildSummary(state);

    if (state.stopCount === 1) {
      finalizer.appendSession(summary);
    } else {
      finalizer.updateSession(summary);
    }
  }

  // Check for files edited 3+ times
  const editCounts = getEditCounts(state);
  for (const [filePath, count] of Object.entries(editCounts)) {
    if (count >= 3) {
      onReminder(
        `[mink] ${filePath} was edited ${count} times — consider logging a bug`
      );
    }
  }

  // Run reflection to merge duplicates and prune oversized memory
  const projDir = dirname(sessionFile);
  const memoryPath = join(projDir, "learning-memory.md");
  const cfgPath = join(projDir, "config.json");
  if (existsSync(memoryPath)) {
    reflect(projDir, memoryPath, cfgPath);
  }

  // Check if learning memory is stale (>24h since last update)
  if (isLearningMemoryStale(memoryPath)) {
    onReminder(
      "[mink] learning memory hasn't been updated in 24+ hours — consider reviewing it"
    );
  }

  atomicWriteJson(sessionFile, state);
}
