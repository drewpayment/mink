/**
 * Wiki screen: a quick-search browser over the cross-project markdown vault.
 * Lists recent notes (title/category/modified) with a right-hand preview of
 * whichever note is selected, and a `/`-triggered search mode that filters
 * the list by title/path substring as you type.
 *
 * Two deliberate deviations from the sessions-screen.ts/compression-screen.ts
 * pattern, both documented where they matter:
 *
 *  1. Cursor/search state is closure-local, not `ScreenUiState` — same
 *     reasoning as memory-screen.ts (see its file header) plus the search
 *     query itself, which `ScreenUiState` has no field for. Screens are
 *     effectively singletons in production; tests wanting isolated state
 *     should call `createWikiScreen()` for a fresh instance.
 *
 *  2. `buildModel` also resolves the *selected* note's preview via
 *     `loadWikiNote` (closure-aware: it reads the current selection/query to
 *     know which note that is). Every other screen's `buildModel` only does
 *     an unconditional state-file read, but that's just this repo's
 *     existing precedent for "buildModel does I/O, render doesn't" — folding
 *     the preview fetch in here keeps `render` a pure, fixture-testable
 *     function instead of doing file I/O mid-render.
 *
 * IMPORTANT — see the capturesInput() method below and
 * scratchpad/captures-input.patch: search mode needs first refusal on every
 * keystroke, including ones the shell currently treats as global chrome
 * (q/p/r/?/Tab/digits). That contract change is NOT yet applied to
 * screen-registry.ts/shell.ts/tui.ts; this file implements against the
 * assumption that it will be.
 */

import { Screen } from "./screen";
import { drawBox, drawTable } from "./widgets";
import { stringWidth } from "./width";
import { fmtTime } from "./overview-model";
import { loadWikiPanel, loadWikiNote } from "../core/dashboard-api";
import type { TuiScreen, ScreenUiState } from "./screen-registry";
import type { Key } from "./term";
import type { WikiPanelPayload, WikiNotePayload } from "../types/dashboard";
import type { NoteCategory } from "../types/note";

const HELP_KEYS: Array<[string, string]> = [
  ["/", "search notes (title/path)"],
  ["j/k, ↓/↑", "select note"],
  ["g/G", "top/bottom"],
  ["Esc", "clear search"],
  ["Enter", "confirm search, keep filter"],
];

const PREVIEW_MAX_LINES = 60;

// ── Model ────────────────────────────────────────────────────────────────

export interface WikiNoteListItem {
  filePath: string;
  title: string;
  category: NoteCategory;
  tags: string[];
  lastModified: string;
}

export interface WikiPreview {
  path: string;
  title: string;
  lines: string[];
  backlinkCount: number;
}

export interface WikiModel {
  initialized: boolean;
  vaultPath: string;
  totalNotes: number;
  notes: WikiNoteListItem[];
  // The currently-selected note's rendered preview, or null if nothing is
  // selected/resolvable (empty vault, filtered-to-nothing, or a stale path
  // that no longer exists on disk).
  preview: WikiPreview | null;
}

/** Pure mapping from the wiki panel payload to the note list — fixture-testable, no I/O. */
export function deriveWikiModel(payload: WikiPanelPayload): WikiModel {
  return {
    initialized: payload.initialized,
    vaultPath: payload.vaultPath,
    totalNotes: payload.totalNotes,
    notes: payload.recent.map((n) => ({
      filePath: n.filePath,
      title: n.title,
      category: n.category,
      tags: n.tags ?? [],
      lastModified: n.lastModified,
    })),
    preview: null,
  };
}

/**
 * Case-insensitive substring match on title + path. Exported standalone so
 * search behavior is testable without a screen instance or a terminal.
 */
export function filterNotes(notes: WikiNoteListItem[], query: string): WikiNoteListItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return notes;
  return notes.filter((n) => n.title.toLowerCase().includes(q) || n.filePath.toLowerCase().includes(q));
}

/**
 * First `maxLines` non-blank-leading lines of a note's body. `loadWikiNote`
 * already splits frontmatter out into its own field (see dashboard-api.ts's
 * parseFrontmatter), so `note.body` is frontmatter-free already — this just
 * trims a leading blank line or two and caps the length for the pane.
 */
export function derivePreviewLines(note: WikiNotePayload, maxLines: number): string[] {
  const lines = note.body.split("\n");
  let start = 0;
  while (start < lines.length && lines[start]!.trim() === "") start++;
  return lines.slice(start, start + Math.max(0, maxLines));
}

