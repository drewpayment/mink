// Bug-memory repository. Wraps the bug_memory + bug_tags + bug_related +
// bug_memory_fts tables in mink.db. The CLI surface (loadBugMemory,
// findDuplicate, lookupBugsForFile, searchBugs, hasBugForFileInSession)
// is preserved by the thin wrapper in src/core/bug-memory.ts; this file
// is where the SQLite queries live.
//
// Search uses FTS5 (porter+unicode61 tokenization) so the per-query cost
// stays sublinear in bug count. The score-vs-false-positive guards from
// the v1 Jaccard implementation are preserved: a 0.3 score threshold,
// file-path or tag-overlap match required when score is borderline,
// same-file matches get a 0.2 boost.

import { randomUUID } from "crypto";
import type { DbDriver } from "../storage/driver";
import type { BugEntry, BugMemory, SimilarityMatch } from "../types/bug-memory";
import { openProjectDb } from "../storage/db";
import { getOrCreateDeviceId } from "../core/device";

interface BugRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  error_message: string;
  file_path: string;
  line_number: number | null;
  root_cause: string;
  fix_description: string;
  occurrence_count: number;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter((w) => w.length > 0)
  );
}

export class BugMemoryRepo {
  constructor(private readonly db: DbDriver) {}

  static for(cwd: string): BugMemoryRepo {
    return new BugMemoryRepo(openProjectDb(cwd));
  }

  // ── Insert / upsert ────────────────────────────────────────────────────

  // Detect an exact-text duplicate of (errorMessage, filePath). Mirrors
  // the v1 `findDuplicate` semantics — same (errorMessage, filePath)
  // pair counts as a re-occurrence of the same bug.
  findDuplicate(errorMessage: string, filePath: string): BugEntry | null {
    const row = this.db
      .prepare(
        "SELECT * FROM bug_memory WHERE error_message = ? AND file_path = ? LIMIT 1"
      )
      .get(errorMessage, filePath);
    if (!row) return null;
    return this.hydrate(row as unknown as BugRow);
  }

