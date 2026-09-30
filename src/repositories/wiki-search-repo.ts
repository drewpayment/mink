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
  /** Where the result came from; set by wide candidate generation only. */
  origin?: "lexical" | "graph";
  /** Judged relevance probability (0..1); unset until a judge fills it. */
  relevance?: number;
}

export type CandidateResult = RecallResult & { origin: "lexical" | "graph" };

export interface CandidateConfig {
  poolSize: number;
  neighbourCap: number;
  /** How many top lexical hits seed graph expansion (default 5). */
  seedCount?: number;
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

export interface JudgmentKey {
  queryNorm: string;
  path: string;
  reprHash: string;
  judgeKey: string;
}

export interface JudgmentEntry extends JudgmentKey {
  relevance: number;
  /** Epoch ms; defaults to now on put. */
  judgedAt?: number;
}

export const JUDGMENT_CACHE_MAX_ROWS = 20_000;
export const JUDGMENT_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Stable map key for a composite judgment key. */
export function judgmentKeyId(k: JudgmentKey): string {
  return JSON.stringify([k.queryNorm, k.path, k.reprHash, k.judgeKey]);
}

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

  // Note bodies for the given vault-relative paths (one IN query per chunk).
  // Paths with no row are absent from the map.
  getBodies(paths: string[]): Map<string, string> {
    const out = new Map<string, string>();
    const unique = [...new Set(paths)];
    const CHUNK = 500; // stays well under SQLite's bound-parameter limit
    for (let i = 0; i < unique.length; i += CHUNK) {
      const chunk = unique.slice(i, i + CHUNK);
      const marks = chunk.map(() => "?").join(", ");
      const rows = this.db
        .prepare(`SELECT path, body FROM notes WHERE path IN (${marks})`)
        .all(...chunk) as unknown as Array<{ path: string; body: string }>;
      for (const r of rows) out.set(r.path, r.body ?? "");
    }
    return out;
  }

  // ── Judgment cache ───────────────────────────────────────────────────────

  /** Batch lookup; the result is keyed by judgmentKeyId(). Misses are absent. */
  getJudgments(keys: JudgmentKey[]): Map<string, number> {
    const out = new Map<string, number>();
    // Group by (query, judge) so each group is one `path IN (...)` query.
    const groups = new Map<string, JudgmentKey[]>();
    for (const k of keys) {
      const g = JSON.stringify([k.queryNorm, k.judgeKey]);
      const list = groups.get(g);
      if (list) list.push(k);
      else groups.set(g, [k]);
    }
    const CHUNK = 400;
    for (const group of groups.values()) {
      for (let i = 0; i < group.length; i += CHUNK) {
        const chunk = group.slice(i, i + CHUNK);
        const marks = chunk.map(() => "?").join(", ");
        const rows = this.db
          .prepare(
            `SELECT query_norm, path, repr_hash, judge_key, relevance FROM judgment_cache
             WHERE query_norm = ? AND judge_key = ? AND path IN (${marks})`
          )
          .all(chunk[0].queryNorm, chunk[0].judgeKey, ...chunk.map((k) => k.path)) as unknown as Array<{
          query_norm: string;
          path: string;
          repr_hash: string;
          judge_key: string;
          relevance: number;
        }>;
        const wanted = new Set(chunk.map(judgmentKeyId));
        for (const r of rows) {
          const id = judgmentKeyId({
            queryNorm: r.query_norm,
            path: r.path,
            reprHash: r.repr_hash,
            judgeKey: r.judge_key,
          });
          if (wanted.has(id)) out.set(id, Number(r.relevance));
        }
      }
    }
    return out;
  }

  /** Upserts all entries in one transaction. */
  putJudgments(entries: JudgmentEntry[]): void {
    if (entries.length === 0) return;
    const now = Date.now();
    this.db.transaction(() => {
      const stmt = this.db.prepare(
        `INSERT INTO judgment_cache (query_norm, path, repr_hash, judge_key, relevance, judged_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(query_norm, path, repr_hash, judge_key) DO UPDATE SET
           relevance = excluded.relevance, judged_at = excluded.judged_at`
      );
      for (const e of entries) {
        stmt.run(e.queryNorm, e.path, e.reprHash, e.judgeKey, e.relevance, e.judgedAt ?? now);
      }
    });
  }