// ── Rendering helpers ────────────────────────────────────────────────────

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [];
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && stringWidth(candidate) > width) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function clampIndex(i: number, len: number): number {
  if (len <= 0) return 0;
  return Math.max(0, Math.min(i, len - 1));
}

function followScroll(selected: number, offset: number, bodyHeight: number, total: number): number {
  if (bodyHeight <= 0 || total <= 0) return 0;
  let next = offset;
  if (selected < next) next = selected;
  else if (selected >= next + bodyHeight) next = selected - bodyHeight + 1;
  return Math.max(0, Math.min(next, Math.max(0, total - bodyHeight)));
}

// ── Extended contract (see file header + captures-input.patch) ────────────

/**
 * `TuiScreen` doesn't (yet) declare `capturesInput` — this local interface
 * augments it so `wikiScreen` typechecks cleanly today while still exposing
 * the method for the shell to pick up once the contract change lands.
 * `WikiScreenType` remains structurally assignable to `TuiScreen<WikiModel>`
 * (and, per screen-registry.ts's existing pattern, to `TuiScreen[]`), so
 * wiring `wikiScreen` into `SCREENS` needs no cast.
 */
export interface WikiScreenType extends TuiScreen<WikiModel> {
  capturesInput(model: WikiModel | null): boolean;
}

// ── Registry entry (factory so tests can get isolated cursor/search state) ─

