import { resolveStartupCwd } from "./dashboard";
import { isInteractive, enterTui, exitTui, installSafetyNet, onResize, readKeys, type Key } from "../tui/term";
import { detectColorDepth, setActiveDepth } from "../tui/style";
import { Screen } from "../tui/screen";
import { buildOverviewModel, type OverviewModel } from "../tui/overview-model";
import { renderOverview, type UiState, type PickerState } from "../tui/overview-screen";
import { listRegisteredProjects } from "../core/project-registry";
import { getOrCreateDeviceId } from "../core/device";

const DEFAULT_INTERVAL_MS = 1000;
const MIN_INTERVAL_MS = 250;

function parseInterval(args: string[]): number {
  const flag = args.find((a) => a.startsWith("--interval="));
  if (!flag) return DEFAULT_INTERVAL_MS;
  const parsed = parseInt(flag.split("=")[1] ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, parsed);
}

function clock(): string {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export async function tui(cwd: string, args: string[]): Promise<void> {
  const resolution = resolveStartupCwd(cwd);
  if (resolution.kind === "none") {
    console.error("[mink] no mink projects found. Run `mink init` in a project first.");
    process.exit(1);
  }
  if (resolution.kind === "fallback") {
    console.log(
      `[mink] not in a mink project — opening the tui with "${resolution.project.name}".`,
    );
  }
  const startupCwd = resolution.cwd;
  const interval = parseInterval(args);

  if (!isInteractive()) {
    console.log("[mink] mink tui requires an interactive terminal");
    return;
  }

  setActiveDepth(detectColorDepth());
  installSafetyNet();
  enterTui();

  let model: OverviewModel | null = null;
  let lastError: string | null = null;
  let scrollOffset = 0;
  let helpOpen = false;
  let picker: PickerState | null = null;
  let activeCwd = startupCwd;
  let prevScreen: Screen | null = null;

  function rebuild(): void {
    try {
      model = buildOverviewModel(activeCwd);
      lastError = null;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      // Keep the previous good `model` (if any) — a transient aggregator
      // error must never blank or crash an otherwise-working TUI.
    }
  }

  function uiState(): UiState {
    return {
      scrollOffset,
      helpOpen,
      picker,
      lastRefresh: lastError ? `${clock()} — error: ${lastError}` : clock(),
    };
  }

  function repaint(): void {
    // `columns`/`rows` can be 0 (not undefined) on a fresh pty before the
    // kernel delivers window-size info — `||` covers both.
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    if (!model) {
      // First build failed before anything was ever rendered — nothing to
      // compose a full Overview layout from, so show a minimal message.
      const screen = new Screen(cols, rows);
      screen.drawText(2, 1, "[mink] tui: waiting for data…", { fg: "warn" });
      if (lastError) screen.drawText(2, 2, lastError, { fg: "error" }, cols - 4);
      const diff = screen.flushDiff(prevScreen);
      if (diff) process.stdout.write(diff);
      prevScreen = screen;
      return;
    }
    const screen = renderOverview(model, uiState(), cols, rows);
    const diff = screen.flushDiff(prevScreen);
    if (diff) process.stdout.write(diff);
    prevScreen = screen;
  }

  rebuild();
  repaint();

  const timer = setInterval(() => {
    rebuild();
    repaint();
  }, interval);

  function clampScroll(): void {
    const max = Math.max(0, (model?.history.length ?? 0) - 1);
    scrollOffset = Math.max(0, Math.min(scrollOffset, max));
  }

  function teardown(): void {
    clearInterval(timer);
    unsubscribeKeys();
    unsubscribeResize();
    exitTui();
    process.exit(0);
  }

  // Reads the registry fresh on every open (rather than caching) so a
  // project registered/renamed mid-session shows up next time `p` is
  // pressed. Pre-selects the row matching the currently active project.
  function openPicker(): void {
    const deviceId = getOrCreateDeviceId();
    const items: PickerState["items"] = listRegisteredProjects().map((p) => {
      const cwd = p.pathsByDevice[deviceId] ?? p.cwd;
      return { name: p.name, cwd, isCurrent: cwd === activeCwd };
    });
    const currentIndex = items.findIndex((i) => i.isCurrent);
    picker = { open: true, index: currentIndex >= 0 ? currentIndex : 0, items };
    helpOpen = false; // picker and help are mutually exclusive
  }

  function switchToSelected(): void {
    if (!picker) return;
    const item = picker.items[picker.index];
    picker = null;
    if (!item) {
      // Empty registry — nothing to switch to, just close.
      repaint();
      return;
    }
    activeCwd = item.cwd;
    scrollOffset = 0;
    rebuild();
    repaint();
  }

  function handlePickerKey(key: Key): void {
    if (!picker) return;
    if (key.name === "j" || key.name === "down") {
      picker.index = picker.items.length > 0 ? Math.min(picker.index + 1, picker.items.length - 1) : 0;
      repaint();
      return;
    }
    if (key.name === "k" || key.name === "up") {
      picker.index = Math.max(0, picker.index - 1);
      repaint();
      return;
    }
    if (key.name === "return") {
      switchToSelected();
      return;
    }
    if (key.name === "escape" || key.name === "p" || key.name === "q") {
      // Close keys — deliberately do NOT quit here, unlike "q" outside the
      // picker (per spec: the picker owns "q" while it's open).
      picker = null;
      repaint();
      return;
    }
    // Any other key while the picker is open is a no-op — no scroll/refresh
    // fallthrough into the underlying dashboard commands.
  }

  function onKey(key: Key): void {
    if (key.name === "c" && key.ctrl) {
      teardown();
      return;
    }
    if (picker?.open) {
      handlePickerKey(key);
      return;
    }
    if (key.name === "q") {
      teardown();
      return;
    }
    if (key.name === "?") {
      helpOpen = !helpOpen;
      repaint();
      return;
    }
    if (helpOpen) {
      // Any key closes the help overlay (per spec) — swallow it here rather
      // than also acting as a scroll/refresh command underneath.
      helpOpen = false;
      repaint();
      return;
    }
    if (key.name === "p") {
      openPicker();
      repaint();
      return;
    }
    if (key.name === "r") {
      rebuild();
      repaint();
      return;
    }
    if (key.name === "j" || key.name === "down") {
      scrollOffset += 1;
      clampScroll();
      repaint();
      return;
    }
    if (key.name === "k" || key.name === "up") {
      scrollOffset = Math.max(0, scrollOffset - 1);
      repaint();
      return;
    }
    if (key.name === "g") {
      scrollOffset = 0;
      repaint();
      return;
    }
    if (key.name === "G") {
      scrollOffset = Math.max(0, (model?.history.length ?? 0) - 1);
      repaint();
      return;
    }
  }

  const unsubscribeKeys = readKeys(onKey);
  const unsubscribeResize = onResize(() => repaint());
}

export default tui;
