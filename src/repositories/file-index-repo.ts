// File-index repository. Wraps the file_index table in `mink.db` behind a
// stable function-based API that the wrapper in src/core/index-store.ts
// delegates to. Hook hot paths (pre-read, post-write) call exactly one
// method per hook invocation — no full-index load.
//
// All writes attribute the calling device via device_id so the cross-device
// sync merge driver (mink-db-merge) can reconcile origin. Counters that
// were previously kept in file-index.json's header (lifetimeHits /
// lifetimeMisses) live in the `counters` table indexed by device_id.

import type { DbDriver } from "../storage/driver";
import type { FileIndexEntry, StalenessReport } from "../types/file-index";
import { openProjectDb } from "../storage/db";
import { getOrCreateDeviceId } from "../core/device";

interface FileIndexRow {
  file_path: string;
  description: string;
  estimated_tokens: number;
  last_modified: string;
  last_indexed: string;
  mtime_ms: number;
  content_hash: string | null;
  size_bytes: number | null;
  device_id: string;
}

function rowToEntry(row: FileIndexRow): FileIndexEntry {
  return {
    filePath: row.file_path,
    description: row.description,
    estimatedTokens: row.estimated_tokens,
    lastModified: row.last_modified,
    lastIndexed: row.last_indexed,
  };
}

// Mirror of upsertEntry's semantics under the JSON store, expressed as a
// single SQL upsert. Conflict resolution picks the more recent
// last_modified — matches the merge driver's per-row rule so a hook that
// runs concurrently with sync converges deterministically.
const UPSERT_SQL = `
  INSERT INTO file_index
    (file_path, description, estimated_tokens, last_modified, last_indexed,
     mtime_ms, content_hash, size_bytes, device_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(file_path) DO UPDATE SET
    description       = excluded.description,
    estimated_tokens  = excluded.estimated_tokens,
    last_modified     = excluded.last_modified,
    last_indexed      = excluded.last_indexed,
    mtime_ms          = excluded.mtime_ms,
    content_hash      = COALESCE(excluded.content_hash, file_index.content_hash),
    size_bytes        = COALESCE(excluded.size_bytes,   file_index.size_bytes),
    device_id         = excluded.device_id
`;

export interface UpsertOptions {
  mtimeMs?: number;
  contentHash?: string | null;
  sizeBytes?: number | null;
  deviceId?: string;
}

export interface IndexLookup {
  lookupEntry(filePath: string): FileIndexEntry | null;
}

export class FileIndexRepo implements IndexLookup {
  constructor(private readonly db: DbDriver) {}

  static for(cwd: string): FileIndexRepo {
    return new FileIndexRepo(openProjectDb(cwd));
  }

  upsert(entry: FileIndexEntry, opts: UpsertOptions = {}): void {
    const deviceId = opts.deviceId ?? getOrCreateDeviceId();
    this.db.prepare(UPSERT_SQL).run(
      entry.filePath,
      entry.description,
      entry.estimatedTokens,
      entry.lastModified,
      entry.lastIndexed,
      opts.mtimeMs ?? 0,
      opts.contentHash ?? null,
      opts.sizeBytes ?? null,
      deviceId
    );
  }

  // Bulk upsert — used by `mink scan` to push hundreds-to-thousands of
  // entries in a single transaction. ~50x faster than individual upserts
  // because SQLite skips per-row WAL fsync.
  upsertMany(entries: Array<{ entry: FileIndexEntry; opts?: UpsertOptions }>): void {
    if (entries.length === 0) return;
    const defaultDevice = getOrCreateDeviceId();
    const stmt = this.db.prepare(UPSERT_SQL);
    this.db.transaction(() => {
      for (const { entry, opts } of entries) {
        stmt.run(
          entry.filePath,
          entry.description,
          entry.estimatedTokens,
          entry.lastModified,
          entry.lastIndexed,
          opts?.mtimeMs ?? 0,
          opts?.contentHash ?? null,
          opts?.sizeBytes ?? null,
          opts?.deviceId ?? defaultDevice
        );
      }
    });
  }