export function createWikiScreen(): WikiScreenType {
  let query = "";
  let searchMode = false;
  let selectedIndex = 0;
  let selectedScroll = 0;

  function buildModel(_cwd: string): WikiModel {
    const payload = loadWikiPanel();
    const base = deriveWikiModel(payload);
    const filtered = filterNotes(base.notes, query);
    const idx = filtered.length > 0 ? clampIndex(selectedIndex, filtered.length) : -1;
    const selectedPath = idx >= 0 ? filtered[idx]!.filePath : null;

    let preview: WikiPreview | null = null;
    if (selectedPath) {
      const note = loadWikiNote(selectedPath);
      if (note) {
        const titleFromFrontmatter = typeof note.frontmatter.title === "string" ? note.frontmatter.title : null;
        preview = {
          path: note.path,
          title: titleFromFrontmatter ?? note.path,
          lines: derivePreviewLines(note, PREVIEW_MAX_LINES),
          backlinkCount: note.backlinks.length,
        };
      }
    }

    return { ...base, preview };
  }

  // ── Search bar ───────────────────────────────────────────────────────

  function renderSearchBar(screen: Screen, cols: number): void {
    if (searchMode) {
      screen.drawText(0, 0, `/${query}▏`, { fg: "accent", bold: true }, cols);
      return;
    }
    const hint = query ? `filter: "${query}"  (/ to edit · Esc to clear)` : "/ to search notes";
    screen.drawText(0, 0, hint, { fg: "dim" }, cols);
  }

  // ── Note list ────────────────────────────────────────────────────────

  function renderNoteList(
    screen: Screen,
    filtered: WikiNoteListItem[],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    drawBox(screen, { x, y, w, h, title: `Notes (${filtered.length})`, focused: !searchMode });
    if (h < 3) return;
    const innerX = x + 1;
    const innerW = Math.max(0, w - 2);

    if (filtered.length === 0) {
      const msg = query ? `No notes match "${query}".` : "No notes yet.";
      screen.drawText(x + 2, y + 1, msg, { fg: "dim" }, innerW - 1);
      return;
    }

    const selected = clampIndex(selectedIndex, filtered.length);
    const bodyH = h - 3;
    selectedScroll = followScroll(selected, selectedScroll, Math.max(0, bodyH), filtered.length);

    const catW = 10;
    const whenW = 8;
    const titleW = Math.max(6, innerW - catW - whenW - 2);
    drawTable(screen, {
      x: innerX,
      y: y + 1,
      w: innerW,
      h: h - 2,
      columns: [
        { label: "TITLE", width: titleW },
        { label: "CATEGORY", width: catW },
        { label: "WHEN", width: whenW, align: "right" },
      ],
      rows: filtered.map((n) => [n.title, n.category, fmtTime(n.lastModified)]),
      scrollOffset: selectedScroll,
      selectedIndex: selected,
    });
  }

  // ── Preview pane ─────────────────────────────────────────────────────

  function renderPreview(screen: Screen, model: WikiModel, selected: WikiNoteListItem | null, x: number, y: number, w: number, h: number): void {
    drawBox(screen, { x, y, w, h, title: selected ? selected.title : "Preview" });
    if (h < 3) return;
    const innerX = x + 2;
    const innerW = Math.max(0, w - 4);
    const bottom = y + h - 1;

    if (!selected) {
      screen.drawText(innerX, y + 1, model.notes.length === 0 ? "No notes in vault." : "No note selected.", { fg: "dim" }, innerW);
      return;
    }

    const preview = model.preview && model.preview.path === selected.filePath ? model.preview : null;
    if (!preview) {
      screen.drawText(innerX, y + 1, "Loading preview…", { fg: "dim" }, innerW);
      return;
    }

    let row = y + 1;
    screen.drawText(innerX, row, `${selected.category} · ${fmtTime(selected.lastModified)} · ${preview.backlinkCount} backlink${preview.backlinkCount === 1 ? "" : "s"}`, { fg: "dim" }, innerW);
    row += 2;
    if (selected.tags.length > 0 && row < bottom) {
      screen.drawText(innerX, row, selected.tags.map((t) => `#${t}`).join(" "), { fg: "dim" }, innerW);
      row += 2;
    }

    for (const rawLine of preview.lines) {
      if (row >= bottom) break;
      if (rawLine === "") {
        row++;
        continue;
      }
      for (const line of wrapText(rawLine, innerW)) {
        if (row >= bottom) break;
        screen.drawText(innerX, row, line, { fg: "text" }, innerW);
        row++;
      }
    }
  }

  // ── Top-level layout ─────────────────────────────────────────────────

  function render(model: WikiModel, _state: ScreenUiState, cols: number, rows: number): Screen {
    const screen = new Screen(cols, rows);

    if (!model.initialized) {
      screen.drawText(2, 1, "Wiki vault not initialized.", { fg: "warn" }, cols - 4);
      if (rows > 2) screen.drawText(2, 2, "Run `mink wiki init` from the CLI.", { fg: "dim" }, cols - 4);
      return screen;
    }

    const headerH = 1;
    renderSearchBar(screen, cols);

    const bodyY = headerH;
    const bodyH = Math.max(0, rows - headerH);
    const leftW = Math.max(24, Math.min(cols - 24, Math.floor(cols * 0.45)));
    const rightW = cols - leftW;

    const filtered = filterNotes(model.notes, query);
    const selected = filtered.length > 0 ? filtered[clampIndex(selectedIndex, filtered.length)]! : null;

    renderNoteList(screen, filtered, 0, bodyY, leftW, bodyH);
    renderPreview(screen, model, selected, leftW, bodyY, rightW, bodyH);

    return screen;
  }

  // ── Key handling ─────────────────────────────────────────────────────

  /** True while search mode owns the keyboard — see the file header and captures-input.patch. */
  function capturesInput(_model: WikiModel | null): boolean {
    return searchMode;
  }

  function onKey(key: Key, _state: ScreenUiState, model: WikiModel | null): boolean {
    if (searchMode) {
      // Ctrl combos (Ctrl-C above all) must keep working even mid-search;
      // let anything ctrl'd fall through unconsumed.
      if (key.ctrl) return false;
      if (key.name === "escape") {
        query = "";
        searchMode = false;
        selectedIndex = 0;
        return true;
      }
      if (key.name === "return") {
        searchMode = false;
        return true;
      }
      if (key.name === "backspace") {
        query = query.slice(0, -1);
        selectedIndex = 0;
        return true;
      }
      if (key.name.length === 1) {
        query += key.name;
        selectedIndex = 0;
        return true;
      }
      // Any other key (arrows, tab, etc.) while typing is swallowed rather
      // than falling through to list navigation or shell chrome.
      return true;
    }

    if (key.name === "/") {
      searchMode = true;
      return true;
    }

    const filteredLen = model ? filterNotes(model.notes, query).length : 0;
    const maxIndex = Math.max(0, filteredLen - 1);
    if (key.name === "j" || key.name === "down") {
      selectedIndex = Math.min(selectedIndex + 1, maxIndex);
      return true;
    }
    if (key.name === "k" || key.name === "up") {
      selectedIndex = Math.max(0, selectedIndex - 1);
      return true;
    }
    if (key.name === "g") {
      selectedIndex = 0;
      return true;
    }
    if (key.name === "G") {
      selectedIndex = maxIndex;
      return true;
    }
    return false;
  }

  return {
    id: "wiki",
    title: "Wiki",
    hotkey: "5",
    buildModel,
    render,
    onKey,
    capturesInput,
    helpKeys: HELP_KEYS,
  };
}

export const wikiScreen: WikiScreenType = createWikiScreen();
