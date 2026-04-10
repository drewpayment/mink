import { randomBytes } from "crypto";
import type {
  SessionState,
  SessionSummary,
} from "../types/session";

export function createSessionState(): SessionState {
  const now = new Date().toISOString();
  const suffix = randomBytes(2).toString("hex");
  return {
    sessionId: `${now}-${suffix}`,
    startTimestamp: now,
    stopCount: 0,
    reads: {},
    writes: [],
    counters: {
      fileIndexHits: 0,
      fileIndexMisses: 0,
      repeatedReadWarnings: 0,
      learnedRuleWarnings: 0,
    },
  };
}

export function recordRead(
  state: SessionState,
  filePath: string,
  estimatedTokens: number,
  indexHit: boolean
): void {
  const existing = state.reads[filePath];
  if (existing) {
    existing.readCount++;
  } else {
    state.reads[filePath] = {
      readCount: 1,
      estimatedTokens,
      firstReadAt: new Date().toISOString(),
    };
  }

  if (indexHit) {
    state.counters.fileIndexHits++;
  } else {
    state.counters.fileIndexMisses++;
  }
}

export function recordWrite(
  state: SessionState,
  filePath: string,
  action: "create" | "edit",
  estimatedTokens: number
): void {
  state.writes.push({
    filePath,
    action,
    estimatedTokens,
    timestamp: new Date().toISOString(),
  });
}

export function calculateSavings(state: SessionState): number {
  const indexSavings = state.counters.fileIndexHits * 200;

  let repeatedReadSavings = 0;
  for (const read of Object.values(state.reads)) {
    if (read.readCount > 1) {
      repeatedReadSavings += (read.readCount - 1) * read.estimatedTokens;
    }
  }

  return indexSavings + repeatedReadSavings;
}

export function buildSummary(state: SessionState): SessionSummary {
  const reads = Object.entries(state.reads).map(([filePath, read]) => ({
    filePath,
    ...read,
  }));

  let totalTokens = 0;
  for (const read of Object.values(state.reads)) {
    totalTokens += read.estimatedTokens;
  }
  for (const write of state.writes) {
    totalTokens += write.estimatedTokens;
  }

  let repeatedReads = 0;
  for (const read of Object.values(state.reads)) {
    if (read.readCount > 1) {
      repeatedReads += read.readCount - 1;
    }
  }

  return {
    sessionId: state.sessionId,
    startTimestamp: state.startTimestamp,
    endTimestamp: new Date().toISOString(),
    reads,
    writes: state.writes,
    totals: {
      readCount: Object.keys(state.reads).length,
      writeCount: state.writes.length,
      estimatedTokens: totalTokens,
      repeatedReads,
      fileIndexHits: state.counters.fileIndexHits,
      fileIndexMisses: state.counters.fileIndexMisses,
    },
    estimatedSavings: calculateSavings(state),
  };
}

export function isSessionState(value: unknown): value is SessionState {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.sessionId === "string" &&
    typeof obj.startTimestamp === "string" &&
    typeof obj.stopCount === "number" &&
    typeof obj.reads === "object" &&
    obj.reads !== null &&
    Array.isArray(obj.writes) &&
    typeof obj.counters === "object" &&
    obj.counters !== null
  );
}
