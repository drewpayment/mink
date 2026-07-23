// mink wiki doctor — read-only audit + optional repair of vault link hygiene
// and test pollution (spec: docs/plans/2026-07-agent-retrieval-and-chat.md,
// Phase 0). Never hard-deletes: everything the fixer touches gets moved into
// a dated quarantine directory instead.
//
// Design notes:
// - Link resolution mirrors what Obsidian actually does: a bare `[[name]]`
//   resolves by filename stem or a declared `aliases:` entry — NOT by H1
//   title. That's precisely why untitled/undeclared notes show up as
//   "broken" even though a human reading the title would know what it means.
// - All scans exclude `templates/` (placeholder `{{title}}` frontmatter,
//   not real notes) and `archives/_doctor/` (the doctor's own quarantine
//   subtree — re-scanning it would make every fix look non-idempotent).

import { basename, dirname, join } from "path";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  type Dirent,
} from "fs";
import { minkRoot } from "./paths";
import { resolveVaultPath } from "./vault";
import { atomicWriteText } from "./fs-utils";
import {
  collectAllMarkdown,
  extractNoteAliases,
  extractNoteTitle,
  rebuildVaultIndex,
} from "./note-index";
import { updateMasterIndex } from "./note-linker";
import { upsertFrontmatterAliases } from "./note-writer";

// ── Pollution patterns (pinned — see task contract) ─────────────────────

const POLLUTION_WIKI_DIR_PATTERNS: RegExp[] = [
  /^mink-init-test-/,
  /^mink-refresh-cwd-/,
  /^mink-targets-cwd-/,
];

const POLLUTION_WIKI_NOTE_PATTERNS: RegExp[] = [
  /^hello-world-/,
  /^sync-/,
  /^note-\d+$/,
  /^test-note-/,
];

const POLLUTION_MINK_ROOT_DIR_PATTERNS: RegExp[] = [/^mink-dash-integ-/];

const EXCLUDED_PREFIXES = ["archives/_doctor/", "templates/"];

function isExcluded(relativePath: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => relativePath.startsWith(p));
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD, UTC
}

// ── Note records ─────────────────────────────────────────────────────────

export interface NoteRecord {
  relativePath: string; // e.g. "projects/foo/overview.md"
  absolutePath: string;
  stem: string; // filename without ".md"
  title: string;
  aliases: string[];
  content: string;
}

function loadAllNotes(root: string): NoteRecord[] {
  const files = collectAllMarkdown(root).filter(
    (f) => !isExcluded(f.relativePath) && !basename(f.relativePath).startsWith("_")
  );
  const notes: NoteRecord[] = [];
  for (const f of files) {
    let content: string;
    try {
      content = readFileSync(f.absolutePath, "utf-8");
    } catch {
      continue;
    }
    notes.push({
      relativePath: f.relativePath,
      absolutePath: f.absolutePath,
      stem: basename(f.relativePath).replace(/\.md$/, ""),
      title: extractNoteTitle(content),
      aliases: extractNoteAliases(content),
      content,
    });
  }
  return notes;
}

// ── Link resolution ──────────────────────────────────────────────────────

const WIKILINK_OCCURRENCE_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export interface LinkOccurrence {
  file: string; // relativePath of the note containing the link
  raw: string; // full match text, e.g. "[[Global Catalog]]"
  target: string; // the part before "|"
  display?: string; // the part after "|", if present
  candidates: string[]; // relativePaths this bare/qualified target resolves to
}

function extractLinkOccurrences(note: NoteRecord): LinkOccurrence[] {
  const occurrences: LinkOccurrence[] = [];
  const re = new RegExp(WIKILINK_OCCURRENCE_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(note.content)) !== null) {
    occurrences.push({
      file: note.relativePath,
      raw: m[0],
      target: m[1].trim(),
      display: m[2]?.trim(),
      candidates: [],
    });
  }
  return occurrences;
}

