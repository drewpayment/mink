import { resolveStartupCwd } from "./dashboard";
import { isInteractive, enterTui, exitTui, installSafetyNet, onResize, readKeys, type Key } from "../tui/term";
import { detectColorDepth, setActiveDepth } from "../tui/style";
import { Screen } from "../tui/screen";
import { buildOverviewModel, type OverviewModel } from "../tui/overview-model";
import { renderOverview, type UiState } from "../tui/overview-screen";

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
  let prevScreen: Screen | null = null;

  function rebuild(): void {
    try {
      model = buildOverviewModel(startupCwd);
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
      lastRefresh: lastError ? `${clock()} — error: ${lastError}` : clock(),
    };
  }

  function repaint(): void {
    const cols = process.stdout.columns ?? 80;
    const rows = process.stdout.rows ?? 24;
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

  function onKey(key: Key): void {
    if ((key.name === "c" && key.ctrl) || key.name === "q") {
      teardown();
      return;
    }
    if (key.name === "?") {
      helpOpen = !helpOpen;
      repaint();
      return;
    }
    if (key.name === "r") {
      rebuild();
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
