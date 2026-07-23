// Orchestration layer for the wiki full-text search index: parses notes off
// disk into WikiSearchRepo rows, resolves wikilinks into the links table,
// and exposes the operations the CLI/dashboard need (`mink recall`,
// `mink wiki backlinks/related`, `mink wiki reindex`). SQL lives in
// repositories/wiki-search-repo.ts; this file is markdown parsing + the
// wikilink resolution heuristics.

import { readFileSync, statSync } from "fs";
import { join } from "path";
import { resolveVaultPath } from "./vault";
import { parseFrontmatter } from "./frontmatter";
import {
  extractNoteTitle,
  extractNoteTags,
  extractNoteCategory,
  extractNoteAliases,
  estimateTokens,
  collectAllMarkdown,
  type ScannedMarkdown,
} from "./note-index";
import { extractWikilinks } from "./note-linker";
import {
  WikiSearchRepo,
  type RecallOptions,
  type RecallResult,
  type NoteRef,
  type RelatedResult,
  type WikiSearchNoteInput,
} from "../repositories/wiki-search-repo";
import { resetCorruptWikiSearchDb } from "../storage/wiki-search-db";

// ── Parsing ──────────────────────────────────────────────────────────────

function deriveProjectSlug(relPath: string, frontmatter: Record<string, unknown>): string | null {
  if (typeof frontmatter.source_project === "string" && frontmatter.source_project.trim()) {
    return frontmatter.source_project.trim();
  }
  const m = relPath.match(/^projects\/([^/]+)\//);
  return m ? m[1] : null;
}

// `--since` filters with a plain lexicographic string comparison on
// updated_at (wiki-search-repo.ts's buildFilters), which only sorts
// correctly for canonical ISO-8601 strings. frontmatter.updated is
// normally exactly that (note-writer.ts always writes ISO), but a vault is
// user-owned markdown — an Obsidian user can hand-edit `updated:` into
// `2026-01-15`, `01/15/2026`, or anything else. Parse it and re-emit as
// ISO; only trust it when it actually parses as a date, otherwise fall
// back to the file's mtime (which is always a real timestamp).
function normalizeUpdatedAt(raw: unknown, mtimeMs: number): string {
  if (typeof raw === "string" && raw.trim()) {
    const parsed = new Date(raw.trim());
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date(mtimeMs).toISOString();
}

function parseNoteForIndex(
  relPath: string,
  content: string,
  mtimeMs: number
): WikiSearchNoteInput {
  const title = extractNoteTitle(content);
  const tags = extractNoteTags(content);
  const category = extractNoteCategory(content);
  const aliases = extractNoteAliases(content);
  const { frontmatter, body } = parseFrontmatter(content);
  const projectSlug = deriveProjectSlug(relPath, frontmatter);
  const updatedAt = normalizeUpdatedAt(frontmatter.updated, mtimeMs);

  return {
    path: relPath,
    title,
    category,
    projectSlug,
    tags,
    aliases,
    frontmatter,
    body,
    mtimeMs,
    updatedAt,
    estimatedTokens: estimateTokens(content),
  };
}

// ── Wikilink resolution ─────────────────────────────────────────────────
// Resolves a raw `[[target]]` string to a vault-relative note path using the
// currently-indexed note set: exact path, then unambiguous title/alias
// match, then unambiguous basename (slug) match. Ambiguous or unmatched
// targets resolve to null — Phase 0's `mink wiki doctor` and write-time
// hygiene (note-linker.ts) are what keep ambiguity rare, not this resolver.

interface ResolutionMaps {
  byPath: Map<string, string>;
  byTitleOrAlias: Map<string, string[]>;
  byBasename: Map<string, string[]>;
}

function pushMulti(map: Map<string, string[]>, key: string, value: string): void {
  // Dedupe by path: a note whose auto-added alias equals its own title (the
  // common case — note-writer.ts declares `aliases: [<Title>]`) would
  // otherwise push the same path twice under the same lowercased key,
  // making resolveTarget()'s "length === 1 => unambiguous" check see a
  // false ambiguity for a note that's actually the single, obvious match.
  const list = map.get(key);
  if (list) {
    if (!list.includes(value)) list.push(value);
  } else {
    map.set(key, [value]);
  }
}

function basenameNoExt(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "");
}

function buildResolutionMaps(entries: Array<{ path: string; title: string; aliases: string[] }>): ResolutionMaps {
  const byPath = new Map<string, string>();
  const byTitleOrAlias = new Map<string, string[]>();
  const byBasename = new Map<string, string[]>();

  for (const e of entries) {
    byPath.set(e.path.toLowerCase(), e.path);
    byPath.set(e.path.replace(/\.md$/i, "").toLowerCase(), e.path);
    pushMulti(byTitleOrAlias, e.title.toLowerCase(), e.path);
    for (const alias of e.aliases) pushMulti(byTitleOrAlias, alias.toLowerCase(), e.path);
    pushMulti(byBasename, basenameNoExt(e.path).toLowerCase(), e.path);
  }

  return { byPath, byTitleOrAlias, byBasename };
}

function resolveTarget(target: string, maps: ResolutionMaps): string | null {
  const lower = target.trim().toLowerCase();
  if (!lower) return null;

  const pathHit = maps.byPath.get(lower);
  if (pathHit) return pathHit;

  const titleHits = maps.byTitleOrAlias.get(lower);
  if (titleHits) return titleHits.length === 1 ? titleHits[0] : null;

  const baseHits = maps.byBasename.get(lower);
  if (baseHits) return baseHits.length === 1 ? baseHits[0] : null;

  return null;
}

function resolveOutlinks(content: string, maps: ResolutionMaps): Array<{ target: string; resolvedPath: string | null }> {
  return extractWikilinks(content).map((target) => ({ target, resolvedPath: resolveTarget(target, maps) }));
}

// Two kinds of vault markdown are structurally not "content" and must not
// be indexed for recall/graph queries:
//
// 1. Underscore-prefixed files (currently just the auto-generated
//    `_index.md` master index — see note-linker.ts's updateMasterIndex) are
//    navigation/meta pages: `_index.md` links every note title in the
//    vault, so it would trivially full-text-match almost any query and
//    drown out real results. note-linker.ts already treats "starts with _"
//    as "not a real note" when building that same index — mirror the
//    convention here.
// 2. The top-level `templates/` directory (vaultTemplates() in vault.ts) —
//    boilerplate seeded by `mink wiki init` (vault-templates.ts), not
//    knowledge. Proven: a query for "compression" surfaced
//    templates/note.md as the #1 hit purely because the template's own
//    placeholder prose happened to contain the word.
//
// `patterns/` is deliberately NOT excluded — per spec 15 it's meant to hold
// real cross-project knowledge, not boilerplate.
const EXCLUDED_TOP_LEVEL_DIRS = new Set(["templates"]);

function isIndexableNote(relPath: string): boolean {
  const segments = relPath.split("/");
  const base = segments[segments.length - 1] ?? relPath;
  if (base.startsWith("_")) return false;
  if (segments.length > 1 && EXCLUDED_TOP_LEVEL_DIRS.has(segments[0])) return false;
  return true;
}

// ── Path helpers ─────────────────────────────────────────────────────────

function toRelative(root: string, absOrRel: string): string {
  if (absOrRel.startsWith(root + "/")) return absOrRel.slice(root.length + 1);
  if (absOrRel === root) return "";
  return absOrRel;
}

function toAbsolute(root: string, relPath: string): string {
  return join(root, relPath);
}

// ── Public indexing API ─────────────────────────────────────────────────

// Index a single note after a write (create/edit). Accepts either an
// absolute or vault-relative path; reads content from disk when not
// supplied. Safe to call even if the file was just deleted (no-ops).
export function indexNoteFile(pathOrAbs: string, content?: string): void {
  const root = resolveVaultPath();
  const relPath = toRelative(root, pathOrAbs);
  if (!isIndexableNote(relPath)) return;
  const absPath = pathOrAbs.startsWith(root) ? pathOrAbs : toAbsolute(root, relPath);

  let text = content;
  let mtimeMs: number;
  try {
    if (text === undefined) text = readFileSync(absPath, "utf-8");
    mtimeMs = statSync(absPath).mtimeMs;
  } catch {
    return;
  }

  const repo = WikiSearchRepo.forVault();
  const entry = parseNoteForIndex(relPath, text, mtimeMs);
  repo.upsertNote(entry);
  repo.backfillUnresolvedLinks(entry.path, entry.title, entry.aliases);

  const maps = buildResolutionMaps(repo.listTitlesAndAliases());
  repo.replaceLinksForSource(relPath, resolveOutlinks(text, maps));
}

export function removeNoteFromIndex(pathOrAbs: string): void {
  const root = resolveVaultPath();
  const relPath = toRelative(root, pathOrAbs);
  WikiSearchRepo.forVault().deleteNote(relPath);
}

// Full rebuild: wipe and reparse every markdown file in the vault, then
// resolve every note's outgoing links in a second pass (needed since
// resolution depends on the *complete* note set, not just the one file
// being indexed). Idempotent — safe to run repeatedly.
export function reindexVault(): { indexed: number } {
  const root = resolveVaultPath();
  let repo: WikiSearchRepo;
  try {
    repo = WikiSearchRepo.forVault();
    repo.wipeAll();
  } catch {
    // The database itself is unreadable (corrupted file, disk error, schema
    // from an incompatible future version...). Since rebuilding from
    // scratch is this command's entire job, recover by starting over on a
    // fresh file rather than failing outright.
    resetCorruptWikiSearchDb();
    repo = WikiSearchRepo.forVault();
  }

  const files = collectAllMarkdown(root).filter((f) => isIndexableNote(f.relativePath));
  const parsed: Array<{ file: ScannedMarkdown; content: string }> = [];
  for (const file of files) {
    try {
      const content = readFileSync(file.absolutePath, "utf-8");
      repo.upsertNote(parseNoteForIndex(file.relativePath, content, file.mtimeMs));
      parsed.push({ file, content });
    } catch {
      // skip unreadable file
    }
  }

  const maps = buildResolutionMaps(repo.listTitlesAndAliases());
  for (const { file, content } of parsed) {
    repo.replaceLinksForSource(file.relativePath, resolveOutlinks(content, maps));
  }

  markCaughtUp();
  return { indexed: parsed.length };
}

// ── mtime catch-up sweep ─────────────────────────────────────────────────
// Compares on-disk mtimes against the index and reindexes what changed —
// how external edits (Obsidian, git pull/sync) get picked up without a
// manual `mink wiki reindex`. Throttled so long-lived processes (dashboard)
// don't re-walk the vault on every single call, while short-lived CLI
// invocations still always get one fresh sweep.

const CATCH_UP_THROTTLE_MS = 2_000;
let lastCatchUpAt = 0;

function markCaughtUp(): void {
  lastCatchUpAt = Date.now();
}

// Test-only — clears the throttle so each test gets a real sweep regardless
// of wall-clock timing between tests.
export function resetWikiSearchRuntimeForTests(): void {
  lastCatchUpAt = 0;
}

export function catchUpIndex(opts: { force?: boolean } = {}): { updated: number; removed: number } {
  const now = Date.now();
  if (!opts.force && now - lastCatchUpAt < CATCH_UP_THROTTLE_MS) {
    return { updated: 0, removed: 0 };
  }
  lastCatchUpAt = now;

  const root = resolveVaultPath();
  const repo = WikiSearchRepo.forVault();
  const onDisk = collectAllMarkdown(root).filter((f) => isIndexableNote(f.relativePath));
  const onDiskPaths = new Set(onDisk.map((f) => f.relativePath));
  const indexedMtimes = new Map(repo.listAllPaths().map((e) => [e.path, e.mtimeMs]));

  let removed = 0;
  for (const path of indexedMtimes.keys()) {
    if (!onDiskPaths.has(path)) {
      repo.deleteNote(path);
      removed++;
    }
  }

  const changed = onDisk.filter((f) => indexedMtimes.get(f.relativePath) !== f.mtimeMs);
  const changedWithContent: Array<{ file: ScannedMarkdown; content: string }> = [];
  for (const file of changed) {
    try {
      const content = readFileSync(file.absolutePath, "utf-8");
      const entry = parseNoteForIndex(file.relativePath, content, file.mtimeMs);
      repo.upsertNote(entry);
      repo.backfillUnresolvedLinks(entry.path, entry.title, entry.aliases);
      changedWithContent.push({ file, content });
    } catch {
      // skip unreadable file — leave any prior index entry as-is
    }
  }

  if (changedWithContent.length > 0) {
    const maps = buildResolutionMaps(repo.listTitlesAndAliases());
    for (const { file, content } of changedWithContent) {
      repo.replaceLinksForSource(file.relativePath, resolveOutlinks(content, maps));
    }
  }

  return { updated: changedWithContent.length, removed };
}

// ── Corruption recovery ──────────────────────────────────────────────────
// The search index is pure derived state — every row is reconstructible
// from the vault's own markdown — so a corrupted .mink-search.db (bad disk
// state, a truncated write, a schema from an incompatible future version…)
// should never be a hard failure for the reader. If a query throws, attempt
// exactly one recovery: blow away the database and rebuild it, then retry.
// If the retry also throws, surface one clean, actionable Error rather than
// letting a raw SQLite stack trace reach the CLI/dashboard — callers at the
// command layer catch this and print/exit cleanly instead of crashing.
function withCorruptionRecovery<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    try {
      resetCorruptWikiSearchDb();
      reindexVault();
      return fn();
    } catch (retryErr) {
      const detail = retryErr instanceof Error ? retryErr.message : String(retryErr);
      throw new Error(
        `wiki search index is corrupted and could not be rebuilt automatically (${detail}). Try 'mink wiki reindex' manually.`
      );
    }
  }
}

// ── Query API ────────────────────────────────────────────────────────────

export function recall(query: string, opts: RecallOptions = {}): RecallResult[] {
  return withCorruptionRecovery(() => {
    catchUpIndex();
    return WikiSearchRepo.forVault().search(query, opts);
  });
}

// Resolve a CLI-supplied note reference (path or title) to a vault-relative
// path, running a catch-up sweep first so recently-created notes (including
// ones from the same command invocation) are resolvable.
export function resolveNoteArg(arg: string): string | null {
  return withCorruptionRecovery(() => {
    catchUpIndex();
    return WikiSearchRepo.forVault().resolveNoteArg(arg);
  });
}

export function backlinksForNote(path: string): NoteRef[] {
  return withCorruptionRecovery(() => {
    catchUpIndex();
    return WikiSearchRepo.forVault().backlinksFor(path);
  });
}

export function relatedForNote(path: string, limit = 20): RelatedResult[] {
  return withCorruptionRecovery(() => {
    catchUpIndex();
    return WikiSearchRepo.forVault().relatedFor(path, limit);
  });
}

export function wikiSearchNoteCount(): number {
  return WikiSearchRepo.forVault().count();
}
