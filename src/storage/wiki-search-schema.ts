// Schema for the wiki full-text search index, `<vault>/.mink-search.db`.
// Separate database from the per-project `mink.db` (storage/schema.ts) —
// this one is vault-scoped (one per wiki, not one per project) and purely
// derived/regenerable state: `mink wiki reindex` rebuilds it from the
// markdown files on disk, so it is never synced (see vault.ts's
// ensureVaultGitignore and sync.ts's GITIGNORE_CONTENTS).
//
// Mirrors the bug_memory_fts pattern in storage/schema.ts: an external-content
// FTS5 table kept in sync with the source-of-truth table via triggers.
//
// Column weighting (see wiki-search-repo.ts's bm25() call) makes title/alias
// hits outrank body hits, per the `mink recall` ranking contract.

export const WIKI_SEARCH_SCHEMA_VERSION = 1;

export const WIKI_SEARCH_INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  path              TEXT PRIMARY KEY,   -- vault-relative, e.g. "projects/mink/overview.md"
  title             TEXT NOT NULL,
  category          TEXT NOT NULL,
  project_slug      TEXT,               -- frontmatter.source_project, else parsed from projects/<slug>/
  tags              TEXT NOT NULL DEFAULT '',   -- space-joined, for the FTS mirror + --tag filter
  aliases           TEXT NOT NULL DEFAULT '',   -- space-joined, for the FTS mirror only (see frontmatter for structured aliases)
  frontmatter       TEXT NOT NULL DEFAULT '{}', -- JSON blob of the parsed frontmatter — source of truth for aliases[]
  body              TEXT NOT NULL DEFAULT '',   -- markdown body (post-frontmatter), used for FTS + snippet()
  mtime_ms          INTEGER NOT NULL,
  updated_at        TEXT NOT NULL,      -- frontmatter.updated if present, else mtime as ISO
  estimated_tokens  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
CREATE INDEX IF NOT EXISTS idx_notes_project  ON notes(project_slug);
CREATE INDEX IF NOT EXISTS idx_notes_mtime    ON notes(mtime_ms);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path UNINDEXED,
  title,
  aliases,
  tags,
  body,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS trg_notes_ai AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts (path, title, aliases, tags, body)
  VALUES (NEW.path, NEW.title, NEW.aliases, NEW.tags, NEW.body);
END;

CREATE TRIGGER IF NOT EXISTS trg_notes_ad AFTER DELETE ON notes BEGIN
  DELETE FROM notes_fts WHERE path = OLD.path;
END;

CREATE TRIGGER IF NOT EXISTS trg_notes_au AFTER UPDATE ON notes BEGIN
  DELETE FROM notes_fts WHERE path = OLD.path;
  INSERT INTO notes_fts (path, title, aliases, tags, body)
  VALUES (NEW.path, NEW.title, NEW.aliases, NEW.tags, NEW.body);
END;

-- Wikilinks extracted from each note's body. 'target' is the raw link text
-- as authored (bare title, alias, slug, or path); 'resolved_path' is the
-- vault-relative path it resolves to, or NULL when unresolved/ambiguous.
-- One row per (source_path, target) pair — a note linking the same target
-- twice only needs one graph edge.
CREATE TABLE IF NOT EXISTS links (
  source_path   TEXT NOT NULL,
  target        TEXT NOT NULL,
  resolved_path TEXT,
  PRIMARY KEY (source_path, target)
);
CREATE INDEX IF NOT EXISTS idx_links_source   ON links(source_path);
CREATE INDEX IF NOT EXISTS idx_links_resolved ON links(resolved_path);
CREATE INDEX IF NOT EXISTS idx_links_target   ON links(target);
`;

export interface DriverForWikiSchema {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    get(...params: unknown[]): Record<string, unknown> | undefined;
  };
}

export function applyWikiSearchSchema(db: DriverForWikiSchema): void {
  db.exec(WIKI_SEARCH_INITIAL_SCHEMA);
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(
    "schema_version",
    String(WIKI_SEARCH_SCHEMA_VERSION)
  );
}
