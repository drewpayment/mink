// Wrapper over the SQLite bug-memory storage layer. The function-based
// API below stays compatible with existing unit tests (which build
// in-memory BugMemory objects), while the repo-aware paths route through
// BugMemoryRepo so 20k+ bug histories stay searchable in milliseconds.
//
// FTS5 is the search backbone — see BugMemoryRepo.searchBugs for the
// query semantics, score normalization, and false-positive guards.

import type { BugEntry, BugMemory, SimilarityMatch } from "../types/bug-memory";

export function createEmptyBugMemory(): BugMemory {
  return { entries: [], nextId: 1 };
}

export function isBugMemory(value: unknown): value is BugMemory {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return Array.isArray(obj.entries) && typeof obj.nextId === "number";
}

export function generateBugId(nextId: number): string {
  return `bug-${String(nextId).padStart(3, "0")}`;
}

// ── In-memory operations (used by unit tests and the JSON migration importer) ──

export function findDuplicate(
  memory: BugMemory,
  errorMessage: string,
  filePath: string
): BugEntry | null {
  return (
    memory.entries.find(
      (e) => e.errorMessage === errorMessage && e.filePath === filePath
    ) ?? null
  );
}

export function addBugEntry(
  memory: BugMemory,
  fields: Omit<BugEntry, "id" | "createdAt" | "lastSeenAt" | "occurrenceCount">
): BugMemory {
  const existing = findDuplicate(memory, fields.errorMessage, fields.filePath);
  if (existing) return updateOccurrence(memory, existing.id);

  const now = new Date().toISOString();
  const entry: BugEntry = {
    id: generateBugId(memory.nextId),
    createdAt: now,
    lastSeenAt: now,
    occurrenceCount: 1,
    ...fields,
  };

  return {
    entries: [...memory.entries, entry],
    nextId: memory.nextId + 1,
  };
}

export function updateOccurrence(memory: BugMemory, id: string): BugMemory {
  const now = new Date().toISOString();
  return {
    ...memory,
    entries: memory.entries.map((e) =>
      e.id === id
        ? { ...e, occurrenceCount: e.occurrenceCount + 1, lastSeenAt: now }
        : e
    ),
  };
}

// ── Similarity scoring (in-memory) ────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter((w) => w.length > 0)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function computeSimilarity(
  query: string,
  entry: BugEntry
): SimilarityMatch {
  const matchReasons: string[] = [];
  let score = 0;

  if (entry.errorMessage.length > 0 && entry.errorMessage.includes(query)) {
    score += 1.0;
    matchReasons.push("exact_error_match");
  }

  const queryTokens = tokenize(query);
  const fields: [string, string][] = [
    ["error_message", entry.errorMessage],
    ["root_cause", entry.rootCause],
    ["fix", entry.fixDescription],
    ["tags", entry.tags.join(" ")],
  ];

  for (const [fieldName, fieldValue] of fields) {
    const fieldTokens = tokenize(fieldValue);
    const j = jaccard(queryTokens, fieldTokens);
    if (j > 0) {
      score += j * 0.5;
      matchReasons.push(fieldName);
    }
  }

  return { entry, score, matchReasons };
}

function hasFilePathMatch(entry: BugEntry, filePath?: string): boolean {
  if (!filePath) return false;
  return entry.filePath === filePath;
}

function hasTagOverlap(entry: BugEntry, query: string): boolean {
  const queryTokens = tokenize(query);
  return entry.tags.some((tag) => queryTokens.has(tag.toLowerCase()));
}

// Pure-memory search — kept for unit tests that don't open a DB. Production
// call sites use BugMemoryRepo.searchBugs which goes through FTS5.
export function searchBugs(
  memory: BugMemory,
  query: string,
  options?: { filePath?: string }
): SimilarityMatch[] {
  if (memory.entries.length === 0 || query.trim().length === 0) return [];

  const results: SimilarityMatch[] = [];

  for (const entry of memory.entries) {
    const match = computeSimilarity(query, entry);
    const fileMatch = hasFilePathMatch(entry, options?.filePath);
    const tagMatch = hasTagOverlap(entry, query);
    if (!fileMatch && !tagMatch && match.score <= 0.3) continue;
    if (fileMatch) {
      match.score += 0.2;
      if (!match.matchReasons.includes("file_path")) {
        match.matchReasons.push("file_path");
      }
    }
    if (match.score > 0.3) results.push(match);
  }

  return results.sort((a, b) => b.score - a.score);
}

export function lookupBugsForFile(
  memory: BugMemory,
  filePath: string
): BugEntry[] {
  return memory.entries
    .filter((e) => e.filePath === filePath)
    .sort(
      (a, b) =>
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
    );
}

export function formatBugSummary(entries: BugEntry[]): string | null {
  if (entries.length === 0) return null;

  const lines: string[] = ["[mink] Known bugs for this file:"];
  const shown = entries.slice(0, 3);

  for (const e of shown) {
    lines.push(`  ${e.id}: ${e.errorMessage}`);
    lines.push(`    Root cause: ${e.rootCause}`);
    lines.push(`    Fix: ${e.fixDescription}`);
    if (e.occurrenceCount > 1) {
      lines.push(`    Seen ${e.occurrenceCount} times (last: ${e.lastSeenAt})`);
    }
  }

  if (entries.length > 3) {
    lines.push(`  ... and ${entries.length - 3} more`);
  }

  return lines.join("\n");
}

export function hasBugForFileInSession(
  memory: BugMemory,
  filePath: string,
  sessionStartTimestamp: string
): boolean {
  const sessionStart = new Date(sessionStartTimestamp).getTime();
  return memory.entries.some(
    (e) =>
      e.filePath === filePath &&
      new Date(e.createdAt).getTime() >= sessionStart
  );
}

// ── JSON shim — kept so the migration importer + state-aggregator can still
// read legacy files during the rollout window. New writes go through the repo.

import { safeReadJson, atomicWriteJson } from "./fs-utils";

export function loadBugMemory(path: string): BugMemory {
  const raw = safeReadJson(path);
  if (raw !== null && isBugMemory(raw)) return raw;
  return createEmptyBugMemory();
}

export function saveBugMemory(path: string, memory: BugMemory): void {
  atomicWriteJson(path, memory);
}
