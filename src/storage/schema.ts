// Initial schema for `mink.db`. One database per project, lives at
// `~/.mink/projects/{projectId}/mink.db`. WAL mode is set in
// `db.ts:openProjectDb`, not here, so the schema text alone is safe to load
// in pure-test contexts that use an in-memory connection.
//
// Conventions:
// - Every timestamp is ISO-8601 in TEXT. SQLite has no native datetime type,
//   ISO sorts lexicographically, and the JSON state files already use ISO.
// - Every row carries `device_id` so the multi-device sync merge driver
//   (Phase 2/3) can reconcile origin without re-reading shard directories.
// - Foreign keys are enforced (PRAGMA foreign_keys = ON in db.ts).
// - `meta(key, value)` holds versioning + migration markers. Keep it small;
//   per-store counters live in `counters` and `ledger_lifetime`.

export const SCHEMA_VERSION = 3;

export const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS file_index (
  file_path        TEXT PRIMARY KEY,
  description      TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL,
  last_modified    TEXT NOT NULL,
  last_indexed     TEXT NOT NULL,
  mtime_ms         INTEGER NOT NULL,
  content_hash     TEXT,
  size_bytes       INTEGER,
  device_id        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_index_mtime   ON file_index(mtime_ms);
CREATE INDEX IF NOT EXISTS idx_file_index_indexed ON file_index(last_indexed);

CREATE TABLE IF NOT EXISTS bug_memory (
  id               TEXT PRIMARY KEY,
  created_at       TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  error_message    TEXT NOT NULL,
  file_path        TEXT NOT NULL,
  line_number      INTEGER,
  root_cause       TEXT NOT NULL,
  fix_description  TEXT NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1,
  device_id        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bug_memory_file ON bug_memory(file_path);
CREATE INDEX IF NOT EXISTS idx_bug_memory_seen ON bug_memory(last_seen_at);

CREATE TABLE IF NOT EXISTS bug_tags (
  bug_id TEXT NOT NULL REFERENCES bug_memory(id) ON DELETE CASCADE,
  tag    TEXT NOT NULL,
  PRIMARY KEY (bug_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_bug_tags_tag ON bug_tags(tag);

CREATE TABLE IF NOT EXISTS bug_related (
  bug_id         TEXT NOT NULL REFERENCES bug_memory(id) ON DELETE CASCADE,
  related_bug_id TEXT NOT NULL,
  PRIMARY KEY (bug_id, related_bug_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS bug_memory_fts USING fts5(
  bug_id UNINDEXED,
  error_message,
  root_cause,
  fix_description,
  tags,
  tokenize = 'porter unicode61'
);

-- Mirror bug_memory + bug_tags into bug_memory_fts. Tag aggregation is done
-- in a single subquery inside each trigger so multi-tag bugs get one FTS row
-- with the full tag string.
CREATE TRIGGER IF NOT EXISTS trg_bug_memory_ai AFTER INSERT ON bug_memory BEGIN
  INSERT INTO bug_memory_fts (bug_id, error_message, root_cause, fix_description, tags)
  VALUES (
    NEW.id,
    NEW.error_message,
    NEW.root_cause,
    NEW.fix_description,
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM bug_tags WHERE bug_id = NEW.id), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_bug_memory_ad AFTER DELETE ON bug_memory BEGIN
  DELETE FROM bug_memory_fts WHERE bug_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bug_memory_au AFTER UPDATE ON bug_memory BEGIN
  DELETE FROM bug_memory_fts WHERE bug_id = OLD.id;
  INSERT INTO bug_memory_fts (bug_id, error_message, root_cause, fix_description, tags)
  VALUES (
    NEW.id,
    NEW.error_message,
    NEW.root_cause,
    NEW.fix_description,
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM bug_tags WHERE bug_id = NEW.id), '')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_bug_tags_ai AFTER INSERT ON bug_tags BEGIN
  DELETE FROM bug_memory_fts WHERE bug_id = NEW.bug_id;
  INSERT INTO bug_memory_fts (bug_id, error_message, root_cause, fix_description, tags)
  SELECT id, error_message, root_cause, fix_description,
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM bug_tags WHERE bug_id = NEW.bug_id), '')
  FROM bug_memory WHERE id = NEW.bug_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bug_tags_ad AFTER DELETE ON bug_tags BEGIN
  DELETE FROM bug_memory_fts WHERE bug_id = OLD.bug_id;
  INSERT INTO bug_memory_fts (bug_id, error_message, root_cause, fix_description, tags)
  SELECT id, error_message, root_cause, fix_description,
    COALESCE((SELECT GROUP_CONCAT(tag, ' ') FROM bug_tags WHERE bug_id = OLD.bug_id), '')
  FROM bug_memory WHERE id = OLD.bug_id;
END;

CREATE TABLE IF NOT EXISTS ledger_lifetime (
  device_id                TEXT PRIMARY KEY,
  total_tokens             INTEGER NOT NULL DEFAULT 0,
  total_reads              INTEGER NOT NULL DEFAULT 0,
  total_writes             INTEGER NOT NULL DEFAULT 0,
  total_sessions           INTEGER NOT NULL DEFAULT 0,
  total_file_index_hits    INTEGER NOT NULL DEFAULT 0,
  total_file_index_misses  INTEGER NOT NULL DEFAULT 0,
  total_repeated_reads     INTEGER NOT NULL DEFAULT 0,
  total_estimated_savings  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ledger_sessions (
  session_id          TEXT PRIMARY KEY,
  device_id           TEXT NOT NULL,
  start_timestamp     TEXT NOT NULL,
  end_timestamp       TEXT NOT NULL,
  read_count          INTEGER NOT NULL DEFAULT 0,
  write_count         INTEGER NOT NULL DEFAULT 0,
  estimated_tokens    INTEGER NOT NULL DEFAULT 0,
  repeated_reads      INTEGER NOT NULL DEFAULT 0,
  file_index_hits     INTEGER NOT NULL DEFAULT 0,
  file_index_misses   INTEGER NOT NULL DEFAULT 0,
  estimated_savings   INTEGER NOT NULL DEFAULT 0,
  archived            INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ledger_sessions_start    ON ledger_sessions(start_timestamp);
CREATE INDEX IF NOT EXISTS idx_ledger_sessions_device   ON ledger_sessions(device_id);
CREATE INDEX IF NOT EXISTS idx_ledger_sessions_archived ON ledger_sessions(archived);

CREATE TABLE IF NOT EXISTS ledger_reads (
  session_id       TEXT NOT NULL REFERENCES ledger_sessions(session_id) ON DELETE CASCADE,
  file_path        TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  read_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ledger_reads_session ON ledger_reads(session_id);

CREATE TABLE IF NOT EXISTS ledger_writes (
  session_id       TEXT NOT NULL REFERENCES ledger_sessions(session_id) ON DELETE CASCADE,
  file_path        TEXT NOT NULL,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  action           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_writes_session ON ledger_writes(session_id);

CREATE TABLE IF NOT EXISTS waste_flags (
  pattern     TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  details     TEXT,
  device_id   TEXT NOT NULL,
  PRIMARY KEY (pattern, detected_at, device_id)
);

CREATE TABLE IF NOT EXISTS counters (
  device_id         TEXT PRIMARY KEY,
  file_index_hits   INTEGER NOT NULL DEFAULT 0,
  file_index_misses INTEGER NOT NULL DEFAULT 0
);

-- Tool-output compression measurement (spec 22). One row per compression
-- decision: either a compressed arm (compressed_tokens < original_tokens) or a
-- holdout arm (left uncompressed for control, compressed_tokens = original_tokens).
-- These are append-only telemetry, independent of session lifecycle, written at
-- the moment a tool output is processed. New table → applied to existing DBs via
-- IF NOT EXISTS on the next open.
CREATE TABLE IF NOT EXISTS ledger_compressions (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL,
  tool_name         TEXT NOT NULL,
  content_kind      TEXT NOT NULL,
  original_tokens   INTEGER NOT NULL DEFAULT 0,
  compressed_tokens INTEGER NOT NULL DEFAULT 0,
  holdout           INTEGER NOT NULL DEFAULT 0,
  device_id         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_compressions_created ON ledger_compressions(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_compressions_device  ON ledger_compressions(device_id);

-- Per-device compression aggregates, summed across devices like ledger_lifetime.
-- measured_savings only credits compressed arms (holdout arms save nothing by
-- construction), so the reported figure is a true measured delta, not an estimate.
CREATE TABLE IF NOT EXISTS ledger_compression_lifetime (
  device_id               TEXT PRIMARY KEY,
  total_events            INTEGER NOT NULL DEFAULT 0,
  total_holdout_events    INTEGER NOT NULL DEFAULT 0,
  total_original_tokens   INTEGER NOT NULL DEFAULT 0,
  total_compressed_tokens INTEGER NOT NULL DEFAULT 0,
  total_measured_savings  INTEGER NOT NULL DEFAULT 0
);

-- Reversible-compression cache (spec 22 §Reversibility). When a tool output is
-- compressed, the original is stored here keyed by a short retrieval token and
-- embedded in the compressed result; "mink retrieve <token>" returns it
-- byte-exact. Rows expire after the configured retention window; an expired or
-- unknown token is a graceful miss. This is a local cache, not synced state, so
-- (unlike other tables) it carries no merge semantics beyond device_id for audit.
CREATE TABLE IF NOT EXISTS compression_cache (
  token        TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  tool_name    TEXT NOT NULL,
  content_kind TEXT NOT NULL,
  content      TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  device_id    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_compression_cache_expires ON compression_cache(expires_at);
`;

export interface DriverForSchema {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
}

export function applySchema(db: DriverForSchema): void {
  db.exec(INITIAL_SCHEMA);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(SCHEMA_VERSION)
  );
}

export function readMeta(db: DriverForSchema, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
  if (!row) return null;
  return String((row as Record<string, unknown>).value);
}

export function writeMeta(db: DriverForSchema, key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}