function buildNameIndex(notes: NoteRecord[]): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  const add = (name: string, path: string) => {
    const key = name.toLowerCase();
    if (!idx.has(key)) idx.set(key, new Set());
    idx.get(key)!.add(path);
  };
  for (const n of notes) {
    add(n.stem, n.relativePath);
    for (const a of n.aliases) add(a, n.relativePath);
  }
  return idx;
}

function resolveLinkTarget(
  rawTarget: string,
  nameIndex: Map<string, Set<string>>,
  notePathSet: Set<string>
): string[] {
  let target = rawTarget.trim().replace(/^\.\//, "");
  if (target.includes("/")) {
    const withExt = target.endsWith(".md") ? target : `${target}.md`;
    return notePathSet.has(withExt) ? [withExt] : [];
  }
  const key = (target.endsWith(".md") ? target.slice(0, -3) : target).toLowerCase();
  const set = nameIndex.get(key);
  return set ? [...set] : [];
}

export interface LinkHealth {
  totalNotes: number;
  totalLinks: number;
  resolved: number;
  broken: number;
  ambiguous: number;
  orphans: number;
}

interface LinkAnalysis {
  occurrences: LinkOccurrence[];
  health: LinkHealth;
  orphanPaths: string[];
}

function analyzeLinks(notes: NoteRecord[]): LinkAnalysis {
  const nameIndex = buildNameIndex(notes);
  const notePathSet = new Set(notes.map((n) => n.relativePath));
  const inbound = new Set<string>();
  const occurrences: LinkOccurrence[] = [];
  let resolved = 0;
  let broken = 0;
  let ambiguous = 0;

  for (const note of notes) {
    for (const occ of extractLinkOccurrences(note)) {
      occ.candidates = resolveLinkTarget(occ.target, nameIndex, notePathSet);
      occurrences.push(occ);
      if (occ.candidates.length === 1) {
        resolved++;
        inbound.add(occ.candidates[0]);
      } else if (occ.candidates.length === 0) {
        broken++;
      } else {
        ambiguous++;
        for (const c of occ.candidates) inbound.add(c);
      }
    }
  }

  const orphanPaths = notes
    .map((n) => n.relativePath)
    .filter((p) => !inbound.has(p));

  return {
    occurrences,
    orphanPaths,
    health: {
      totalNotes: notes.length,
      totalLinks: occurrences.length,
      resolved,
      broken,
      ambiguous,
      orphans: orphanPaths.length,
    },
  };
}

// ── Ambiguous basenames ──────────────────────────────────────────────────

function findAmbiguousBasenames(notes: NoteRecord[]): Record<string, string[]> {
  const byBasename = new Map<string, string[]>();
  for (const n of notes) {
    const base = basename(n.relativePath);
    if (!byBasename.has(base)) byBasename.set(base, []);
    byBasename.get(base)!.push(n.relativePath);
  }
  const result: Record<string, string[]> = {};
  for (const [base, paths] of byBasename) {
    if (paths.length > 1) result[base] = paths.sort();
  }
  return result;
}

// ── Alias coverage ────────────────────────────────────────────────────────

export interface AliasCandidate {
  relativePath: string;
  title: string;
  slug: string;
}

// A wikilink resolves against a note's stem via a case-insensitive *literal*
// string match (see resolveLinkTarget) — Obsidian doesn't fold spaces to
// hyphens the way slugifyTitle does. So "needs an alias" has to compare the
// literal title text to the literal stem, not their slugified forms: a note
// titled "Global Catalog" living at global-catalog.md needs an alias even
// though slugifyTitle("Global Catalog") === "global-catalog" — the bare link
// people actually write, `[[Global Catalog]]`, still won't match the stem.
function needsAlias(note: NoteRecord): boolean {
  return note.aliases.length === 0 && note.title.toLowerCase() !== note.stem.toLowerCase();
}

function findAliasCandidates(notes: NoteRecord[]): AliasCandidate[] {
  return notes
    .filter(needsAlias)
    .map((n) => ({ relativePath: n.relativePath, title: n.title, slug: n.stem }));
}

// ── Daily notes ───────────────────────────────────────────────────────────

const ISO_DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MDY_DAILY_RE = /^(\d{2})[-_](\d{2})[-_](\d{4})$/; // MM-DD-YYYY or MM_DD_YYYY
const YMD_UNDERSCORE_RE = /^(\d{4})_(\d{2})_(\d{2})$/; // YYYY_MM_DD

export interface DailyIssue {
  relativePath: string;
  stem: string;
  renameTo: string | null; // ISO stem if parseable, else null (report-only)
}

function isPlausibleDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  if (y < 1970 || y > 2100) return false;
  return true;
}

