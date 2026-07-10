/**
 * Memory screen: a browser over the two "learned" state files — bug memory
 * (recurring errors + fixes) and learning memory (rules extracted from
 * session reflection). Two independently-scrollable lists with a `b`/`l`
 * focus toggle, plus a detail pane showing the full text of whichever row
 * is selected (list rows truncate; the detail pane doesn't).
 *
 * Unlike sessions-screen.ts/compression-screen.ts, this screen does NOT
 * drive its cursor off `ScreenUiState` — that struct carries exactly one
 * scrollOffset/selectedIndex pair, but Memory needs two (one per list) plus
 * a focus flag, none of which fit. Following wiki-screen.ts's precedent for
 * its search-mode state, the cursor/focus state lives in closure-local
 * variables instead. Screens are effectively singletons (`screen-registry.ts`
 * puts one instance of each in `SCREENS`), so this is safe in production;
 * tests that need isolated state should call `createMemoryScreen()` to get
 * a fresh instance rather than reusing the shared `memoryScreen` export.
 */

import { Screen } from "./screen";
import { drawBox, drawTable } from "./widgets";
import { stringWidth } from "./width";
import { fmtTime } from "./overview-model";
import { loadBugLogPanel, loadLearningMemoryPanel } from "../core/dashboard-api";
import type { TuiScreen, ScreenUiState } from "./screen-registry";
import type { Key } from "./term";
import type { BugLogPayload } from "../types/dashboard";
import type { LearningMemory, SectionName } from "../types/learning-memory";

const HELP_KEYS: Array<[string, string]> = [
  ["b / l", "focus bugs / learnings"],
  ["j/k, ↓/↑", "move selection"],
  ["g/G", "top/bottom"],
];

// ── Model ────────────────────────────────────────────────────────────────

export interface MemoryBugItem {
  id: string;
  errorMessage: string;
  filePath: string;
  lineNumber?: number;
  rootCause: string;
  fixDescription: string;
  tags: string[];
  occurrenceCount: number;
  createdAt: string;
  lastSeenAt: string;
  isFixed: boolean;
}

export interface MemoryLearningItem {
  section: SectionName;
  text: string;
}

export interface MemoryModel {
  bugs: MemoryBugItem[];
  learnings: MemoryLearningItem[];
}

// Fixed display order for the four learning-memory sections — matches the
// order they're written in learning-memory.ts's markdown serialization.
const SECTION_ORDER: SectionName[] = ["Key Learnings", "Do-Not-Repeat", "User Preferences", "Decision Log"];

const SECTION_ABBREV: Record<SectionName, string> = {
  "Key Learnings": "LEARN",
  "Do-Not-Repeat": "AVOID",
  "User Preferences": "PREF",
  "Decision Log": "DECIDE",
};

/** Pure derivation from the bug-log + learning-memory payloads — fixture-testable, no I/O. */
export function deriveMemoryModel(bugLog: BugLogPayload, learningMemory: LearningMemory): MemoryModel {
  const bugs: MemoryBugItem[] = [...(bugLog.entries ?? [])]
    .map((b) => ({
      id: b.id,
      errorMessage: b.errorMessage,
      filePath: b.filePath,
      lineNumber: b.lineNumber,
      rootCause: b.rootCause,
      fixDescription: b.fixDescription,
      tags: b.tags ?? [],
      occurrenceCount: b.occurrenceCount ?? 0,
      createdAt: b.createdAt,
      lastSeenAt: b.lastSeenAt,
      isFixed: !!b.fixDescription && b.fixDescription.trim().length > 0,
    }))
    // Newest-seen first, matching the repo-wide "recent activity first" convention.
    .sort((a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || ""));

  const learnings: MemoryLearningItem[] = [];
  for (const section of SECTION_ORDER) {
    const lines = learningMemory.sections?.[section] ?? [];
    for (const text of lines) learnings.push({ section, text });
  }

  return { bugs, learnings };
}

function buildMemoryModel(cwd: string): MemoryModel {
  return deriveMemoryModel(loadBugLogPanel(cwd), loadLearningMemoryPanel(cwd));
}

// ── Shared helpers (mirrors sessions-screen.ts's clampIndex/followScroll) ──

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

// ── Registry entry (factory so tests can get isolated cursor state) ───────