  /** Drops entries older than maxAgeMs, then the oldest rows beyond maxRows. Returns rows deleted. */
  pruneJudgments(opts: { maxRows?: number; maxAgeMs?: number; now?: number } = {}): number {
    const maxRows = opts.maxRows ?? JUDGMENT_CACHE_MAX_ROWS;
    const maxAgeMs = opts.maxAgeMs ?? JUDGMENT_CACHE_MAX_AGE_MS;
    const now = opts.now ?? Date.now();
    let deleted = 0;
    this.db.transaction(() => {
      deleted += Number(
        this.db.prepare("DELETE FROM judgment_cache WHERE judged_at < ?").run(now - maxAgeMs).changes
      );
      const row = this.db.prepare("SELECT COUNT(*) AS n FROM judgment_cache").get() as { n: number } | undefined;
      const excess = Number(row?.n ?? 0) - maxRows;
      if (excess > 0) {
        deleted += Number(
          this.db
            .prepare(
              `DELETE FROM judgment_cache WHERE rowid IN
                 (SELECT rowid FROM judgment_cache ORDER BY judged_at ASC LIMIT ?)`
            )
            .run(excess).changes
        );
      }
    });
    return deleted;
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

  // Wide candidate generation: any-term (OR) FTS over non-stopword tokens,
  // bm25-ordered, up to `poolSize`, plus one-hop graph neighbours of the top
  // `seedCount` lexical hits (both link directions, filters applied in SQL,
  // capped at `neighbourCap`). Falls back to strict search() when the query
  // is all stopwords or the any-term pass finds nothing. Lexical hits come
  // first in bm25 order, then neighbours.
  searchCandidates(query: string, opts: RecallOptions, cfg: CandidateConfig): CandidateResult[] {
    const poolSize = Math.max(1, Math.min(cfg.poolSize, 200));
    const filters = buildFilters({ ...opts, limit: poolSize });

    let lexical: RecallResult[] = [];
    const anyQuery = buildFtsQueryAny(query);
    if (anyQuery !== null) lexical = this.runFts(anyQuery, filters);
    if (lexical.length === 0) lexical = this.search(query, { ...opts, limit: poolSize });

    const pool: CandidateResult[] = lexical.map((r) => ({ ...r, origin: "lexical" as const }));
    if (pool.length === 0) return pool;
    const neighbours = this.graphNeighbours(pool, filters, cfg.seedCount ?? 5, cfg.neighbourCap);
    return [...pool, ...neighbours];
  }

  private graphNeighbours(
    pool: CandidateResult[],
    filters: Filters,
    seedCount: number,
    neighbourCap: number
  ): CandidateResult[] {
    if (neighbourCap <= 0 || seedCount <= 0) return [];
    const seeds = pool.slice(0, seedCount).map((r) => r.path);
    const seedRank = new Map(seeds.map((p, i) => [p, i]));
    const inPool = new Set(pool.map((r) => r.path));
    const marks = seeds.map(() => "?").join(", ");
    const filterSql = filters.sql.length > 0 ? ` AND ${filters.sql.join(" AND ")}` : "";

    type Row = {
      seed: string;
      path: string;
      title: string;
      category: string;
      tags: string;
      updated_at: string;
      body: string;
    };
    const cols = "n.path AS path, n.title AS title, n.category AS category, n.tags AS tags, n.updated_at AS updated_at, n.body AS body";
    let rows: Row[];
    try {
      const out = this.db
        .prepare(
          `SELECT l.source_path AS seed, ${cols}
           FROM links l JOIN notes n ON n.path = l.resolved_path
           WHERE l.source_path IN (${marks}) AND l.resolved_path IS NOT NULL${filterSql}`
        )
        .all(...seeds, ...filters.params) as unknown as Row[];
      const back = this.db
        .prepare(
          `SELECT l.resolved_path AS seed, ${cols}
           FROM links l JOIN notes n ON n.path = l.source_path
           WHERE l.resolved_path IN (${marks})${filterSql}`
        )
        .all(...seeds, ...filters.params) as unknown as Row[];
      rows = [...out, ...back];
    } catch {
      return [];
    }

    const agg = new Map<string, { row: Row; seeds: Set<string>; best: number }>();
    for (const r of rows) {
      if (inPool.has(r.path)) continue;
      const rank = seedRank.get(r.seed) ?? Number.MAX_SAFE_INTEGER;
      const cur = agg.get(r.path);
      if (cur) {
        cur.seeds.add(r.seed);
        cur.best = Math.min(cur.best, rank);
      } else {
        agg.set(r.path, { row: r, seeds: new Set([r.seed]), best: rank });
      }
    }

    return [...agg.values()]
      .sort((a, b) => b.seeds.size - a.seeds.size || a.best - b.best || (a.row.path < b.row.path ? -1 : 1))
      .slice(0, neighbourCap)
      .map(({ row }) => ({
        path: row.path,
        title: row.title,
        snippet: buildFallbackSnippet(row.body, []),
        score: 0,
        tags: (row.tags ?? "").split(" ").filter(Boolean),
        category: row.category,
        updated: row.updated_at,
        origin: "graph" as const,
      }));
  }

  private searchFts(query: string, filters: Filters): RecallResult[] {
    const ftsQuery = buildFtsQuery(query);
    if (ftsQuery === null) return [];
    return this.runFts(ftsQuery, filters);
  }

  private runFts(ftsQuery: string, filters: Filters): RecallResult[] {
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

// Function/question words with no retrieval signal. Only used to widen
// (any-term) queries; strict search keeps every token. Deliberately modest:
// no domain words, and nothing like "not", "api", "find" or "use".
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being", "am",
  "do", "does", "did", "how", "what", "when", "where", "who", "whom", "why", "which",
  "we", "our", "ours", "us", "i", "me", "my", "you", "your", "he", "she", "they", "them", "their",
  "it", "its", "of", "for", "to", "in", "on", "at", "by", "and", "or", "with", "from", "about",
  "there", "here", "this", "that", "these", "those", "can", "could", "should", "would", "will",
  "any", "have", "has", "had", "as", "into", "if", "so", "than", "then",
  // contraction stems left behind by tokenize() ("don't" -> "don", "t")
  "don", "doesn", "didn", "isn", "aren", "wasn", "weren",
]);

// Query tokens that carry retrieval signal: lowercase letter/number runs
// with single characters and stopwords dropped. Shared by the any-term FTS
// builder and the reranker's excerpt windowing so both agree on "the words
// that matter".
export function significantQueryTokens(raw: string): string[] {
  return tokenize(raw).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Any-term (OR) variant of buildFtsQuery for wide candidate generation:
// same tokenization and quoting/prefix, stopwords dropped, OR-joined.
// Single-character tokens are dropped too: tokenize() splits contractions
// ("what's" -> "what", "s"), and a lone `"s"*` prefix OR-term matches nearly
// every note, flooding the pool. Returns null when no significant token
// remains (caller falls back to strict mode).
export function buildFtsQueryAny(raw: string): string | null {
  const tokens = significantQueryTokens(raw);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(" OR ");
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
