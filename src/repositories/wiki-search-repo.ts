// Wiki search repository. Wraps the notes / notes_fts / links tables in
// `<vault>/.mink-search.db`. See storage/wiki-search-schema.ts for the
// schema and storage/wiki-search-db.ts for connection lifecycle.
//
// Query layer for `mink recall` (BM25 full-text) and `mink wiki
// backlinks/related` (graph queries over the links table). Indexing
// (parsing notes, resolving wikilinks) lives in core/wiki-search.ts — this
// file is SQL only, same split as BugMemoryRepo / core/bug-memory.ts.

import type { DbDriver, SqlParam } from "../storage/driver";
import { openWikiSearchDb } from "../storage/wiki-search-db";

export interface WikiSearchNoteInput {
  path: string;
  title: string;
  category: string;
  projectSlug: string | null;
  tags: string[];
  aliases: string[];
  frontmatter: Record<string, unknown>;
  body: string;
  mtimeMs: number;
  updatedAt: string;
  estimatedTokens: number;
}

export interface RecallOptions {
  limit?: number;
  project?: string;
  tag?: string;
  category?: string;
  since?: string;
}

export interface RecallResult {
  path: string;
  title: string;
  snippet: string;
  score: number;
  tags: string[];
  category: string;
  updated: string;
}

export interface LinkInput {
  target: string;
  resolvedPath: string | null;
}

export interface NoteRef {
  path: string;
  title: string;
}

export interface RelatedResult extends NoteRef {
  reason: string;
  overlap: number;
}

// bm25() weights, positional over the FTS5 table's *indexed* columns in
// declared order (title, aliases, tags, body — `path` is UNINDEXED and does
// not take a slot). Title/alias hits must outrank body hits per the
// `mink recall` contract.
const BM25_WEIGHTS = { title: 10.0, aliases: 8.0, tags: 4.0, body: 1.0 };

export class WikiSearchRepo {
  constructor(private readonly db: DbDriver) {}

  static forVault(): WikiSearchRepo {
    return new WikiSearchRepo(openWikiSearchDb());
  }

  // ── Notes ────────────────────────────────────────────────────────────────

  upsertNote(input: WikiSearchNoteInput): void {
    this.db
      .prepare(
        `
        INSERT INTO notes
          (path, title, category, project_slug, tags, aliases, frontmatter, body, mtime_ms, updated_at, estimated_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          title = excluded.title,
          category = excluded.category,
          project_slug = excluded.project_slug,
          tags = excluded.tags,
          aliases = excluded.aliases,
          frontmatter = excluded.frontmatter,
          body = excluded.body,
          mtime_ms = excluded.mtime_ms,
          updated_at = excluded.updated_at,
          estimated_tokens = excluded.estimated_tokens
      `
      )
      .run(
        input.path,
        input.title,
        input.category,
        input.projectSlug,
        input.tags.join(" "),
        input.aliases.join(" "),
        JSON.stringify(input.frontmatter ?? {}),
        input.body,
        input.mtimeMs,
        input.updatedAt,
        input.estimatedTokens
      );
  }

