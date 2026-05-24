// One-shot JSON → SQLite importer. Runs the first time `openProjectDb(cwd)`
// is called on a project that already has on-disk JSON state. Idempotent:
// once `meta.migrated_from_json_at` is set, every subsequent call returns
// without touching the DB or filesystem.
//
// The importer runs inside a single transaction. Sources are:
//   - Every `state/{deviceId}/` shard (token-ledger.json, bug-memory.json,
//     token-ledger-archive.json) — device_id taken from the directory name.
//   - The legacy root JSONs at `{projectDir}/file-index.json`,
//     `bug-memory.json`, `token-ledger.json`, `token-ledger-archive.json`
//     — these are pre-sync-v2 state, attributed to device_id="legacy".
//   - `.mink-state-counters.json` for per-device hit/miss counters.
//
// Conflict resolution per store matches the existing aggregator semantics in
// `src/core/state-aggregator.ts`:
//   file_index   — keep row with newer `last_modified` (lex sort on ISO).
//   bug_memory   — max(occurrence_count), latest last_seen_at, oldest
//                  created_at, union of tags + related ids.
//   ledger_sessions — keyed by session_id; first writer wins (shards never
//                  overlap session ids in production).
//   ledger_lifetime — summed per device_id.

import { existsSync, readdirSync, readFileSync, renameSync, statSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { projectDir, fileIndexCountersPath } from "../core/paths";
import type { DbDriver } from "./driver";
import { readMeta, writeMeta } from "./schema";

const LEGACY_DEVICE_ID = "legacy";

interface JsonFileIndexEntry {
  filePath: string;
  description: string;
  estimatedTokens: number;
  lastModified: string;
  lastIndexed: string;
}

interface JsonFileIndex {
  header: { lastScanTimestamp?: string; totalFiles?: number };
  entries: Record<string, JsonFileIndexEntry>;
}

interface JsonBugEntry {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  errorMessage: string;
  filePath: string;
  lineNumber?: number;
  rootCause: string;
  fixDescription: string;
  tags: string[];
  occurrenceCount: number;
  relatedBugIds: string[];
}

interface JsonBugMemory {
  entries: JsonBugEntry[];
  nextId: number;
}

interface JsonLedgerTotals {
  readCount: number;
  writeCount: number;
  estimatedTokens: number;
  repeatedReads: number;
  fileIndexHits: number;
  fileIndexMisses: number;
}

interface JsonLedgerSession {
  sessionId: string;
  startTimestamp: string;
  endTimestamp: string;
  reads: Array<{ filePath: string; estimatedTokens: number; readCount: number }>;
  writes: Array<{ filePath: string; estimatedTokens: number; action: string }>;
  totals: JsonLedgerTotals;
  estimatedSavings: number;
}

interface JsonTokenLedger {
  lifetime: {
    totalTokens: number;
    totalReads: number;
    totalWrites: number;
    totalSessions: number;
    totalFileIndexHits: number;
    totalFileIndexMisses: number;
    totalRepeatedReads: number;
    totalEstimatedSavings: number;
  };
  sessions: JsonLedgerSession[];
}

function safeReadJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function listDeviceShards(projDir: string): string[] {
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

function moveSourceToBackup(srcPath: string, backupRoot: string, deviceId: string): void {
  if (!existsSync(srcPath)) return;
  const filename = srcPath.substring(srcPath.lastIndexOf("/") + 1);
  const destDir = join(backupRoot, deviceId);
  mkdirSync(destDir, { recursive: true });
  const dest = join(destDir, filename);
  try {
    renameSync(srcPath, dest);
  } catch {
    // If rename fails (e.g. cross-device), give up — the importer is
    // already done; leaving the JSON in place is harmless because the
    // meta marker prevents re-import.
  }
}

function importFileIndex(
  db: DbDriver,
  index: JsonFileIndex,
  deviceId: string,
  now: string
): void {
  const stmt = db.prepare(`
    INSERT INTO file_index
      (file_path, description, estimated_tokens, last_modified, last_indexed, mtime_ms, content_hash, size_bytes, device_id)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      description       = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.description       ELSE file_index.description       END,
      estimated_tokens  = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.estimated_tokens  ELSE file_index.estimated_tokens  END,
      last_indexed      = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.last_indexed      ELSE file_index.last_indexed      END,
      last_modified     = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.last_modified     ELSE file_index.last_modified     END,
      device_id         = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.device_id         ELSE file_index.device_id         END
  `);
  for (const [filePath, e] of Object.entries(index.entries ?? {})) {
    // mtime_ms is 0 in the import — Phase 5's incremental scanner refills
    // it the first time `mink scan` runs. The 0 sentinel forces re-extract
    // on first scan, which is the safe default.
    stmt.run(
      filePath,
      String(e.description ?? ""),
      Number(e.estimatedTokens ?? 0),
      String(e.lastModified ?? now),
      String(e.lastIndexed ?? now),
      0,
      deviceId
    );
  }
}

function importBugMemory(db: DbDriver, mem: JsonBugMemory, deviceId: string): void {
  // Bug insert merge: keep oldest createdAt, latest lastSeenAt,
  // max(occurrence_count). Tags + related are accumulated via separate
  // tables so duplicates are skipped by the PRIMARY KEY constraint.
  const upsertBug = db.prepare(`
    INSERT INTO bug_memory
      (id, created_at, last_seen_at, error_message, file_path, line_number, root_cause, fix_description, occurrence_count, device_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      created_at       = CASE WHEN excluded.created_at < bug_memory.created_at THEN excluded.created_at ELSE bug_memory.created_at END,
      last_seen_at     = CASE WHEN excluded.last_seen_at > bug_memory.last_seen_at THEN excluded.last_seen_at ELSE bug_memory.last_seen_at END,
      occurrence_count = MAX(bug_memory.occurrence_count, excluded.occurrence_count),
      error_message    = bug_memory.error_message,
      file_path        = bug_memory.file_path,
      root_cause       = bug_memory.root_cause,
      fix_description  = bug_memory.fix_description
  `);
  const insertTag = db.prepare(
    "INSERT OR IGNORE INTO bug_tags (bug_id, tag) VALUES (?, ?)"
  );
  const insertRelated = db.prepare(
    "INSERT OR IGNORE INTO bug_related (bug_id, related_bug_id) VALUES (?, ?)"
  );

  const now = new Date().toISOString();
  for (const e of mem.entries ?? []) {
    // Skip entries without a stable id — there's nothing to merge against
    // and tag/related rows would have no parent.
    if (!e || typeof e.id !== "string" || e.id.length === 0) continue;
    upsertBug.run(
      e.id,
      e.createdAt ?? now,
      e.lastSeenAt ?? e.createdAt ?? now,
      e.errorMessage ?? "",
      e.filePath ?? "",
      e.lineNumber ?? null,
      e.rootCause ?? "",
      e.fixDescription ?? "",
      Number(e.occurrenceCount ?? 1),
      deviceId
    );
    for (const tag of e.tags ?? []) {
      insertTag.run(e.id, tag);
    }
    for (const rel of e.relatedBugIds ?? []) {
      insertRelated.run(e.id, rel);
    }
  }
}

function importTokenLedger(
  db: DbDriver,
  ledger: JsonTokenLedger,
  deviceId: string,
  archived: 0 | 1
): void {
  // Lifetime is summed per device, NOT recomputed from sessions — the
  // archive flow drops sessions but retains their contributions to
  // lifetime, so deriving lifetime from active sessions would lose history.
  const insertSession = db.prepare(`
    INSERT OR IGNORE INTO ledger_sessions (
      session_id, device_id, start_timestamp, end_timestamp,
      read_count, write_count, estimated_tokens, repeated_reads,
      file_index_hits, file_index_misses, estimated_savings, archived
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertRead = db.prepare(
    "INSERT INTO ledger_reads (session_id, file_path, estimated_tokens, read_count) VALUES (?, ?, ?, ?)"
  );
  const insertWrite = db.prepare(
    "INSERT INTO ledger_writes (session_id, file_path, estimated_tokens, action) VALUES (?, ?, ?, ?)"
  );

  for (const s of ledger.sessions ?? []) {
    insertSession.run(
      s.sessionId,
      deviceId,
      s.startTimestamp,
      s.endTimestamp,
      s.totals?.readCount ?? 0,
      s.totals?.writeCount ?? 0,
      s.totals?.estimatedTokens ?? 0,
      s.totals?.repeatedReads ?? 0,
      s.totals?.fileIndexHits ?? 0,
      s.totals?.fileIndexMisses ?? 0,
      s.estimatedSavings ?? 0,
      archived
    );
    // INSERT OR IGNORE may have skipped this session; only insert child
    // rows when the session is new. Cheap check via session_id existence.
    const exists = db
      .prepare("SELECT 1 FROM ledger_reads WHERE session_id = ? LIMIT 1")
      .get(s.sessionId);
    if (!exists) {
      for (const r of s.reads ?? []) {
        insertRead.run(s.sessionId, r.filePath, r.estimatedTokens, r.readCount);
      }
      for (const w of s.writes ?? []) {
        insertWrite.run(s.sessionId, w.filePath, w.estimatedTokens, w.action);
      }
    }
  }

  // Sum lifetime counters per device.
  const lt = ledger.lifetime;
  if (lt) {
    db.prepare(`
      INSERT INTO ledger_lifetime (
        device_id, total_tokens, total_reads, total_writes, total_sessions,
        total_file_index_hits, total_file_index_misses, total_repeated_reads, total_estimated_savings
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        total_tokens             = ledger_lifetime.total_tokens             + excluded.total_tokens,
        total_reads              = ledger_lifetime.total_reads              + excluded.total_reads,
        total_writes             = ledger_lifetime.total_writes             + excluded.total_writes,
        total_sessions           = ledger_lifetime.total_sessions           + excluded.total_sessions,
        total_file_index_hits    = ledger_lifetime.total_file_index_hits    + excluded.total_file_index_hits,
        total_file_index_misses  = ledger_lifetime.total_file_index_misses  + excluded.total_file_index_misses,
        total_repeated_reads     = ledger_lifetime.total_repeated_reads     + excluded.total_repeated_reads,
        total_estimated_savings  = ledger_lifetime.total_estimated_savings  + excluded.total_estimated_savings
    `).run(
      deviceId,
      lt.totalTokens ?? 0,
      lt.totalReads ?? 0,
      lt.totalWrites ?? 0,
      lt.totalSessions ?? 0,
      lt.totalFileIndexHits ?? 0,
      lt.totalFileIndexMisses ?? 0,
      lt.totalRepeatedReads ?? 0,
      lt.totalEstimatedSavings ?? 0
    );
  }
}

function importArchive(
  db: DbDriver,
  archived: JsonLedgerSession[],
  deviceId: string
): void {
  // Archive shape on disk is just an array of sessions (no lifetime block).
  importTokenLedger(db, { lifetime: undefined as never, sessions: archived }, deviceId, 1);
}

function importCounters(db: DbDriver, projDir: string): void {
  const path = fileIndexCountersPath(projDir.endsWith("/") ? projDir.slice(0, -1) : projDir);
  // fileIndexCountersPath takes cwd but joins under projectDir(cwd). We
  // already have projDir, so reconstruct directly.
  const direct = join(projDir, ".mink-state-counters.json");
  const counters = safeReadJson<Record<string, { hits?: number; misses?: number }>>(
    existsSync(direct) ? direct : path
  );
  if (!counters) return;
  const stmt = db.prepare(`
    INSERT INTO counters (device_id, file_index_hits, file_index_misses)
    VALUES (?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      file_index_hits   = counters.file_index_hits   + excluded.file_index_hits,
      file_index_misses = counters.file_index_misses + excluded.file_index_misses
  `);
  for (const [deviceId, v] of Object.entries(counters)) {
    stmt.run(deviceId, Number(v.hits ?? 0), Number(v.misses ?? 0));
  }
}

// Anchor on the projectDir for a given cwd (computed once by the caller, to
// match the dir the DB itself lives in).
export function migrateJsonIfNeeded(db: DbDriver, cwd: string): void {
  if (readMeta(db, "migrated_from_json_at") !== null) return;

  const projDir = projectDir(cwd);
  if (!existsSync(projDir)) {
    // Brand-new project. Mark as migrated so the importer never runs.
    writeMeta(db, "migrated_from_json_at", new Date().toISOString());
    return;
  }

  const now = new Date().toISOString();
  const backupRoot = join(projDir, "legacy-backup");

  type Source = {
    deviceId: string;
    fileIndex?: string;
    bugMemory?: string;
    ledger?: string;
    archive?: string;
  };

  const sources: Source[] = [];

  // Per-device shards.
  for (const id of listDeviceShards(projDir)) {
    const shardDir = join(projDir, "state", id);
    sources.push({
      deviceId: id,
      bugMemory: join(shardDir, "bug-memory.json"),
      ledger: join(shardDir, "token-ledger.json"),
      archive: join(shardDir, "token-ledger-archive.json"),
    });
  }

  // Legacy root JSONs — pre-sync-v2 state lives directly under projDir.
  sources.push({
    deviceId: LEGACY_DEVICE_ID,
    fileIndex: join(projDir, "file-index.json"),
    bugMemory: join(projDir, "bug-memory.json"),
    ledger: join(projDir, "token-ledger.json"),
    archive: join(projDir, "token-ledger-archive.json"),
  });

  db.transaction(() => {
    for (const src of sources) {
      if (src.fileIndex && existsSync(src.fileIndex)) {
        const idx = safeReadJson<JsonFileIndex>(src.fileIndex);
        if (idx) importFileIndex(db, idx, src.deviceId, now);
      }
      if (src.bugMemory && existsSync(src.bugMemory)) {
        const mem = safeReadJson<JsonBugMemory>(src.bugMemory);
        if (mem) importBugMemory(db, mem, src.deviceId);
      }
      if (src.ledger && existsSync(src.ledger)) {
        const led = safeReadJson<JsonTokenLedger>(src.ledger);
        if (led) importTokenLedger(db, led, src.deviceId, 0);
      }
      if (src.archive && existsSync(src.archive)) {
        const arch = safeReadJson<JsonLedgerSession[]>(src.archive);
        if (arch && Array.isArray(arch)) importArchive(db, arch, src.deviceId);
      }
    }

    importCounters(db, projDir);
    writeMeta(db, "migrated_from_json_at", now);
  });

  // Move all successfully-imported sources to legacy-backup. As of
  // Phase 4 every JSON store has a SQLite replacement, so we don't
  // need to leave anything in place for the legacy aggregators.
  for (const src of sources) {
    if (src.fileIndex) moveSourceToBackup(src.fileIndex, backupRoot, src.deviceId);
    if (src.bugMemory) moveSourceToBackup(src.bugMemory, backupRoot, src.deviceId);
    if (src.ledger)    moveSourceToBackup(src.ledger,    backupRoot, src.deviceId);
    if (src.archive)   moveSourceToBackup(src.archive,   backupRoot, src.deviceId);
  }
}

// Avoid the unused-import warning under strict typecheck. (`dirname` is
// referenced indirectly via mkdirSync; keep this footer if no direct usage
// remains.)
void dirname;
