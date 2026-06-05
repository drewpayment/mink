import { readFileSync, writeFileSync, appendFileSync, copyFileSync, renameSync, unlinkSync } from "fs";
import { join } from "path";
import { minkRoot } from "./paths";
import { parseLearningMemory, serializeLearningMemory } from "./learning-memory";
import { openDriver } from "../storage/driver";
import { applySchema } from "../storage/schema";
import type { LearningMemory, SectionName } from "../types/learning-memory";
import type { FileIndex, FileIndexEntry } from "../types/file-index";
import type { DeviceInfo, DeviceRegistry } from "../types/config";

// Custom git merge drivers. All three follow the same contract: read base /
// ours / theirs from disk, compute a deterministic merged result, write it to
// the ours-path, and exit 0 — never fail, never leave conflict markers. Any
// parse error or unexpected shape falls back to "ours" (the local side) and
// logs the failure to ~/.mink/sync-warnings.log so the user can investigate
// later, but the merge itself succeeds and sync stays unblocked.

interface DriverArgs {
  basePath: string;
  oursPath: string;
  theirsPath: string;
  // The original repo path being merged — used in the warning log only.
  filePath: string;
}

function logWarning(driver: string, args: DriverArgs, err: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] ${driver} fallback for ${args.filePath}: ${err instanceof Error ? err.message : String(err)}\n`;
    appendFileSync(join(minkRoot(), "sync-warnings.log"), line);
  } catch {
    // Even logging is best-effort — we never want to block a merge.
  }
}

function readJsonOrNull(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// ── mink-json-union: file-index.json ───────────────────────────────────────

function isFileIndexShape(value: unknown): value is FileIndex {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.header === "object" &&
    obj.header !== null &&
    typeof obj.entries === "object" &&
    obj.entries !== null
  );
}

function mergeFileIndex(ours: FileIndex, theirs: FileIndex): FileIndex {
  const entries: Record<string, FileIndexEntry> = { ...ours.entries };
  for (const [path, entry] of Object.entries(theirs.entries)) {
    const existing = entries[path];
    if (!existing) {
      entries[path] = entry;
      continue;
    }
    // Prefer the side with the more recent lastModified — describes the most
    // up-to-date snapshot of the file.
    if (entry.lastModified > existing.lastModified) {
      entries[path] = entry;
    }
  }
  // Header: latest lastScanTimestamp wins; totalFiles becomes the merged count.
  const lastScan =
    ours.header.lastScanTimestamp > theirs.header.lastScanTimestamp
      ? ours.header.lastScanTimestamp
      : theirs.header.lastScanTimestamp;
  return {
    header: {
      lastScanTimestamp: lastScan,
      totalFiles: Object.keys(entries).length,
      // Header counters are deprecated under sync v2 (counters live in
      // .mink-state-counters.json per device). Preserve max for legacy reads.
      lifetimeHits: Math.max(
        ours.header.lifetimeHits,
        theirs.header.lifetimeHits
      ),
      lifetimeMisses: Math.max(
        ours.header.lifetimeMisses,
        theirs.header.lifetimeMisses
      ),
    },
    entries,
  };
}

export function mergeJsonUnion(args: DriverArgs): void {
  try {
    const ours = readJsonOrNull(args.oursPath);
    const theirs = readJsonOrNull(args.theirsPath);
    if (!isFileIndexShape(ours) || !isFileIndexShape(theirs)) {
      logWarning(
        "mink-json-union",
        args,
        new Error("non-FileIndex shape — keeping ours")
      );
      return;
    }
    const merged = mergeFileIndex(ours, theirs);
    writeFileSync(args.oursPath, JSON.stringify(merged, null, 2));
  } catch (err) {
    logWarning("mink-json-union", args, err);
  }
}

// ── mink-learning-memory: learning-memory.md ───────────────────────────────

function mergeLearningMemory(
  ours: LearningMemory,
  theirs: LearningMemory
): LearningMemory {
  const projectName =
    ours.projectName !== "unknown"
      ? ours.projectName
      : theirs.projectName;
  const sectionNames: SectionName[] = [
    "User Preferences",
    "Key Learnings",
    "Do-Not-Repeat",
    "Decision Log",
  ];
  const sections = {} as LearningMemory["sections"];
  for (const section of sectionNames) {
    const existing = new Map<string, string>();
    for (const entry of ours.sections[section] ?? []) {
      existing.set(entry.trim().toLowerCase(), entry);
    }
    for (const entry of theirs.sections[section] ?? []) {
      const norm = entry.trim().toLowerCase();
      if (!existing.has(norm)) {
        existing.set(norm, entry);
      }
    }
    sections[section] = [...existing.values()];
  }
  return { projectName, sections };
}

export function mergeLearningMemoryDriver(args: DriverArgs): void {
  try {
    const ours = parseLearningMemory(readTextOrEmpty(args.oursPath));
    const theirs = parseLearningMemory(readTextOrEmpty(args.theirsPath));
    const merged = mergeLearningMemory(ours, theirs);
    writeFileSync(args.oursPath, serializeLearningMemory(merged));
  } catch (err) {
    logWarning("mink-learning-memory", args, err);
  }
}

// ── mink-devices: devices.json ─────────────────────────────────────────────

function isDeviceRegistry(value: unknown): value is DeviceRegistry {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.devices === "object" &&
    obj.devices !== null &&
    !Array.isArray(obj.devices)
  );
}

function mergeDevicesRegistry(
  ours: DeviceRegistry,
  theirs: DeviceRegistry
): DeviceRegistry {
  const devices: Record<string, DeviceInfo> = { ...ours.devices };
  for (const [id, info] of Object.entries(theirs.devices)) {
    const existing = devices[id];
    if (!existing) {
      devices[id] = info;
      continue;
    }
    devices[id] = {
      // Prefer ours.name (user-set) when set; otherwise take theirs.
      name: existing.name || info.name,
      hostname: existing.hostname || info.hostname,
      platform: existing.platform || info.platform,
      firstSeen:
        existing.firstSeen < info.firstSeen
          ? existing.firstSeen
          : info.firstSeen,
      lastSeen:
        existing.lastSeen > info.lastSeen
          ? existing.lastSeen
          : info.lastSeen,
    };
  }
  return { devices };
}

export function mergeDevicesDriver(args: DriverArgs): void {
  try {
    const ours = readJsonOrNull(args.oursPath);
    const theirs = readJsonOrNull(args.theirsPath);
    if (!isDeviceRegistry(ours) || !isDeviceRegistry(theirs)) {
      logWarning(
        "mink-devices",
        args,
        new Error("non-DeviceRegistry shape — keeping ours")
      );
      return;
    }
    const merged = mergeDevicesRegistry(ours, theirs);
    writeFileSync(args.oursPath, JSON.stringify(merged, null, 2));
  } catch (err) {
    logWarning("mink-devices", args, err);
  }
}

// ── mink-db-merge: projects/*/mink.db ──────────────────────────────────────
// Two-DB reconciliation: open `ours.db` for read/write, ATTACH `theirs.db`
// as a read-only schema, replay rows via INSERT OR ... ON CONFLICT using
// the same per-store conflict rules the JSON aggregator uses today.
// Sessions / counters / ledger_lifetime are append-merge keyed by device.
// Falls back to "keep ours" on any failure so a merge driver never blocks
// the rebase.

interface DbHandle {
  exec(sql: string): void;
  prepare(sql: string): { run(...args: unknown[]): unknown };
  close(): void;
}

function attachAndReplay(ours: DbHandle, theirsPath: string): void {
  // ATTACH requires the path to be a literal string parameter; bind it
  // with the prepare binding to avoid SQL injection from a weird filename.
  ours.prepare("ATTACH DATABASE ? AS theirs").run(theirsPath);
  try {
    ours.exec(`
      -- file_index: keep the side with the newer last_modified.
      INSERT INTO file_index
        (file_path, description, estimated_tokens, last_modified, last_indexed,
         mtime_ms, content_hash, size_bytes, device_id)
      SELECT file_path, description, estimated_tokens, last_modified, last_indexed,
             mtime_ms, content_hash, size_bytes, device_id
      FROM theirs.file_index
      WHERE TRUE
      ON CONFLICT(file_path) DO UPDATE SET
        description       = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.description       ELSE file_index.description       END,
        estimated_tokens  = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.estimated_tokens  ELSE file_index.estimated_tokens  END,
        last_indexed      = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.last_indexed      ELSE file_index.last_indexed      END,
        last_modified     = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.last_modified     ELSE file_index.last_modified     END,
        mtime_ms          = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.mtime_ms          ELSE file_index.mtime_ms          END,
        content_hash      = COALESCE(excluded.content_hash, file_index.content_hash),
        size_bytes        = COALESCE(excluded.size_bytes,   file_index.size_bytes),
        device_id         = CASE WHEN excluded.last_modified > file_index.last_modified THEN excluded.device_id         ELSE file_index.device_id         END;

      -- bug_memory: oldest createdAt + latest lastSeenAt + max occurrence_count.
      INSERT INTO bug_memory
        (id, created_at, last_seen_at, error_message, file_path, line_number,
         root_cause, fix_description, occurrence_count, device_id)
      SELECT id, created_at, last_seen_at, error_message, file_path, line_number,
             root_cause, fix_description, occurrence_count, device_id
      FROM theirs.bug_memory
      WHERE TRUE
      ON CONFLICT(id) DO UPDATE SET
        created_at       = CASE WHEN excluded.created_at < bug_memory.created_at THEN excluded.created_at ELSE bug_memory.created_at END,
        last_seen_at     = CASE WHEN excluded.last_seen_at > bug_memory.last_seen_at THEN excluded.last_seen_at ELSE bug_memory.last_seen_at END,
        occurrence_count = MAX(bug_memory.occurrence_count, excluded.occurrence_count);

      INSERT OR IGNORE INTO bug_tags    (bug_id, tag)             SELECT bug_id, tag             FROM theirs.bug_tags;
      INSERT OR IGNORE INTO bug_related (bug_id, related_bug_id)  SELECT bug_id, related_bug_id  FROM theirs.bug_related;

      -- Ledger sessions are insert-only and device-isolated, so first writer
      -- wins is correct (shards never overlap session_id in production).
      INSERT OR IGNORE INTO ledger_sessions
        (session_id, device_id, start_timestamp, end_timestamp, read_count,
         write_count, estimated_tokens, repeated_reads, file_index_hits,
         file_index_misses, estimated_savings, archived)
      SELECT session_id, device_id, start_timestamp, end_timestamp, read_count,
             write_count, estimated_tokens, repeated_reads, file_index_hits,
             file_index_misses, estimated_savings, archived
      FROM theirs.ledger_sessions;

      INSERT INTO ledger_reads  (session_id, file_path, estimated_tokens, read_count)
        SELECT session_id, file_path, estimated_tokens, read_count
        FROM theirs.ledger_reads
        WHERE session_id IN (SELECT session_id FROM theirs.ledger_sessions
                             WHERE session_id NOT IN (SELECT session_id FROM ledger_reads));

      INSERT INTO ledger_writes (session_id, file_path, estimated_tokens, action)
        SELECT session_id, file_path, estimated_tokens, action
        FROM theirs.ledger_writes
        WHERE session_id IN (SELECT session_id FROM theirs.ledger_sessions
                             WHERE session_id NOT IN (SELECT session_id FROM ledger_writes));

      -- Per-device lifetime sums and counters: take the MAX so concurrent
      -- increments on different devices don't double-count when the same
      -- device's row is shared (it shouldn't be, but MAX is a safe upper
      -- bound under concurrent shard mutation).
      INSERT INTO ledger_lifetime
        (device_id, total_tokens, total_reads, total_writes, total_sessions,
         total_file_index_hits, total_file_index_misses, total_repeated_reads,
         total_estimated_savings)
      SELECT device_id, total_tokens, total_reads, total_writes, total_sessions,
             total_file_index_hits, total_file_index_misses, total_repeated_reads,
             total_estimated_savings
      FROM theirs.ledger_lifetime
      WHERE TRUE
      ON CONFLICT(device_id) DO UPDATE SET
        total_tokens             = MAX(ledger_lifetime.total_tokens,             excluded.total_tokens),
        total_reads              = MAX(ledger_lifetime.total_reads,              excluded.total_reads),
        total_writes             = MAX(ledger_lifetime.total_writes,             excluded.total_writes),
        total_sessions           = MAX(ledger_lifetime.total_sessions,           excluded.total_sessions),
        total_file_index_hits    = MAX(ledger_lifetime.total_file_index_hits,    excluded.total_file_index_hits),
        total_file_index_misses  = MAX(ledger_lifetime.total_file_index_misses,  excluded.total_file_index_misses),
        total_repeated_reads     = MAX(ledger_lifetime.total_repeated_reads,     excluded.total_repeated_reads),
        total_estimated_savings  = MAX(ledger_lifetime.total_estimated_savings,  excluded.total_estimated_savings);

      INSERT INTO counters (device_id, file_index_hits, file_index_misses)
      SELECT device_id, file_index_hits, file_index_misses
      FROM theirs.counters
      WHERE TRUE
      ON CONFLICT(device_id) DO UPDATE SET
        file_index_hits   = MAX(counters.file_index_hits,   excluded.file_index_hits),
        file_index_misses = MAX(counters.file_index_misses, excluded.file_index_misses);

      INSERT OR IGNORE INTO waste_flags (pattern, detected_at, details, device_id)
        SELECT pattern, detected_at, details, device_id FROM theirs.waste_flags;
    `);
  } finally {
    ours.exec("DETACH DATABASE theirs");
  }
}

export function mergeDbDriver(args: DriverArgs): void {
  // Run the merge in a side-DB so a crash mid-replay never leaves ours in
  // a half-merged state. We copy ours -> a temp file, replay theirs into
  // the copy, then atomically replace ours via rename. Sidecar WAL/SHM
  // files in the temp location are cleaned up before rename.
  const tmp = `${args.oursPath}.merge-${process.pid}-${Date.now()}.tmp`;
  let ours: ReturnType<typeof openDriver> | null = null;
  try {
    copyFileSync(args.oursPath, tmp);
    ours = openDriver(tmp);
    ours.exec("PRAGMA journal_mode = WAL");
    ours.exec("PRAGMA foreign_keys = ON");
    applySchema(ours); // tolerate `theirs` carrying tables we don't yet have

    attachAndReplay(ours, args.theirsPath);

    ours.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    ours.close();
    ours = null;

    // Clean up WAL/SHM sidecars left by the temp DB so the rename target
    // is a single self-contained file. SQLite truncates the WAL above; we
    // remove the empty sidecar entries explicitly.
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try { unlinkSync(`${tmp}${suffix}`); } catch { /* not present */ }
    }

    // Atomic replace: rename within the same directory is atomic on POSIX, so
    // a crash can never leave args.oursPath half-written. A plain copy is not
    // atomic — a crash mid-copy could truncate ours.db. `tmp` is created
    // alongside oursPath, so the rename stays on one filesystem and won't
    // EXDEV. (The WAL/SHM sidecars were already cleaned above, so the renamed
    // file is self-contained.)
    renameSync(tmp, args.oursPath);
  } catch (err) {
    logWarning("mink-db-merge", args, err);
    try { if (ours) ours.close(); } catch { /* ignore */ }
    try { unlinkSync(tmp); } catch { /* ignore */ }
    // Fall back to ours by doing nothing — the original args.oursPath is
    // untouched.
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

export function runMergeDriver(
  name: string,
  basePath: string,
  oursPath: string,
  theirsPath: string,
  filePath: string
): number {
  const args: DriverArgs = { basePath, oursPath, theirsPath, filePath };
  switch (name) {
    case "mink-json-union":
      // Legacy driver — still registered for projects pre-Phase 2 of the
      // SQLite migration where file-index.json may resurface during sync
      // of legacy-backup contents. New projects don't use it.
      mergeJsonUnion(args);
      return 0;
    case "mink-db-merge":
      mergeDbDriver(args);
      return 0;
    case "mink-learning-memory":
      mergeLearningMemoryDriver(args);
      return 0;
    case "mink-devices":
      mergeDevicesDriver(args);
      return 0;
    default:
      logWarning(name, args, new Error("unknown driver — keeping ours"));
      return 0;
  }
}