export function parseDailyStem(stem: string): string | null {
  if (ISO_DAILY_RE.test(stem)) return stem; // already canonical
  const mdy = stem.match(MDY_DAILY_RE);
  if (mdy) {
    const [, mo, d, y] = mdy;
    if (isPlausibleDate(Number(y), Number(mo), Number(d))) {
      return `${y}-${mo}-${d}`;
    }
  }
  const ymd = stem.match(YMD_UNDERSCORE_RE);
  if (ymd) {
    const [, y, mo, d] = ymd;
    if (isPlausibleDate(Number(y), Number(mo), Number(d))) {
      return `${y}-${mo}-${d}`;
    }
  }
  return null;
}

function findDailyIssues(notes: NoteRecord[]): DailyIssue[] {
  const issues: DailyIssue[] = [];
  for (const n of notes) {
    if (!n.relativePath.startsWith("areas/daily/")) continue;
    if (ISO_DAILY_RE.test(n.stem)) continue; // already canonical
    issues.push({
      relativePath: n.relativePath,
      stem: n.stem,
      renameTo: parseDailyStem(n.stem),
    });
  }
  return issues;
}

// ── Broken symlinks (vault top level) ────────────────────────────────────

function findBrokenSymlinks(root: string): string[] {
  const broken: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return broken;
  }
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    const full = join(root, entry.name);
    try {
      statSync(full); // follows the link; throws if the target is missing
    } catch {
      broken.push(entry.name);
    }
  }
  return broken;
}

// ── Test pollution ────────────────────────────────────────────────────────

export interface PollutionCandidate {
  relativePath: string; // relative to vault root (wiki) or "projects/<dir>" (mink root)
  kind: "wiki-dir" | "wiki-note" | "mink-root-dir";
}

function findWikiPollution(root: string): PollutionCandidate[] {
  const found: PollutionCandidate[] = [];
  const seenDirs = new Set<string>();

  function walk(dir: string, relDir: string) {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (isExcluded(relPath) || isExcluded(relPath + "/")) continue;
      if (entry.name.startsWith(".")) continue;

      if (entry.isDirectory()) {
        if (
          POLLUTION_WIKI_DIR_PATTERNS.some((re) => re.test(entry.name)) &&
          !seenDirs.has(relPath)
        ) {
          seenDirs.add(relPath);
          found.push({ relativePath: relPath, kind: "wiki-dir" });
          continue; // don't descend into a dir we're about to quarantine whole
        }
        walk(join(dir, entry.name), relPath);
      } else if (entry.name.endsWith(".md")) {
        const stem = entry.name.replace(/\.md$/, "");
        if (POLLUTION_WIKI_NOTE_PATTERNS.some((re) => re.test(stem))) {
          found.push({ relativePath: relPath, kind: "wiki-note" });
        }
      }
    }
  }

  walk(root, "");
  return found;
}