  add(
    fields: Omit<BugEntry, "id" | "createdAt" | "lastSeenAt" | "occurrenceCount">
  ): BugEntry {
    const existing = this.findDuplicate(fields.errorMessage, fields.filePath);
    if (existing) {
      this.incrementOccurrence(existing.id);
      return this.lookup(existing.id) ?? existing;
    }

    const id = `bug-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const deviceId = getOrCreateDeviceId();

    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO bug_memory
          (id, created_at, last_seen_at, error_message, file_path, line_number,
           root_cause, fix_description, occurrence_count, device_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        id, now, now,
        fields.errorMessage, fields.filePath, fields.lineNumber ?? null,
        fields.rootCause, fields.fixDescription, deviceId
      );
      const insertTag = this.db.prepare(
        "INSERT OR IGNORE INTO bug_tags (bug_id, tag) VALUES (?, ?)"
      );
      for (const tag of fields.tags ?? []) insertTag.run(id, tag);
      const insertRelated = this.db.prepare(
        "INSERT OR IGNORE INTO bug_related (bug_id, related_bug_id) VALUES (?, ?)"
      );
      for (const rel of fields.relatedBugIds ?? []) insertRelated.run(id, rel);
    });

    return this.lookup(id)!;
  }

  incrementOccurrence(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(
      "UPDATE bug_memory SET occurrence_count = occurrence_count + 1, last_seen_at = ? WHERE id = ?"
    ).run(now, id);
  }

  // ── Read ───────────────────────────────────────────────────────────────

  lookup(id: string): BugEntry | null {
    const row = this.db
      .prepare("SELECT * FROM bug_memory WHERE id = ?")
      .get(id);
    if (!row) return null;
    return this.hydrate(row as unknown as BugRow);
  }

  lookupForFile(filePath: string): BugEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM bug_memory WHERE file_path = ? ORDER BY last_seen_at DESC"
      )
      .all(filePath);
    return (rows as unknown as BugRow[]).map((r) => this.hydrate(r));
  }

  listAll(): BugEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM bug_memory ORDER BY last_seen_at DESC")
      .all();
    return (rows as unknown as BugRow[]).map((r) => this.hydrate(r));
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM bug_memory").get();
    return Number((row as { n: number }).n);
  }

  hasBugForFileInSession(filePath: string, sessionStartIso: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM bug_memory WHERE file_path = ? AND created_at >= ? LIMIT 1"
      )
      .get(filePath, sessionStartIso);
    return row !== undefined;
  }

  // ── Search (FTS5) ──────────────────────────────────────────────────────

  // Preserves the v1 contract: scores in (0, 1+) range, 0.3 threshold,
  // file-path/tag boost. FTS5's bm25 returns negative scores (lower =
  // better), so we normalize via `1 / (1 + abs(bm25))` to land in (0, 1].
  // The boost for same-file matches stays at +0.2 and the same false-
  // positive guards (require file-path or tag overlap when borderline)
  // apply.
  searchBugs(
    query: string,
    options?: { filePath?: string }
  ): SimilarityMatch[] {
    if (query.trim().length === 0) return [];

    // FTS5 MATCH requires escaped phrase quoting for queries with
    // punctuation. Build a phrase query if the input has anything
    // weirder than alphanum + spaces.
    const ftsQuery = buildFtsQuery(query);
    if (ftsQuery === null) return [];

    type FtsRow = { bug_id: string; bm25: number };
    let ftsRows: FtsRow[] = [];
    try {
      ftsRows = this.db
        .prepare(
          "SELECT bug_id, bm25(bug_memory_fts) AS bm25 FROM bug_memory_fts WHERE bug_memory_fts MATCH ? ORDER BY bm25"
        )
        .all(ftsQuery) as unknown as FtsRow[];
    } catch {
      // FTS query parse error — fall back silently to no matches.
      return [];
    }

    const queryTokens = tokenize(query);
    const results: SimilarityMatch[] = [];

    for (const row of ftsRows) {
      const entry = this.lookup(row.bug_id);
      if (!entry) continue;

      // bm25 is negative; smaller magnitude == better match.
      const ftsScore = 1 / (1 + Math.abs(row.bm25));
      const matchReasons: string[] = ["fts"];

      // Exact substring boost (matches v1 behavior).
      let score = ftsScore;
      if (entry.errorMessage.length > 0 && entry.errorMessage.includes(query)) {
        score += 1.0;
        matchReasons.unshift("exact_error_match");
      }

      const fileMatch = options?.filePath ? entry.filePath === options.filePath : false;
      const tagMatch = entry.tags.some((tag) => queryTokens.has(tag.toLowerCase()));

      // Same false-positive guard as v1: when the score is borderline
      // (<= 0.3), only keep matches that also satisfy file-path or
      // tag-overlap.
      if (score <= 0.3 && !fileMatch && !tagMatch) continue;

      if (fileMatch) {
        score += 0.2;
        matchReasons.push("file_path");
      }
      if (tagMatch) matchReasons.push("tags");

      if (score > 0.3) {
        results.push({ entry, score, matchReasons });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private hydrate(row: BugRow): BugEntry {
    const tags = this.db
      .prepare("SELECT tag FROM bug_tags WHERE bug_id = ? ORDER BY tag")
      .all(row.id)
      .map((r) => (r as { tag: string }).tag);
    const relatedBugIds = this.db
      .prepare(
        "SELECT related_bug_id FROM bug_related WHERE bug_id = ? ORDER BY related_bug_id"
      )
      .all(row.id)
      .map((r) => (r as { related_bug_id: string }).related_bug_id);
    return {
      id: row.id,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      errorMessage: row.error_message,
      filePath: row.file_path,
      lineNumber: row.line_number ?? undefined,
      rootCause: row.root_cause,
      fixDescription: row.fix_description,
      tags,
      occurrenceCount: row.occurrence_count,
      relatedBugIds,
    };
  }

  // Convert the entire repo to the legacy BugMemory snapshot shape. Used
  // by callers (dashboard, status) that still expect `{ entries, nextId }`.
  snapshot(): BugMemory {
    return {
      entries: this.listAll(),
      // nextId was only used by the in-memory generator; new ids come
      // from randomUUID, so any value > current count is safe.
      nextId: this.count() + 1,
    };
  }
}

// Build an FTS5 query string from arbitrary user input. FTS5's grammar
// treats colons, parens, quotes, etc. as operators — we phrase-quote the
// whole query to avoid syntax errors. Returns null for inputs that have
// no searchable tokens.
function buildFtsQuery(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Drop characters that can't appear inside FTS5 phrase quotes.
  const safe = trimmed.replace(/"/g, " ").trim();
  if (safe.length === 0) return null;
  // Quote so punctuation/colons/parens don't become operators.
  return `"${safe}"`;
}
