import { statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { isSessionState, buildSummary } from "../core/session";
import { reflect } from "./reflect";
import { createLedgerFinalizer } from "../core/token-ledger";
import { loadBugMemory, hasBugForFileInSession } from "../core/bug-memory";
import { createActionLogWriter, consolidateLog } from "../core/action-log";
import type { SessionState, SessionFinalizer } from "../types/session";
import type { ProjectConfig } from "../types/file-index";

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
  finalizer?: SessionFinalizer,
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

  const projDir = dirname(sessionFile);
  const effectiveFinalizer = finalizer ?? createLedgerFinalizer(projDir);

  if (hasActivity(state)) {
    const summary = buildSummary(state);

    if (state.stopCount === 1) {
      effectiveFinalizer.appendSession(summary);
    } else {
      effectiveFinalizer.updateSession(summary);
    }

    // Append session end to action log and run consolidation
    try {
      const logPath = join(projDir, "action-log.md");
      const logWriter = createActionLogWriter(logPath);
      logWriter.appendSessionEnd(summary);

      const cfgRaw = safeReadJson(join(projDir, "config.json")) as ProjectConfig | null;
      consolidateLog(logPath, {
        maxEntries: cfgRaw?.actionLogMaxEntries ?? 200,
        retentionDays: cfgRaw?.actionLogRetentionDays ?? 7,
      });
    } catch {
      // Never crash
    }
  }

  // Check for files edited 3+ times without a corresponding bug entry
  const editCounts = getEditCounts(state);
  const bugMemoryFile = join(projDir, "bug-memory.json");
  const bugMemory = loadBugMemory(bugMemoryFile);

  for (const [filePath, count] of Object.entries(editCounts)) {
    if (count >= 3) {
      const hasBug = hasBugForFileInSession(
        bugMemory,
        filePath,
        state.startTimestamp
      );
      if (!hasBug) {
        onReminder(
          `[mink] ${filePath} was edited ${count} times — consider logging a bug`
        );
      }
    }
  }

  // Run reflection to merge duplicates and prune oversized memory
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