function findMinkRootPollution(root: string): PollutionCandidate[] {
  const projectsDir = join(root, "projects");
  if (!existsSync(projectsDir)) return [];
  let entries: Dirent[];
  try {
    entries = readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: PollutionCandidate[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (POLLUTION_MINK_ROOT_DIR_PATTERNS.some((re) => re.test(entry.name))) {
      found.push({ relativePath: entry.name, kind: "mink-root-dir" });
    }
  }
  return found;
}

// ── Audit report ──────────────────────────────────────────────────────────

export interface DoctorReport {
  vaultRoot: string;
  minkRoot: string;
  totalNotes: number;
  linkHealth: LinkHealth;
  brokenLinks: Array<{ file: string; target: string }>;
  ambiguousLinks: Array<{ file: string; target: string; candidates: string[] }>;
  orphanNotes: string[];
  testPollution: {
    wiki: PollutionCandidate[];
    minkRoot: PollutionCandidate[];
  };
  aliasCandidates: AliasCandidate[];
  ambiguousBasenames: Record<string, string[]>;
  dailyIssues: DailyIssue[];
  brokenSymlinks: string[];
}

export function auditVault(): DoctorReport {
  const root = resolveVaultPath();
  const mroot = minkRoot();
  const notes = loadAllNotes(root);
  const analysis = analyzeLinks(notes);

  return {
    vaultRoot: root,
    minkRoot: mroot,
    totalNotes: notes.length,
    linkHealth: analysis.health,
    brokenLinks: analysis.occurrences
      .filter((o) => o.candidates.length === 0)
      .map((o) => ({ file: o.file, target: o.target })),
    ambiguousLinks: analysis.occurrences
      .filter((o) => o.candidates.length > 1)
      .map((o) => ({ file: o.file, target: o.target, candidates: o.candidates })),
    orphanNotes: analysis.orphanPaths,
    testPollution: {
      wiki: findWikiPollution(root),
      minkRoot: findMinkRootPollution(mroot),
    },
    aliasCandidates: findAliasCandidates(notes),
    ambiguousBasenames: findAmbiguousBasenames(notes),
    dailyIssues: findDailyIssues(notes),
    brokenSymlinks: findBrokenSymlinks(root),
  };
}

// ── Fix application ──────────────────────────────────────────────────────

export interface DoctorFixResult {
  dryRun: boolean;
  quarantinedWikiItems: Array<{ from: string; to: string }>;
  quarantinedMinkRootDirs: Array<{ from: string; to: string }>;
  aliasesAdded: Array<{ file: string; aliases: string[] }>;
  linksQualified: Array<{ file: string; before: string; after: string }>;
  unresolvableAmbiguousLinks: Array<{ file: string; target: string; candidates: string[] }>;
  dailiesRenamed: Array<{ from: string; to: string }>;
  dailiesUnparsed: string[];
  brokenSymlinksQuarantined: string[];
  linkHealthBefore: LinkHealth;
  linkHealthAfter: LinkHealth;
}

// Moves a file or directory into quarantine. Uses copy+remove rather than
// rename(2) so a quarantine target on a different filesystem/device never
// throws EXDEV mid-batch (see commit 85d719f — the update command hit the
// same class of bug with cross-device project paths).
function moveToQuarantine(from: string, to: string, dryRun: boolean): void {
  if (dryRun) return;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true });
  rmSync(from, { recursive: true, force: true });
}

function quarantineWikiPollution(
  report: DoctorReport,
  dryRun: boolean
): Array<{ from: string; to: string }> {
  const date = todayStamp();
  const moved: Array<{ from: string; to: string }> = [];
  for (const item of report.testPollution.wiki) {
    const from = join(report.vaultRoot, item.relativePath);
    const to = join(report.vaultRoot, "archives", "_doctor", date, item.relativePath);
    moveToQuarantine(from, to, dryRun);
    moved.push({ from: item.relativePath, to: `archives/_doctor/${date}/${item.relativePath}` });
  }
  return moved;
}

function quarantineMinkRootPollution(
  report: DoctorReport,
  dryRun: boolean
): Array<{ from: string; to: string }> {
  const date = todayStamp();
  const moved: Array<{ from: string; to: string }> = [];
  for (const item of report.testPollution.minkRoot) {
    const from = join(report.minkRoot, "projects", item.relativePath);
    const to = join(report.minkRoot, ".doctor-quarantine", date, item.relativePath);
    moveToQuarantine(from, to, dryRun);
    moved.push({ from: `projects/${item.relativePath}`, to: `.doctor-quarantine/${date}/${item.relativePath}` });
  }
  return moved;
}