  lookupEntry(filePath: string): FileIndexEntry | null {
    const row = this.db
      .prepare(
        "SELECT file_path, description, estimated_tokens, last_modified, last_indexed, mtime_ms, content_hash, size_bytes, device_id FROM file_index WHERE file_path = ?"
      )
      .get(filePath);
    if (!row) return null;
    return rowToEntry(row as unknown as FileIndexRow);
  }

  remove(filePath: string): void {
    this.db.prepare("DELETE FROM file_index WHERE file_path = ?").run(filePath);
  }

  // Remove every entry that's NOT in `keep`. Used by `mink scan` to prune
  // orphaned entries for files that have been deleted from disk. Expressed
  // as a single statement using a temp table to avoid the SQLite parameter
  // limit (defaults to 999).
  retainOnly(keep: Iterable<string>): number {
    const keepArr = [...keep];
    this.db.transaction(() => {
      this.db.exec("CREATE TEMP TABLE IF NOT EXISTS _retain (path TEXT PRIMARY KEY)");
      this.db.exec("DELETE FROM _retain");
      const stmt = this.db.prepare("INSERT OR IGNORE INTO _retain VALUES (?)");
      for (const p of keepArr) stmt.run(p);
    });
    const r = this.db
      .prepare("DELETE FROM file_index WHERE file_path NOT IN (SELECT path FROM _retain)")
      .run();
    return Number(r.changes);
  }

  // Total count of indexed files. Cheap — backed by the PRIMARY KEY index.
  totalFiles(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM file_index").get();
    return Number((row as { n: number }).n);
  }

  // Bulk list — used by analytics, dashboard, and `mink status`. Stays
  // off the hook hot path. Returns rows already shaped to the public
  // FileIndexEntry type.
  listAll(): FileIndexEntry[] {
    const rows = this.db
      .prepare(
        "SELECT file_path, description, estimated_tokens, last_modified, last_indexed, mtime_ms, content_hash, size_bytes, device_id FROM file_index ORDER BY file_path"
      )
      .all();
    return rows.map((r) => rowToEntry(r as unknown as FileIndexRow));
  }

  // For Phase 5's incremental scan. Returns the subset of `scanned` whose
  // mtime differs from what we have stored — i.e. needs re-extraction.
  // Done as one query per chunk to avoid a 20k-row IN list, but still much
  // cheaper than reading every file's content.
  staleSet(scanned: Array<{ relativePath: string; mtimeMs: number }>): string[] {
    if (scanned.length === 0) return [];
    const stmt = this.db.prepare(
      "SELECT mtime_ms FROM file_index WHERE file_path = ?"
    );
    const stale: string[] = [];
    for (const f of scanned) {
      const row = stmt.get(f.relativePath);
      if (!row) {
        stale.push(f.relativePath); // never seen before
        continue;
      }
      const storedMs = Number((row as { mtime_ms: number }).mtime_ms);
      if (storedMs !== Math.floor(f.mtimeMs)) {
        stale.push(f.relativePath);
      }
    }
    return stale;
  }

  // Mirrors checkStaleness() under the JSON store: which files are on disk
  // but not in the index (missing), and which are in the index but absent
  // from disk (orphaned).
  checkStaleness(scannedRelativePaths: string[]): StalenessReport {
    const scannedSet = new Set(scannedRelativePaths);
    const allIndexed = this.db
      .prepare("SELECT file_path FROM file_index")
      .all()
      .map((r) => (r as { file_path: string }).file_path);
    const indexedSet = new Set(allIndexed);
    const missingFromIndex = scannedRelativePaths.filter((p) => !indexedSet.has(p));
    const orphanedEntries = allIndexed.filter((p) => !scannedSet.has(p));
    return {
      missingFromIndex,
      orphanedEntries,
      isStale: missingFromIndex.length > 0 || orphanedEntries.length > 0,
    };
  }

  // Header analogues. lastScanTimestamp is the only header field that's
  // genuinely a project-wide state value; hit/miss counters live in the
  // counters table and are per-device. Stored in the meta table.
  setLastScanTimestamp(iso: string): void {
    this.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES ('last_scan_timestamp', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
      .run(iso);
  }

  getLastScanTimestamp(): string {
    const row = this.db
      .prepare("SELECT value FROM meta WHERE key = 'last_scan_timestamp'")
      .get();
    if (!row) return "";
    return String((row as { value: string }).value);
  }
}
