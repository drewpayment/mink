import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { projectDir } from "./paths";
import {
  loadLedger,
  loadArchive,
  createEmptyLedger,
} from "./token-ledger";
import { loadBugMemory, createEmptyBugMemory } from "./bug-memory";
import {
  parseLearningMemory,
  createEmptyLearningMemory,
} from "./learning-memory";
import { parseLogSessions, safeReadLog } from "./action-log";
import type {
  TokenLedger,
  LedgerSession,
  LifetimeCounters,
} from "../types/token-ledger";
import type { BugMemory, BugEntry } from "../types/bug-memory";
import type {
  LearningMemory,
  SectionName,
} from "../types/learning-memory";

// ── Shard discovery ────────────────────────────────────────────────────────
// All aggregators take a project state directory (the path returned by
// projectDir(cwd)). The cwd-based variants below are thin wrappers for the
// common case where the caller has cwd in hand.

function listDeviceShardsAt(projDir: string): string[] {
  const stateDir = join(projDir, "state");
  if (!existsSync(stateDir)) return [];
  try {
    return readdirSync(stateDir).filter((name) => {
      try {
        return statSync(join(stateDir, name)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

const SIDECAR_RE = /^learning-memory\.([^.]+)\.md$/;

function listLearningMemorySidecarPathsAt(projDir: string): string[] {
  if (!existsSync(projDir)) return [];
  try {
    return readdirSync(projDir)
      .filter((f) => SIDECAR_RE.test(f))
      .map((f) => join(projDir, f));
  } catch {
    return [];
  }
}

function shardPath(projDir: string, deviceId: string, file: string): string {
  return join(projDir, "state", deviceId, file);
}

// ── Token ledger ───────────────────────────────────────────────────────────

function addLifetime(target: LifetimeCounters, source: LifetimeCounters): void {
  target.totalTokens += source.totalTokens;
  target.totalReads += source.totalReads;
  target.totalWrites += source.totalWrites;
  target.totalSessions += source.totalSessions;
  target.totalFileIndexHits += source.totalFileIndexHits;
  target.totalFileIndexMisses += source.totalFileIndexMisses;
  target.totalRepeatedReads += source.totalRepeatedReads;
  target.totalEstimatedSavings += source.totalEstimatedSavings;
}

export function aggregateTokenLedgerAt(projDir: string): TokenLedger {
  const merged = createEmptyLedger();
  const seenSessions = new Set<string>();

  // Sum lifetime counters from every source (each shard + legacy). Lifetime
  // persists across archive cycles, so deriving from active sessions alone
  // would lose archived totals. Migration atomically moves legacy → shard
  // (`git mv`), so a session never lives in both simultaneously and lifetime
  // counters do not double-count in production.
  const sources = [
    ...listDeviceShardsAt(projDir).map((id) =>
      shardPath(projDir, id, "token-ledger.json")
    ),
    join(projDir, "token-ledger.json"),
  ];

  // Track waste-flags across sources, deduped by (pattern, detectedAt) so
  // each device's flags remain visible without spamming duplicates.
  const seenFlagKeys = new Set<string>();
  const wasteFlags: NonNullable<TokenLedger["wasteFlags"]> = [];

  for (const path of sources) {
    if (!existsSync(path)) continue;
    const ledger = loadLedger(path);
    addLifetime(merged.lifetime, ledger.lifetime);
    for (const session of ledger.sessions) {
      if (seenSessions.has(session.sessionId)) continue;
      seenSessions.add(session.sessionId);
      merged.sessions.push(session);
    }
    if (ledger.wasteFlags) {
      for (const flag of ledger.wasteFlags) {
        const key = `${flag.pattern}|${flag.detectedAt}`;
        if (seenFlagKeys.has(key)) continue;
        seenFlagKeys.add(key);
        wasteFlags.push(flag);
      }
    }
  }

  if (wasteFlags.length > 0) {
    merged.wasteFlags = wasteFlags;
  }

  merged.sessions.sort((a, b) =>
    a.startTimestamp.localeCompare(b.startTimestamp)
  );
  return merged;
}

export function aggregateTokenLedger(cwd: string): TokenLedger {
  return aggregateTokenLedgerAt(projectDir(cwd));
}

export function aggregateTokenLedgerArchiveAt(
  projDir: string
): LedgerSession[] {
  const seen = new Set<string>();
  const archived: LedgerSession[] = [];

  const sources = [
    ...listDeviceShardsAt(projDir).map((id) =>
      shardPath(projDir, id, "token-ledger-archive.json")
    ),
    join(projDir, "token-ledger-archive.json"),
  ];

  for (const path of sources) {
    if (!existsSync(path)) continue;
    for (const session of loadArchive(path)) {
      if (seen.has(session.sessionId)) continue;
      seen.add(session.sessionId);
      archived.push(session);
    }
  }

  archived.sort((a, b) => a.startTimestamp.localeCompare(b.startTimestamp));
  return archived;
}

export function aggregateTokenLedgerArchive(cwd: string): LedgerSession[] {
  return aggregateTokenLedgerArchiveAt(projectDir(cwd));
}

// ── Bug memory ─────────────────────────────────────────────────────────────

export function aggregateBugMemoryAt(projDir: string): BugMemory {
  const byId = new Map<string, BugEntry>();
  let maxNextId = 1;

  const sources = [
    ...listDeviceShardsAt(projDir).map((id) =>
      shardPath(projDir, id, "bug-memory.json")
    ),
    join(projDir, "bug-memory.json"),
  ];

  for (const path of sources) {
    if (!existsSync(path)) continue;
    const mem = loadBugMemory(path);
    if (mem.nextId > maxNextId) maxNextId = mem.nextId;
    for (const entry of mem.entries) {
      const existing = byId.get(entry.id);
      if (!existing) {
        byId.set(entry.id, { ...entry });
        continue;
      }
      existing.occurrenceCount = Math.max(
        existing.occurrenceCount,
        entry.occurrenceCount
      );
      if (entry.lastSeenAt > existing.lastSeenAt) {
        existing.lastSeenAt = entry.lastSeenAt;
      }
      if (entry.createdAt < existing.createdAt) {
        existing.createdAt = entry.createdAt;
      }
      const tags = new Set([...existing.tags, ...entry.tags]);
      existing.tags = [...tags];
      const related = new Set([
        ...existing.relatedBugIds,
        ...entry.relatedBugIds,
      ]);
      existing.relatedBugIds = [...related];
    }
  }

  return {
    entries: [...byId.values()].sort((a, b) =>
      a.lastSeenAt < b.lastSeenAt ? 1 : -1
    ),
    nextId: maxNextId,
  };
}

export function aggregateBugMemory(cwd: string): BugMemory {
  return aggregateBugMemoryAt(projectDir(cwd));
}

// ── Action log ─────────────────────────────────────────────────────────────

export function aggregateActionLogAt(projDir: string): string {
  type Block = { date: string; content: string; offset: number };
  const blocks: Block[] = [];
  let order = 0;

  const sources = [
    ...listDeviceShardsAt(projDir).map((id) =>
      shardPath(projDir, id, "action-log.md")
    ),
    join(projDir, "action-log.md"),
  ];

  for (const path of sources) {
    if (!existsSync(path)) continue;
    const content = safeReadLog(path);
    if (!content) continue;
    const sessions = parseLogSessions(content);
    for (const session of sessions) {
      blocks.push({
        date: session.date,
        content: session.content,
        offset: order++,
      });
    }
  }

  blocks.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.offset - b.offset;
  });

  return blocks.map((b) => b.content).join("");
}

export function aggregateActionLog(cwd: string): string {
  return aggregateActionLogAt(projectDir(cwd));
}

// ── Learning memory ────────────────────────────────────────────────────────

export function aggregateLearningMemoryAt(projDir: string): LearningMemory {
  const canonicalPath = join(projDir, "learning-memory.md");
  let merged: LearningMemory;
  if (existsSync(canonicalPath)) {
    try {
      merged = parseLearningMemory(readFileSync(canonicalPath, "utf-8"));
    } catch {
      merged = createEmptyLearningMemory("unknown");
    }
  } else {
    merged = createEmptyLearningMemory("unknown");
  }

  for (const sidecarPath of listLearningMemorySidecarPathsAt(projDir)) {
    let sidecar: LearningMemory;
    try {
      sidecar = parseLearningMemory(readFileSync(sidecarPath, "utf-8"));
    } catch {
      continue;
    }

    if (
      merged.projectName === "unknown" &&
      sidecar.projectName !== "unknown"
    ) {
      merged.projectName = sidecar.projectName;
    }

    for (const section of Object.keys(sidecar.sections) as SectionName[]) {
      const existing = new Set(
        merged.sections[section].map((e) => e.trim().toLowerCase())
      );
      for (const entry of sidecar.sections[section]) {
        const norm = entry.trim().toLowerCase();
        if (existing.has(norm)) continue;
        existing.add(norm);
        merged.sections[section].push(entry);
      }
    }
  }

  return merged;
}

export function aggregateLearningMemory(cwd: string): LearningMemory {
  return aggregateLearningMemoryAt(projectDir(cwd));
}