  deleteNote(path: string): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM notes WHERE path = ?").run(path);
      this.db.prepare("DELETE FROM links WHERE source_path = ?").run(path);
      // Un-resolve inbound links (resolved_path = path) rather than leaving
      // them pointing at a note that no longer exists — a deleted note must
      // never keep showing up as a live backlink/outlink citation. We clear
      // resolved_path (not delete the row) so the raw target text survives:
      // if the note reappears (undo, re-create, catch-up re-syncing an
      // external un-delete), backfillUnresolvedLinks() re-resolves it
      // instead of the link staying silently broken forever.
      this.db.prepare("UPDATE links SET resolved_path = NULL WHERE resolved_path = ?").run(path);
    });
  }

  listAllPaths(): Array<{ path: string; mtimeMs: number }> {
    const rows = this.db.prepare("SELECT path, mtime_ms AS mtimeMs FROM notes").all() as unknown as Array<{
      path: string;
      mtimeMs: number;
    }>;
    return rows.map((r) => ({ path: r.path, mtimeMs: Number(r.mtimeMs) }));
  }

  listTitlesAndAliases(): Array<{ path: string; title: string; aliases: string[] }> {
    const rows = this.db.prepare("SELECT path, title, frontmatter FROM notes").all() as unknown as Array<{
      path: string;
      title: string;
      frontmatter: string;
    }>;
    return rows.map((r) => {
      let aliases: string[] = [];
      try {
        const fm = JSON.parse(r.frontmatter) as Record<string, unknown>;
        if (Array.isArray(fm.aliases)) {
          aliases = fm.aliases.filter((a): a is string => typeof a === "string");
        }
      } catch {
        // malformed frontmatter JSON — treat as no aliases
      }
      return { path: r.path, title: r.title, aliases };
    });
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM notes").get();
    return Number((row as { n: number }).n);
  }

  wipeAll(): void {
    this.db.transaction(() => {
      this.db.exec("DELETE FROM notes");
      this.db.exec("DELETE FROM notes_fts");
      this.db.exec("DELETE FROM links");
    });
  }

  // Resolve a user-supplied note reference (CLI arg) to a vault-relative
  // path: exact path match (with/without .md, case-insensitive), then exact
  // title match if unambiguous. Returns null when nothing/multiple match.
  resolveNoteArg(arg: string): string | null {
    const trimmed = arg.trim();
    if (!trimmed) return null;
    const withMd = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;

    const direct = this.db.prepare("SELECT path FROM notes WHERE path = ?").get(withMd) as
      | { path: string }
      | undefined;
    if (direct) return direct.path;

    const ci = this.db.prepare("SELECT path FROM notes WHERE lower(path) = lower(?)").get(withMd) as
      | { path: string }
      | undefined;
    if (ci) return ci.path;

    const titleRows = this.db.prepare("SELECT path FROM notes WHERE lower(title) = lower(?)").all(trimmed) as
      unknown as Array<{ path: string }>;
    if (titleRows.length === 1) return titleRows[0].path;

    return null;
  }

  // ── Search (FTS5, BM25) ─────────────────────────────────────────────────

  // BM25 full-text search, with a substring-scan fallback for the case FTS5
  // prefix search structurally can't handle: the `notes_fts` table is
  // porter-stemmed, and stemming only produces well-formed stems from
  // *complete* words. A partial word typed mid-search ("authenticat" while
  // typing "authentication") gets stemmed as-is (porter needs real
  // suffixes to trigger its rules) into something that is often *longer*
  // than the true stem of the complete word ("authent") — so no indexed
  // term can ever start with it, and the query silently returns zero rows
  // regardless of the trailing `*`. When that happens, retry once against
  // a plain substring scan over the unstemmed columns so a genuine partial
  // word still finds something instead of a silent miss.
  search(query: string, opts: RecallOptions = {}): RecallResult[] {
    const filters = buildFilters(opts);
    const ftsResults = this.searchFts(query, filters);
    if (ftsResults.length > 0) return ftsResults;
    return this.searchSubstringFallback(query, filters);
  }

  private searchFts(query: string, filters: Filters): RecallResult[] {
    const ftsQuery = buildFtsQuery(query);
    if (ftsQuery === null) return [];

    const params: SqlParam[] = [ftsQuery, ...filters.params, filters.limit];
    let sql = `
      SELECT n.path AS path, n.title AS title, n.category AS category,
             n.tags AS tags, n.updated_at AS updated_at,
             bm25(notes_fts, ${BM25_WEIGHTS.title}, ${BM25_WEIGHTS.aliases}, ${BM25_WEIGHTS.tags}, ${BM25_WEIGHTS.body}) AS rank,
             snippet(notes_fts, -1, '', '', ' … ', 24) AS snippet
      FROM notes_fts
      JOIN notes n ON n.path = notes_fts.path
      WHERE notes_fts MATCH ?
    `;
    if (filters.sql.length > 0) sql += ` AND ${filters.sql.join(" AND ")}`;
    sql += " ORDER BY rank LIMIT ?";

    type Row = { path: string; title: string; category: string; tags: string; updated_at: string; rank: number; snippet: string };
    let rows: Row[];
    try {
      rows = this.db.prepare(sql).all(...params) as unknown as Row[];
    } catch {
      // FTS syntax error on a pathological query — no matches rather than a crash.
      return [];
    }

    return rows.map((r) => ({
      path: r.path,
      title: r.title,
      snippet: (r.snippet ?? "").trim(),
      score: bm25ToScore(Number(r.rank)),
      tags: (r.tags ?? "").split(" ").filter(Boolean),
      category: r.category,
      updated: r.updated_at,
    }));
  }

  // Unranked (no bm25) substring AND-of-tokens scan over the raw columns.
  // Only reached when FTS returned nothing at all, so there's no ranking
  // contention with real FTS hits to worry about — every row here gets a
  // score deliberately below the FTS score range (see bm25ToScore), ordered
  // by how many of the query tokens actually matched.
  //
  // Requires ALL tokens to match (AND), same as the primary FTS path (space-
  // separated quoted tokens are implicitly AND-ed by FTS5) — a multi-word
  // query where only SOME words are present must not start matching here
  // just because the fallback kicked in; that would silently loosen
  // multi-word queries into an OR the moment any one token fails to stem
  // usefully, which is a worse and much more surprising bug than the one
  // this fallback exists to fix.
  private searchSubstringFallback(query: string, filters: Filters): RecallResult[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return [];

    const haystack = "lower(n.title || ' ' || n.aliases || ' ' || n.tags || ' ' || n.body)";
    const matchExprs = tokens.map(() => `(${haystack} LIKE ?)`);
    const params: SqlParam[] = [
      ...tokens.map((t) => `%${t}%`),
      ...filters.params,
      filters.limit,
    ];

    let sql = `
      SELECT n.path AS path, n.title AS title, n.category AS category,
             n.tags AS tags, n.updated_at AS updated_at, n.body AS body,
             (${matchExprs.join(" + ")}) AS matched_count
      FROM notes n
      WHERE matched_count = ${tokens.length}
    `;
    if (filters.sql.length > 0) sql += ` AND ${filters.sql.join(" AND ")}`;
    sql += " ORDER BY matched_count DESC, n.updated_at DESC LIMIT ?";

    type Row = {
      path: string;
      title: string;
      category: string;
      tags: string;
      updated_at: string;
      body: string;
      matched_count: number;
    };
    let rows: Row[];
    try {
      rows = this.db.prepare(sql).all(...params) as unknown as Row[];
    } catch {
      return [];
    }

    return rows.map((r) => ({
      path: r.path,
      title: r.title,
      snippet: buildFallbackSnippet(r.body, tokens),
      // Deliberately capped below the FTS score range (see bm25ToScore,
      // which approaches but never reaches 1) — a substring hit is a lower-
      // confidence result than a real BM25 match.
      score: 0.5 * (Number(r.matched_count) / tokens.length),
      tags: (r.tags ?? "").split(" ").filter(Boolean),
      category: r.category,
      updated: r.updated_at,
    }));
  }

  // ── Links / graph queries ───────────────────────────────────────────────

  replaceLinksForSource(sourcePath: string, links: LinkInput[]): void {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM links WHERE source_path = ?").run(sourcePath);
      const insert = this.db.prepare(
        "INSERT OR IGNORE INTO links (source_path, target, resolved_path) VALUES (?, ?, ?)"
      );
      for (const link of links) {
        insert.run(sourcePath, link.target, link.resolvedPath);
      }
    });
  }

  // When a note at `path` is (re)indexed, point any previously-unresolved
  // link rows whose raw target text matches this note's title/aliases/
  // basename at it. Keeps cross-file resolution fresh without a full-vault
  // rescan on every write — `mink wiki reindex` remains the full-accuracy
  // fallback. Returns the number of links backfilled.
  backfillUnresolvedLinks(path: string, title: string, aliases: string[]): number {
    const candidates = new Set<string>([title.toLowerCase(), ...aliases.map((a) => a.toLowerCase())]);
    const base = basenameNoExt(path).toLowerCase();
    candidates.add(base);

    const rows = this.db.prepare("SELECT source_path, target FROM links WHERE resolved_path IS NULL").all() as
      unknown as Array<{ source_path: string; target: string }>;
    if (rows.length === 0) return 0;

    const update = this.db.prepare(
      "UPDATE links SET resolved_path = ? WHERE source_path = ? AND target = ?"
    );
    let n = 0;
    this.db.transaction(() => {
      for (const row of rows) {
        const lower = row.target.trim().toLowerCase();
        if (candidates.has(lower)) {
          update.run(path, row.source_path, row.target);
          n++;
        }
      }
    });
    return n;
  }

  backlinksFor(path: string): NoteRef[] {
    const rows = this.db
      .prepare(
        `
        SELECT DISTINCT l.source_path AS path, n.title AS title
        FROM links l
        JOIN notes n ON n.path = l.source_path
        WHERE l.resolved_path = ?
        ORDER BY n.title
      `
      )
      .all(path) as unknown as NoteRef[];
    return rows;
  }

  outlinksFor(path: string): Array<{ target: string; path: string | null; title: string | null }> {
    // `path`/`title` are selected from the JOINED notes row (n.path /
    // n.title), not from links.resolved_path directly. Belt-and-suspenders
    // against deleteNote() missing a case (or a links row set by older code
    // before that fix existed): if resolved_path points at a path with no
    // matching notes row, the LEFT JOIN yields NULL for both columns, so a
    // deleted note's outlink is reported as unresolved (path: null) instead
    // of citing a note that no longer exists.
    const rows = this.db
      .prepare(
        `
        SELECT l.target AS target, n.path AS path, n.title AS title
        FROM links l
        LEFT JOIN notes n ON n.path = l.resolved_path
        WHERE l.source_path = ?
        ORDER BY l.target
      `
      )
      .all(path) as unknown as Array<{ target: string; path: string | null; title: string | null }>;
    return rows;
  }

  // Backlinks + resolved outlinks + shared-tag neighbors, ranked by overlap
  // (direct link edges outrank tag-only overlap; shared-tag count breaks
  // ties among the rest). Pure SQL/JS over the index — no file reads.
  relatedFor(path: string, limit = 20): RelatedResult[] {
    const results = new Map<string, RelatedResult>();

    for (const b of this.backlinksFor(path)) {
      results.set(b.path, { ...b, reason: "backlink", overlap: 2 });
    }
    for (const o of this.outlinksFor(path)) {
      if (!o.path) continue;
      const existing = results.get(o.path);
      if (existing) {
        existing.overlap += 2;
        if (!existing.reason.includes("outlink")) existing.reason += "+outlink";
      } else {
        results.set(o.path, { path: o.path, title: o.title ?? o.path, reason: "outlink", overlap: 2 });
      }
    }

    const noteRow = this.db.prepare("SELECT tags FROM notes WHERE path = ?").get(path) as
      | { tags: string }
      | undefined;
    const tags = (noteRow?.tags ?? "").split(" ").filter(Boolean);
    if (tags.length > 0) {
      const rows = this.db.prepare("SELECT path, title, tags FROM notes WHERE path != ?").all(path) as
        unknown as Array<{ path: string; title: string; tags: string }>;
      for (const row of rows) {
        const rowTags = new Set(row.tags.split(" ").filter(Boolean));
        const shared = tags.filter((t) => rowTags.has(t)).length;
        if (shared === 0) continue;
        const existing = results.get(row.path);
        if (existing) {
          existing.overlap += shared;
          if (!existing.reason.includes("shared-tags")) existing.reason += "+shared-tags";
        } else {
          results.set(row.path, { path: row.path, title: row.title, reason: "shared-tags", overlap: shared });
        }
      }
    }

    return [...results.values()].sort((a, b) => b.overlap - a.overlap).slice(0, limit);
  }
}

