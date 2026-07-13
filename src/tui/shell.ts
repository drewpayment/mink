/**
 * Shell chrome: the tab bar, footer, and picker/help overlays that wrap
 * whichever screen is active. Composition only — the active screen renders
 * its own self-contained `cols x contentRows` canvas via the `TuiScreen`
 * contract; `renderShell` blits that into the full frame and draws chrome
 * around it. Pure `(…) => Screen`, snapshot-testable without a terminal.
 */

import { Screen } from "./screen";
import { drawHelpOverlay, drawListOverlay } from "./widgets";
import { stringWidth } from "./width";
import type { TuiScreen, ScreenUiState } from "./screen-registry";

export const MIN_COLS = 80;
export const MIN_ROWS = 24;

const TAB_BAR_H = 1;
const FOOTER_H = 1;

export interface PickerItem {
  name: string;
  cwd: string;
  isCurrent: boolean;
}

export interface PickerState {
  open: boolean;
  index: number;
  items: PickerItem[];
}

export interface ShellState {
  helpOpen: boolean;
  picker: PickerState | null;
}

const SHELL_HELP_KEYS: Array<[string, string]> = [
  ["q, Ctrl-C", "quit"],
  ["?", "toggle this help"],
  ["r", "force refresh"],
  ["p", "project picker"],
  ["Tab/Shift-Tab", "next/prev screen"],
];

/** Centered "terminal too small" message — never renders garbage below the minimum size. */
export function renderTooSmall(cols: number, rows: number): Screen {
  const screen = new Screen(Math.max(cols, 0), Math.max(rows, 0));
  const lines = [
    "Terminal too small",
    `need at least ${MIN_COLS}×${MIN_ROWS}`,
    `(current ${cols}×${rows})`,
  ];
  const startY = Math.max(0, Math.floor((screen.rows - lines.length) / 2));
  lines.forEach((line, i) => {
    const x = Math.max(0, Math.floor((screen.cols - stringWidth(line)) / 2));
    screen.drawText(x, startY + i, line, { fg: "warn", bold: i === 0 });
  });
  return screen;
}

/** How many rows a screen's `render()` gets, once the tab bar and footer are reserved. */
export function contentRows(rows: number): number {
  return Math.max(0, rows - TAB_BAR_H - FOOTER_H);
}

function renderTabBar(screen: Screen, screens: TuiScreen[], activeIndex: number, y: number, w: number): void {
  let x = 1;
  for (let i = 0; i < screens.length; i++) {
    if (x >= w) break;
    const s = screens[i]!;
    const isActive = i === activeIndex;
    const label = ` ${s.hotkey} ${s.title} `;
    screen.drawText(x, y, label, { fg: isActive ? "accent" : "dim", bold: isActive }, w - x);
    x += stringWidth(label);
    if (i < screens.length - 1 && x < w) {
      screen.drawText(x, y, "│", { fg: "border" }, w - x);
      x += 1;
    }
  }
}

function renderFooter(screen: Screen, screens: TuiScreen[], lastRefresh: string, y: number, w: number): void {
  const segments = ["q quit", "? help", "p projects"];
  if (screens.length > 1) segments.push(`Tab/1-${screens.length} screens`);
  segments.push("r refresh");
  const hints = segments.join(" · ");
  const updated = `updated ${lastRefresh}`;
  screen.drawText(0, y, hints, { fg: "dim" }, w);
  const updatedX = w - stringWidth(updated);
  if (updatedX > stringWidth(hints) + 1) {
    screen.drawText(updatedX, y, updated, { fg: "dim" }, w);
  }
}

function renderPicker(screen: Screen, picker: PickerState): void {
  const hasItems = picker.items.length > 0;
  const items = hasItems
    ? picker.items.map((p) => (p.isCurrent ? `${p.name}  (current)` : p.name))
    : ["No registered projects"];
  const subItems = hasItems ? picker.items.map((p) => p.cwd) : undefined;
  const selectedIndex = hasItems ? picker.index : -1;

  drawListOverlay(screen, {
    title: "Projects",
    items,
    selectedIndex,
    subItems,
    footerHint: hasItems ? "↵ switch · Esc/p close" : "Esc/p close",
  });
}

/**
 * Composes the full frame: tab bar, the active screen's own render output,
 * footer, and (mutually exclusive, picker wins) the picker/help overlay.
 * `model` is `null` when the active screen's first build hasn't succeeded
 * yet — renders a minimal waiting message instead of a blank canvas.
 */
export function renderShell<M>(
  screens: TuiScreen<M>[],
  activeIndex: number,
  model: M | null,
  screenState: ScreenUiState,
  shell: ShellState,
  cols: number,
  rows: number,
): Screen {
  if (cols < MIN_COLS || rows < MIN_ROWS) return renderTooSmall(cols, rows);

  const active = screens[activeIndex]!;
  const screen = new Screen(cols, rows);

  renderTabBar(screen, screens, activeIndex, 0, cols);

  if (model !== null) {
    const inner = active.render(model, screenState, cols, contentRows(rows));
    inner.blitInto(screen, 0, TAB_BAR_H);
  } else {
    screen.drawText(2, TAB_BAR_H + 1, "[mink] tui: waiting for data…", { fg: "warn" });
  }

  renderFooter(screen, screens, screenState.lastRefresh, rows - 1, cols);

  // Picker and help are mutually exclusive overlays; the picker wins if a
  // caller somehow sets both, since it represents an in-progress action
  // (project switch) rather than a passive reference view.
  if (shell.picker?.open) {
    renderPicker(screen, shell.picker);
  } else if (shell.helpOpen) {
    const keys = [...SHELL_HELP_KEYS, ...(active.helpKeys ?? [])];
    drawHelpOverlay(screen, keys);
  }

  return screen;
}