function isUnderQuarantinedPath(relativePath: string, quarantined: Set<string>): boolean {
  if (quarantined.has(relativePath)) return true;
  for (const q of quarantined) {
    if (relativePath.startsWith(q + "/")) return true;
  }
  return false;
}

function backfillAliases(
  notes: NoteRecord[],
  dryRun: boolean
): Array<{ file: string; aliases: string[] }> {
  const added: Array<{ file: string; aliases: string[] }> = [];
  for (const note of notes) {
    if (!needsAlias(note)) continue;
    const newAliases = [note.title];
    const updated = upsertFrontmatterAliases(note.content, newAliases);
    if (updated === note.content) continue; // no frontmatter to touch — skip
    note.content = updated;
    note.aliases = [...note.aliases, ...newAliases];
    if (!dryRun) atomicWriteText(note.absolutePath, updated);
    added.push({ file: note.relativePath, aliases: newAliases });
  }
  return added;
}

function projectDirOf(relativePath: string): string | null {
  const parts = relativePath.split("/");
  if (parts[0] === "projects" && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return null;
}

function qualifyAmbiguousLinks(
  notes: NoteRecord[],
  dryRun: boolean
): {
  qualified: Array<{ file: string; before: string; after: string }>;
  unresolvable: Array<{ file: string; target: string; candidates: string[] }>;
} {
  const qualified: Array<{ file: string; before: string; after: string }> = [];
  const unresolvable: Array<{ file: string; target: string; candidates: string[] }> = [];
  const nameIndex = buildNameIndex(notes);
  const notePathSet = new Set(notes.map((n) => n.relativePath));

  for (const note of notes) {
    let content = note.content;
    let changed = false;
    const re = new RegExp(WIKILINK_OCCURRENCE_RE.source, "g");
    const seenTargets = new Set<string>(); // avoid re-processing the same bare target twice per file
    let m: RegExpExecArray | null;
    const replacements: Array<{ raw: string; replacement: string }> = [];

    while ((m = re.exec(note.content)) !== null) {
      const raw = m[0];
      const target = m[1].trim();
      const display = m[2]?.trim();
      if (target.includes("/")) continue; // already path-qualified
      if (seenTargets.has(target)) continue;

      const candidates = resolveLinkTarget(target, nameIndex, notePathSet);
      if (candidates.length <= 1) continue; // not ambiguous

      seenTargets.add(target);
      const ownProjectDir = projectDirOf(note.relativePath);
      const sameProjectCandidates = ownProjectDir
        ? candidates.filter((c) => c.startsWith(ownProjectDir + "/"))
        : [];

      if (sameProjectCandidates.length === 1) {
        const best = sameProjectCandidates[0].replace(/\.md$/, "");
        const displayText = display ?? target;
        const replacement = `[[${best}|${displayText}]]`;
        replacements.push({ raw, replacement });
      } else {
        unresolvable.push({ file: note.relativePath, target, candidates });
      }
    }

    for (const { raw, replacement } of replacements) {
      if (content.includes(raw)) {
        content = content.split(raw).join(replacement);
        changed = true;
        qualified.push({ file: note.relativePath, before: raw, after: replacement });
      }
    }

    if (changed) {
      note.content = content;
      if (!dryRun) atomicWriteText(note.absolutePath, content);
    }
  }

  return { qualified, unresolvable };
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renameWikilinkTargets(content: string, oldStem: string, newStem: string): string {
  // Only rewrite the target portion of a link, and only when it refers to the
  // renamed daily by bare stem or as a path ending in the old stem — leaves
  // display text (`|...`) untouched.
  const re = /\[\[([^\]|]+)(\|[^\]]+)?\]\]/g;
  return content.replace(re, (raw, target: string, displayPart = "") => {
    const trimmed = target.trim();
    const bare = trimmed.endsWith(".md") ? trimmed.slice(0, -3) : trimmed;
    if (bare === oldStem) {
      return `[[${newStem}${displayPart}]]`;
    }
    if (bare.endsWith(`/${oldStem}`)) {
      const newTarget = bare.slice(0, -oldStem.length) + newStem;
      return `[[${newTarget}${displayPart}]]`;
    }
    return raw;
  });
}

