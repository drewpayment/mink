/**
 * The screen registry: the contract every TUI panel implements, plus the
 * ordered list of registered screens. Adding a new screen is a two-step
 * recipe:
 *
 *   1. Create `src/tui/<name>-screen.ts` exporting a `TuiScreen<YourModel>`.
 *   2. Import it here and add it to `SCREENS`, in tab position order.
 *
 * Nothing else needs to change — the shell (`shell.ts`) and the run loop
 * (`src/commands/tui.ts`) both drive purely off this array.
 */

import type { Screen } from "./screen";
import type { Key } from "./term";
import { overviewScreen } from "./overview-screen";
import { sessionsScreen } from "./sessions-screen";
import { compressionScreen } from "./compression-screen";
import { memoryScreen } from "./memory-screen";
import { wikiScreen } from "./wiki-screen";

/** Per-screen UI state, kept alive across tab switches so scroll position survives a trip to another tab. */
export interface ScreenUiState {
  scrollOffset: number;
  selectedIndex: number;
  lastRefresh: string; // preformatted time, e.g. "14:32:05" (or "… — error: <msg>")
}

export interface TuiScreen<M = unknown> {
  id: string; // "overview" — stable, used as the state/model-cache key
  title: string; // tab label, e.g. "Overview"
  hotkey: string; // single-char digit key, e.g. "1"
  /** Pure data assembly (may throw — the run loop catches and keeps the last-good model). */
  buildModel(cwd: string): M;
  /** Pure layout: (model, state, cols, rows) -> Screen. Owns the full cols x rows canvas handed to it (the shell reserves the tab bar and footer rows before calling this). */
  render(model: M, state: ScreenUiState, cols: number, rows: number): Screen;
  /**
   * Handles a key the shell doesn't own (see shell.ts's key-ownership
   * table). Return true if consumed — the run loop repaints; false to let
   * the key fall through as a no-op.
   */
  onKey?(key: Key, state: ScreenUiState, model: M | null): boolean;
  /** Extra help-overlay rows appended after the shell's own key list. */
  helpKeys?: Array<[string, string]>;
  /**
   * Returns true when the screen wants first refusal on EVERY key,
   * including ones the shell would otherwise treat as global chrome
   * (q/p/r/?/Tab/digit hotkeys) — e.g. while a search/filter text input
   * has focus and the user may type any of those characters. The shell
   * checks this before its own key-ownership table and, if true, routes
   * the key straight to onKey. Ctrl-C still always tears down the app.
   */
  capturesInput?(model: M | null): boolean;
  /**
   * Called when the user switches projects via the picker, so screens with
   * closure-local UI state (search query, section focus, cursors) reset it
   * — a filter typed against one project must not silently apply to the
   * next. Screens whose state lives entirely in ScreenUiState omit this;
   * the shell resets those fields itself.
   */
  onProjectSwitch?(): void;
}

// Ordered; array index is tab position.
export const SCREENS: TuiScreen[] = [
  overviewScreen,
  sessionsScreen,
  compressionScreen,
  memoryScreen,
  wikiScreen,
];

/**
 * Pure screen-switch resolution: given the currently active index and a key
 * event, returns the new index, or null if the key isn't a screen-switch key
 * (letting callers fall through to shell/screen key handling). Testable
 * without a terminal.
 */
export function nextScreenIndex(current: number, key: Key, screens: TuiScreen[]): number | null {
  if (screens.length === 0) return null;
  if (key.name === "tab") {
    return key.shift ? (current - 1 + screens.length) % screens.length : (current + 1) % screens.length;
  }
  const hotkeyIndex = screens.findIndex((s) => s.hotkey === key.name);
  return hotkeyIndex >= 0 ? hotkeyIndex : null;
}

function defaultScreenUiState(): ScreenUiState {
  return { scrollOffset: 0, selectedIndex: 0, lastRefresh: "" };
}

/**
 * Keeps one `ScreenUiState` alive per screen id so switching tabs preserves
 * each screen's own scroll position rather than resetting it. Lazily
 * creates a default on first access. Exported standalone (rather than
 * folded into the run loop) so tab-switch state preservation is testable
 * without a terminal.
 */
export function createScreenStateStore(): { get(id: string): ScreenUiState } {
  const states = new Map<string, ScreenUiState>();
  return {
    get(id: string): ScreenUiState {
      let s = states.get(id);
      if (!s) {
        s = defaultScreenUiState();
        states.set(id, s);
      }
      return s;
    },
  };
}