function basenameNoExt(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

// FTS5's bm25() returns a NEGATIVE number where MORE negative = a BETTER
// match. The `mink recall` contract promises "higher score = better match",
// so this must invert that relationship, not just fold it into a positive
// range. (A previous version used `1 / (1 + Math.abs(rank))`, which — since
// abs() erases the sign — actually maps the *best* matches to the *lowest*
// scores: rank -2.4664 (great title hit) -> 0.2885 vs rank -1.7446 (weak
// body hit) -> 0.3643. Anything sorting/thresholding on `score` directly,
// rather than relying on the SQL ORDER BY, got exactly backwards results.)
//
// Negate first so "better" becomes "larger positive", then squash into
// (0, 1) with a monotonically increasing curve. rank >= 0 (bm25 shouldn't
// produce this, but don't invert into a negative score if it ever does)
// bottoms out at 0.
function bm25ToScore(rank: number): number {
  const goodness = -rank;
  if (goodness <= 0) return 0;
  return goodness / (1 + goodness);
}

// Lowercase, alnum/underscore-run tokenization shared by the FTS query
// builder and the substring-fallback path.
function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .map((t) => t.trim())
    .filter(Boolean);
}

// Build an FTS5 MATCH query from free-text user input. Tokens are
// individually phrase-quoted (so punctuation/operators like AND/OR/NOT/-
// in the raw query can't be reinterpreted as FTS5 syntax) and suffixed
// with `*` for prefix matching. Adjacent quoted tokens are implicitly
// AND-ed by FTS5, which is the useful default for "does this note contain
// all these words" full-text search.
//
// CAVEAT (does not fully deliver "partial word" prefix matching): the
// `notes_fts` table is porter-stemmed, so `*` here is a prefix match
// against *stems*, not surface forms. A complete word like "compress"
// stems to something both "compress" and "compression" share, so that
// case works — but a genuinely partial/mid-typing fragment ("authenticat")
// gets stemmed as-is (porter's rules need real word endings to fire) into
// a token that is often *longer* than the true stem of the finished word,
// so no indexed term can start with it and the query returns zero rows.
// `WikiSearchRepo.search()` retries such zero-result queries against a
// plain substring scan (searchSubstringFallback) specifically to cover
// this case — this function alone does not guarantee partial-word matches.
function buildFtsQuery(raw: string): string | null {
  const tokens = tokenize(raw);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" ");
}