function normalizeDailies(
  notes: NoteRecord[],
  root: string,
  dryRun: boolean
): { renamed: Array<{ from: string; to: string }>; unparsed: string[] } {
  const renamed: Array<{ from: string; to: string }> = [];
  const unparsed: string[] = [];

  const dailies = notes.filter((n) => n.relativePath.startsWith("areas/daily/"));
  for (const note of dailies) {
    if (ISO_DAILY_RE.test(note.stem)) continue;
    const isoStem = parseDailyStem(note.stem);
    if (!isoStem) {
      unparsed.push(note.relativePath);
      continue;
    }

    const oldRelativePath = note.relativePath;
    const oldStem = note.stem;
    const newRelativePath = `areas/daily/${isoStem}.md`;
    const newAbsolutePath = join(root, newRelativePath);

    // Keep the H1 in sync when it was literally the old date stem (the
    // common case — daily notes are titled after their own date). Written
    // immediately, before the move below, so the copy picks it up. Without
    // this, a rename would leave title !== new stem and manufacture a fresh
    // alias-backfill candidate on the very next doctor run, defeating
    // idempotency.
    if (note.title === oldStem) {
      const retitled = note.content.replace(
        new RegExp(`^# ${escapeRegExp(oldStem)}$`, "m"),
        `# ${isoStem}`
      );
      if (retitled !== note.content) {
        note.content = retitled;
        note.title = isoStem;
        if (!dryRun) atomicWriteText(note.absolutePath, note.content);
      }
    }

    // Fix inbound links across the whole vault first (including this note
    // itself, in case it self-references), then move the file.
    for (const n of notes) {
      const updated = renameWikilinkTargets(n.content, oldStem, isoStem);
      if (updated !== n.content) {
        n.content = updated;
        if (!dryRun) atomicWriteText(n.absolutePath, updated);
      }
    }

    if (!dryRun) {
      mkdirSync(dirname(newAbsolutePath), { recursive: true });
      cpSync(note.absolutePath, newAbsolutePath);
      rmSync(note.absolutePath, { force: true });
    }

    note.relativePath = newRelativePath;
    note.absolutePath = newAbsolutePath;
    note.stem = isoStem;
    renamed.push({ from: oldRelativePath, to: newRelativePath });
  }

  return { renamed, unparsed };
}

function quarantineBrokenSymlinks(
  root: string,
  names: string[],
  dryRun: boolean
): string[] {
  const date = todayStamp();
  const quarantined: string[] = [];
  for (const name of names) {
    const from = join(root, name);
    const to = join(root, "archives", "_doctor", date, name);
    if (!dryRun) {
      mkdirSync(dirname(to), { recursive: true });
      // A broken symlink can't be cpSync'd (its target doesn't exist), so
      // recreate the link itself inside quarantine and remove the original.
      const linkTarget = readlinkSync(from);
      symlinkSync(linkTarget, to);
      unlinkSync(from);
    }
    quarantined.push(name);
  }
  return quarantined;
}