type Focus = "bugs" | "learnings";

export function createMemoryScreen(): TuiScreen<MemoryModel> {
  let focus: Focus = "bugs";
  let bugIndex = 0;
  let bugScroll = 0;
  let learningIndex = 0;
  let learningScroll = 0;

  // ── Bugs list ────────────────────────────────────────────────────────

  function renderBugsBox(screen: Screen, model: MemoryModel, x: number, y: number, w: number, h: number): void {
    drawBox(screen, { x, y, w, h, title: `Bugs (${model.bugs.length})`, focused: focus === "bugs" });
    if (h < 3) return;
    const innerX = x + 1;
    const innerW = Math.max(0, w - 2);

    if (model.bugs.length === 0) {
      screen.drawText(x + 2, y + 1, "No bugs logged yet.", { fg: "dim" }, innerW - 1);
      return;
    }

    const selected = clampIndex(bugIndex, model.bugs.length);
    const bodyH = h - 3;
    bugScroll = followScroll(selected, bugScroll, Math.max(0, bodyH), model.bugs.length);

    const countW = 5;
    const seenW = 8;
    const errW = Math.max(6, innerW - countW - seenW - 2);
    drawTable(screen, {
      x: innerX,
      y: y + 1,
      w: innerW,
      h: h - 2,
      columns: [
        { label: "ERROR", width: errW },
        { label: "CNT", width: countW, align: "right" },
        { label: "SEEN", width: seenW, align: "right" },
      ],
      rows: model.bugs.map((b) => [`${b.isFixed ? "✓" : "●"} ${b.errorMessage}`, String(b.occurrenceCount), fmtTime(b.lastSeenAt)]),
      scrollOffset: bugScroll,
      selectedIndex: focus === "bugs" ? selected : -1,
    });
  }

  // ── Learnings list ───────────────────────────────────────────────────

  function renderLearningsBox(screen: Screen, model: MemoryModel, x: number, y: number, w: number, h: number): void {
    drawBox(screen, { x, y, w, h, title: `Learnings (${model.learnings.length})`, focused: focus === "learnings" });
    if (h < 3) return;
    const innerX = x + 1;
    const innerW = Math.max(0, w - 2);

    if (model.learnings.length === 0) {
      screen.drawText(x + 2, y + 1, "No learnings recorded yet.", { fg: "dim" }, innerW - 1);
      return;
    }

    const selected = clampIndex(learningIndex, model.learnings.length);
    const bodyH = h - 3;
    learningScroll = followScroll(selected, learningScroll, Math.max(0, bodyH), model.learnings.length);

    const sectionW = 6;
    const ruleW = Math.max(6, innerW - sectionW - 1);
    drawTable(screen, {
      x: innerX,
      y: y + 1,
      w: innerW,
      h: h - 2,
      columns: [
        { label: "", width: sectionW },
        { label: "RULE", width: ruleW },
      ],
      rows: model.learnings.map((l) => [SECTION_ABBREV[l.section], l.text]),
      scrollOffset: learningScroll,
      selectedIndex: focus === "learnings" ? selected : -1,
    });
  }

  // ── Detail pane ──────────────────────────────────────────────────────

  function renderDetail(screen: Screen, model: MemoryModel, x: number, y: number, w: number, h: number): void {
    const title = focus === "bugs" ? "Bug detail" : "Learning detail";
    drawBox(screen, { x, y, w, h, title, focused: true });
    if (h < 3) return;
    const innerX = x + 2;
    const innerW = Math.max(0, w - 4);
    const bottom = y + h - 1;

    if (focus === "bugs") {
      const b = model.bugs[clampIndex(bugIndex, model.bugs.length)];
      if (!b) {
        screen.drawText(innerX, y + 1, "No bugs logged yet.", { fg: "dim" }, innerW);
        return;
      }
      let row = y + 1;
      screen.drawText(innerX, row, `${b.isFixed ? "✓ fixed" : "● open"}  ${b.id}`, { fg: b.isFixed ? "good" : "warn", bold: true }, innerW);
      row += 2;
      for (const line of wrapText(b.errorMessage, innerW)) {
        if (row >= bottom) return;
        screen.drawText(innerX, row, line, { fg: "text" }, innerW);
        row++;
      }
      row++;
      if (row >= bottom) return;
      screen.drawText(innerX, row, `file: ${b.filePath}${b.lineNumber ? `:${b.lineNumber}` : ""}`, { fg: "dim" }, innerW);
      row++;
      if (b.tags.length > 0 && row < bottom) {
        screen.drawText(innerX, row, `tags: ${b.tags.map((t) => `#${t}`).join(" ")}`, { fg: "dim" }, innerW);
        row++;
      }
      if (row >= bottom) return;
      screen.drawText(innerX, row, `seen ${b.occurrenceCount}× · created ${fmtTime(b.createdAt)} · last ${fmtTime(b.lastSeenAt)}`, { fg: "dim" }, innerW);
      row += 2;
      if (row >= bottom) return;
      screen.drawText(innerX, row, "Root cause", { fg: "dim", bold: true }, innerW);
      row++;
      for (const line of wrapText(b.rootCause || "—", innerW)) {
        if (row >= bottom) return;
        screen.drawText(innerX, row, line, { fg: "text" }, innerW);
        row++;
      }
      row++;
      if (row >= bottom) return;
      screen.drawText(innerX, row, "Fix", { fg: "dim", bold: true }, innerW);
      row++;
      for (const line of wrapText(b.fixDescription || "not fixed yet", innerW)) {
        if (row >= bottom) return;
        screen.drawText(innerX, row, line, { fg: "text" }, innerW);
        row++;
      }
      return;
    }

    const l = model.learnings[clampIndex(learningIndex, model.learnings.length)];
    if (!l) {
      screen.drawText(innerX, y + 1, "No learnings recorded yet.", { fg: "dim" }, innerW);
      return;
    }
    let row = y + 1;
    screen.drawText(innerX, row, l.section, { fg: "accent", bold: true }, innerW);
    row += 2;
    for (const line of wrapText(l.text, innerW)) {
      if (row >= bottom) return;
      screen.drawText(innerX, row, line, { fg: "text" }, innerW);
      row++;
    }
  }

  // ── Top-level layout ─────────────────────────────────────────────────

  function render(model: MemoryModel, _state: ScreenUiState, cols: number, rows: number): Screen {
    const screen = new Screen(cols, rows);

    const leftW = Math.max(24, Math.min(cols - 20, Math.floor(cols * 0.42)));
    const rightW = cols - leftW;
    const bugsH = Math.max(4, Math.floor(rows / 2));
    const learningsH = Math.max(3, rows - bugsH);

    renderBugsBox(screen, model, 0, 0, leftW, bugsH);
    renderLearningsBox(screen, model, 0, bugsH, leftW, learningsH);
    renderDetail(screen, model, leftW, 0, rightW, rows);

    return screen;
  }

  // ── Key handling ─────────────────────────────────────────────────────

  function onKey(key: Key, _state: ScreenUiState, model: MemoryModel | null): boolean {
    if (key.name === "b") {
      focus = "bugs";
      return true;
    }
    if (key.name === "l") {
      focus = "learnings";
      return true;
    }

    const total = focus === "bugs" ? (model?.bugs.length ?? 0) : (model?.learnings.length ?? 0);
    const maxIndex = Math.max(0, total - 1);
    const getIndex = () => (focus === "bugs" ? bugIndex : learningIndex);
    const setIndex = (v: number) => {
      if (focus === "bugs") bugIndex = v;
      else learningIndex = v;
    };

    if (key.name === "j" || key.name === "down") {
      setIndex(Math.min(getIndex() + 1, maxIndex));
      return true;
    }
    if (key.name === "k" || key.name === "up") {
      setIndex(Math.max(0, getIndex() - 1));
      return true;
    }
    if (key.name === "g") {
      setIndex(0);
      return true;
    }
    if (key.name === "G") {
      setIndex(maxIndex);
      return true;
    }
    return false;
  }

  function onProjectSwitch(): void {
    focus = "bugs";
    bugIndex = 0;
    learningIndex = 0;
  }

  return {
    id: "memory",
    title: "Memory",
    hotkey: "4",
    buildModel: buildMemoryModel,
    render,
    onKey,
    onProjectSwitch,
    helpKeys: HELP_KEYS,
  };
}

export const memoryScreen: TuiScreen<MemoryModel> = createMemoryScreen();
