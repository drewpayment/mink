import { join } from "path";
import type { TokenLedger, LedgerSession, LifetimeCounters } from "../types/token-ledger";
import type { SessionFinalizer, SessionSummary } from "../types/session";
import { atomicWriteJson, safeReadJson } from "./fs-utils";

// ── Helpers ──────────────────────────────────────────────────────────────────

function addToLifetime(lifetime: LifetimeCounters, session: LedgerSession): void {
  lifetime.totalTokens += session.totals.estimatedTokens;
  lifetime.totalReads += session.totals.readCount;
  lifetime.totalWrites += session.totals.writeCount;
  lifetime.totalSessions += 1;
  lifetime.totalFileIndexHits += session.totals.fileIndexHits;
  lifetime.totalFileIndexMisses += session.totals.fileIndexMisses;
  lifetime.totalRepeatedReads += session.totals.repeatedReads;
  lifetime.totalEstimatedSavings += session.estimatedSavings;
}

function subtractFromLifetime(lifetime: LifetimeCounters, session: LedgerSession): void {
  lifetime.totalTokens -= session.totals.estimatedTokens;
  lifetime.totalReads -= session.totals.readCount;
  lifetime.totalWrites -= session.totals.writeCount;
  lifetime.totalSessions -= 1;
  lifetime.totalFileIndexHits -= session.totals.fileIndexHits;
  lifetime.totalFileIndexMisses -= session.totals.fileIndexMisses;
  lifetime.totalRepeatedReads -= session.totals.repeatedReads;
  lifetime.totalEstimatedSavings -= session.estimatedSavings;
}

// ── Core functions ────────────────────────────────────────────────────────────

export function createEmptyLedger(): TokenLedger {
  return {
    lifetime: {
      totalTokens: 0,
      totalReads: 0,
      totalWrites: 0,
      totalSessions: 0,
      totalFileIndexHits: 0,
      totalFileIndexMisses: 0,
      totalRepeatedReads: 0,
      totalEstimatedSavings: 0,
    },
    sessions: [],
  };
}

export function isTokenLedger(value: unknown): value is TokenLedger {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.lifetime === "object" &&
    obj.lifetime !== null &&
    Array.isArray(obj.sessions)
  );
}

export function loadLedger(ledgerPath: string): TokenLedger {
  const raw = safeReadJson(ledgerPath);
  if (raw === null) {
    return createEmptyLedger();
  }
  if (!isTokenLedger(raw)) {
    console.warn(`[mink] Warning: corrupt token ledger at ${ledgerPath}, starting fresh`);
    return createEmptyLedger();
  }
  return raw;
}

export function saveLedger(ledgerPath: string, ledger: TokenLedger): void {
  atomicWriteJson(ledgerPath, ledger);
}

// ── Task 3: Append Session ────────────────────────────────────────────────────

export function summaryToLedgerSession(summary: SessionSummary): LedgerSession {
  return {
    sessionId: summary.sessionId,
    startTimestamp: summary.startTimestamp,
    endTimestamp: summary.endTimestamp,
    reads: summary.reads.map((r) => ({
      filePath: r.filePath,
      estimatedTokens: r.estimatedTokens,
      readCount: r.readCount,
    })),
    writes: summary.writes.map((w) => ({
      filePath: w.filePath,
      estimatedTokens: w.estimatedTokens,
      action: w.action,
    })),
    totals: {
      readCount: summary.totals.readCount,
      writeCount: summary.totals.writeCount,
      estimatedTokens: summary.totals.estimatedTokens,
      repeatedReads: summary.totals.repeatedReads,
      fileIndexHits: summary.totals.fileIndexHits,
      fileIndexMisses: summary.totals.fileIndexMisses,
    },
    estimatedSavings: summary.estimatedSavings,
  };
}

export function appendSession(ledger: TokenLedger, summary: SessionSummary): void {
  const session = summaryToLedgerSession(summary);
  ledger.sessions.push(session);
  addToLifetime(ledger.lifetime, session);
}

// ── Task 4: Update Session ────────────────────────────────────────────────────

export function updateSession(ledger: TokenLedger, summary: SessionSummary): void {
  const idx = ledger.sessions.findIndex((s) => s.sessionId === summary.sessionId);
  if (idx === -1) {
    appendSession(ledger, summary);
    return;
  }
  const oldSession = ledger.sessions[idx];
  subtractFromLifetime(ledger.lifetime, oldSession);
  const newSession = summaryToLedgerSession(summary);
  addToLifetime(ledger.lifetime, newSession);
  ledger.sessions[idx] = newSession;
}

// ── Task 5: Archive ───────────────────────────────────────────────────────────

export function archiveIfNeeded(
  ledger: TokenLedger,
  threshold: number = 1000
): { archived: LedgerSession[] } {
  if (threshold <= 0) {
    return { archived: [] };
  }
  if (ledger.sessions.length <= threshold) {
    return { archived: [] };
  }
  const excess = ledger.sessions.length - threshold;
  const archived = ledger.sessions.splice(0, excess);
  return { archived };
}

export function loadArchive(archivePath: string): LedgerSession[] {
  const raw = safeReadJson(archivePath);
  if (raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    console.warn(`[mink] Warning: corrupt token ledger archive at ${archivePath}, ignoring`);
    return [];
  }
  return raw as LedgerSession[];
}

export function saveArchive(archivePath: string, newlyArchived: LedgerSession[]): void {
  const existing = loadArchive(archivePath);
  const combined = [...newlyArchived, ...existing];
  atomicWriteJson(archivePath, combined);
}

// ── Task 6: Ledger Finalizer Factory ─────────────────────────────────────────

export function createLedgerFinalizer(
  projectDir: string,
  deviceIdOrThreshold?: string | number,
  archiveThreshold: number = 1000
): SessionFinalizer {
  // Backward compat: callers that pass `(projectDir)` or
  // `(projectDir, threshold)` still work and write to the legacy path. New
  // callers pass `(projectDir, deviceId, threshold?)` to write into the
  // per-device shard at projectDir/state/<deviceId>/...
  let ledgerPath: string;
  let archivePath: string;
  let threshold: number;
  if (typeof deviceIdOrThreshold === "string") {
    const shardDir = join(projectDir, "state", deviceIdOrThreshold);
    ledgerPath = join(shardDir, "token-ledger.json");
    archivePath = join(shardDir, "token-ledger-archive.json");
    threshold = archiveThreshold;
  } else {
    ledgerPath = join(projectDir, "token-ledger.json");
    archivePath = join(projectDir, "token-ledger-archive.json");
    threshold = deviceIdOrThreshold ?? archiveThreshold;
  }

  return {
    appendSession(summary: SessionSummary): void {
      const ledger = loadLedger(ledgerPath);
      appendSession(ledger, summary);
      const { archived } = archiveIfNeeded(ledger, threshold);
      if (archived.length > 0) {
        saveArchive(archivePath, archived);
      }
      saveLedger(ledgerPath, ledger);
    },

    updateSession(summary: SessionSummary): void {
      const ledger = loadLedger(ledgerPath);
      updateSession(ledger, summary);
      saveLedger(ledgerPath, ledger);
    },
  };
}