export function applyDoctorFixes(
  report: DoctorReport,
  opts: { dryRun: boolean }
): DoctorFixResult {
  const { dryRun } = opts;

  // Step 1 — purge test pollution.
  const quarantinedWikiItems = quarantineWikiPollution(report, dryRun);
  const quarantinedMinkRootDirs = quarantineMinkRootPollution(report, dryRun);

  if (!dryRun && quarantinedWikiItems.length > 0) {
    rebuildVaultIndex();
  }

  // Reload the working set, excluding anything just quarantined (or that
  // would be, in --dry-run) so downstream steps see the post-purge vault.
  const quarantinedRel = new Set(report.testPollution.wiki.map((p) => p.relativePath));
  const notes = loadAllNotes(report.vaultRoot).filter(
    (n) => !isUnderQuarantinedPath(n.relativePath, quarantinedRel)
  );

  // Step 2 — alias backfill (must run before link qualification so newly
  // aliased notes participate in ambiguity resolution).
  const aliasesAdded = backfillAliases(notes, dryRun);

  // Step 3 — ambiguous link qualification.
  const { qualified: linksQualified, unresolvable: unresolvableAmbiguousLinks } =
    qualifyAmbiguousLinks(notes, dryRun);

  // Step 4 — daily-note normalization.
  const { renamed: dailiesRenamed, unparsed: dailiesUnparsed } = normalizeDailies(
    notes,
    report.vaultRoot,
    dryRun
  );

  // Step 5 — broken top-level symlinks.
  const brokenSymlinksQuarantined = quarantineBrokenSymlinks(
    report.vaultRoot,
    report.brokenSymlinks,
    dryRun
  );

  const linkHealthAfter = analyzeLinks(notes).health;

  if (!dryRun) {
    updateMasterIndex(report.vaultRoot);
    rebuildVaultIndex();
  }

  return {
    dryRun,
    quarantinedWikiItems,
    quarantinedMinkRootDirs,
    aliasesAdded,
    linksQualified,
    unresolvableAmbiguousLinks,
    dailiesRenamed,
    dailiesUnparsed,
    brokenSymlinksQuarantined,
    linkHealthBefore: report.linkHealth,
    linkHealthAfter,
  };
}

// ── Report formatting ─────────────────────────────────────────────────────

export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push("[mink] wiki doctor — audit");
  lines.push(`  vault: ${report.vaultRoot}`);
  lines.push("");
  lines.push(`  notes:              ${report.totalNotes}`);
  lines.push(
    `  wikilinks:          ${report.linkHealth.totalLinks} total, ${report.linkHealth.resolved} resolved, ${report.linkHealth.broken} broken, ${report.linkHealth.ambiguous} ambiguous`
  );
  lines.push(`  orphan notes:       ${report.orphanNotes.length}`);
  lines.push(
    `  test pollution:     ${report.testPollution.wiki.length} wiki item(s), ${report.testPollution.minkRoot.length} mink-root dir(s)`
  );
  lines.push(`  missing aliases:    ${report.aliasCandidates.length}`);
  lines.push(`  ambiguous basenames: ${Object.keys(report.ambiguousBasenames).length}`);
  lines.push(`  non-ISO dailies:    ${report.dailyIssues.length}`);
  lines.push(`  broken symlinks:    ${report.brokenSymlinks.length}`);

  if (report.testPollution.wiki.length > 0) {
    lines.push("");
    lines.push("  Test pollution (wiki):");
    for (const p of report.testPollution.wiki.slice(0, 20)) {
      lines.push(`    ${p.kind === "wiki-dir" ? "dir " : "note"}  ${p.relativePath}`);
    }
    if (report.testPollution.wiki.length > 20) {
      lines.push(`    ... and ${report.testPollution.wiki.length - 20} more`);
    }
  }

  if (report.testPollution.minkRoot.length > 0) {
    lines.push("");
    lines.push("  Test pollution (mink root state dirs):");
    for (const p of report.testPollution.minkRoot.slice(0, 20)) {
      lines.push(`    projects/${p.relativePath}`);
    }
    if (report.testPollution.minkRoot.length > 20) {
      lines.push(`    ... and ${report.testPollution.minkRoot.length - 20} more`);
    }
  }

  if (Object.keys(report.ambiguousBasenames).length > 0) {
    lines.push("");
    lines.push("  Ambiguous basenames:");
    const entries = Object.entries(report.ambiguousBasenames).slice(0, 15);
    for (const [base, paths] of entries) {
      lines.push(`    ${base} (${paths.length}x): ${paths.join(", ")}`);
    }
    if (Object.keys(report.ambiguousBasenames).length > 15) {
      lines.push(`    ... and ${Object.keys(report.ambiguousBasenames).length - 15} more`);
    }
  }

  if (report.dailyIssues.length > 0) {
    lines.push("");
    lines.push("  Non-ISO dailies:");
    for (const d of report.dailyIssues.slice(0, 15)) {
      lines.push(
        `    ${d.relativePath} -> ${d.renameTo ? `areas/daily/${d.renameTo}.md` : "(unparseable — report only)"}`
      );
    }
    if (report.dailyIssues.length > 15) {
      lines.push(`    ... and ${report.dailyIssues.length - 15} more`);
    }
  }

  if (report.brokenSymlinks.length > 0) {
    lines.push("");
    lines.push("  Broken symlinks:");
    for (const s of report.brokenSymlinks) lines.push(`    ${s}`);
  }

  lines.push("");
  lines.push(
    report.testPollution.wiki.length +
      report.testPollution.minkRoot.length +
      report.aliasCandidates.length +
      report.dailyIssues.length +
      report.brokenSymlinks.length +
      report.ambiguousLinks.length >
      0
      ? "  Run 'mink wiki doctor --fix --dry-run' to preview repairs, or 'mink wiki doctor --fix' to apply them."
      : "  No issues found."
  );

  return lines.join("\n");
}