// Cheap keyword-in-context snippet for the substring-fallback path (no
// FTS5 snippet() available here — this isn't querying notes_fts). Finds the
// first matched token in the body and returns a window around it; falls
// back to the start of the body if no token is found there (e.g. the only
// match was in the title/tags/aliases).
function buildFallbackSnippet(body: string, tokens: string[], windowRadius = 80): string {
  const lower = body.toLowerCase();
  let hitAt = -1;
  for (const t of tokens) {
    const idx = lower.indexOf(t);
    if (idx !== -1 && (hitAt === -1 || idx < hitAt)) hitAt = idx;
  }
  if (hitAt === -1) return body.slice(0, windowRadius * 2).trim();
  const start = Math.max(0, hitAt - windowRadius);
  const end = Math.min(body.length, hitAt + windowRadius);
  const prefix = start > 0 ? "… " : "";
  const suffix = end < body.length ? " …" : "";
  return (prefix + body.slice(start, end).trim() + suffix).trim();
}

interface Filters {
  sql: string[];
  params: SqlParam[];
  limit: number;
}

// Shared WHERE-clause + limit builder for both the FTS and substring-scan
// search paths, so `--project/--tag/--category/--since` behave identically
// regardless of which path actually served the results.
function buildFilters(opts: RecallOptions): Filters {
  const sql: string[] = [];
  const params: SqlParam[] = [];

  if (opts.project) {
    sql.push("n.project_slug = ?");
    params.push(opts.project);
  }
  if (opts.category) {
    sql.push("n.category = ?");
    params.push(opts.category);
  }
  if (opts.tag) {
    sql.push("(' ' || n.tags || ' ') LIKE ?");
    params.push(`% ${opts.tag} %`);
  }
  if (opts.since) {
    // updated_at is stored as a normalized ISO string at index time (see
    // core/wiki-search.ts's parseNoteForIndex) specifically so this
    // lexicographic comparison is safe even when the source note's
    // frontmatter `updated:` field was hand-edited (e.g. by Obsidian) into
    // a non-ISO format — the raw frontmatter value never reaches this
    // column unparsed.
    sql.push("n.updated_at >= ?");
    params.push(opts.since);
  }

  const limit = Math.max(1, Math.min(opts.limit ?? 10, 200));
  return { sql, params, limit };
}