export function formatFixResult(result: DoctorFixResult): string {
  const lines: string[] = [];
  lines.push(`[mink] wiki doctor — ${result.dryRun ? "dry run (no changes made)" : "fix applied"}`);
  lines.push("");
  lines.push(
    `  quarantined (wiki):      ${result.quarantinedWikiItems.length}`
  );
  lines.push(
    `  quarantined (mink root): ${result.quarantinedMinkRootDirs.length}`
  );
  lines.push(`  aliases backfilled:      ${result.aliasesAdded.length}`);
  lines.push(`  links qualified:         ${result.linksQualified.length}`);
  lines.push(
    `  unresolvable ambiguous:  ${result.unresolvableAmbiguousLinks.length} (left untouched — no single best match)`
  );
  lines.push(`  dailies renamed:         ${result.dailiesRenamed.length}`);
  lines.push(`  dailies left as-is:      ${result.dailiesUnparsed.length} (non-ISO, unparseable)`);
  lines.push(`  broken symlinks removed: ${result.brokenSymlinksQuarantined.length}`);
  lines.push("");
  lines.push("  Link health:");
  lines.push(
    `    before: ${result.linkHealthBefore.resolved}/${result.linkHealthBefore.totalLinks} resolved, ${result.linkHealthBefore.broken} broken, ${result.linkHealthBefore.ambiguous} ambiguous, ${result.linkHealthBefore.orphans} orphans`
  );
  lines.push(
    `    after:  ${result.linkHealthAfter.resolved}/${result.linkHealthAfter.totalLinks} resolved, ${result.linkHealthAfter.broken} broken, ${result.linkHealthAfter.ambiguous} ambiguous, ${result.linkHealthAfter.orphans} orphans`
  );

  if (result.quarantinedWikiItems.length > 0) {
    lines.push("");
    lines.push("  Quarantined (wiki):");
    for (const q of result.quarantinedWikiItems.slice(0, 20)) {
      lines.push(`    ${q.from} -> ${q.to}`);
    }
  }

  if (result.quarantinedMinkRootDirs.length > 0) {
    lines.push("");
    lines.push("  Quarantined (mink root):");
    for (const q of result.quarantinedMinkRootDirs.slice(0, 20)) {
      lines.push(`    ${q.from} -> ${q.to}`);
    }
  }

  if (result.unresolvableAmbiguousLinks.length > 0) {
    lines.push("");
    lines.push("  Unresolvable ambiguous links (manual fix needed):");
    for (const u of result.unresolvableAmbiguousLinks.slice(0, 20)) {
      lines.push(`    ${u.file}: [[${u.target}]] -> ${u.candidates.join(", ")}`);
    }
  }

  return lines.join("\n");
}
