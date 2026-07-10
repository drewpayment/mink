import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { renderShell, renderTooSmall, contentRows, MIN_COLS, MIN_ROWS, type PickerItem, type ShellState } from "../../src/tui/shell";
import { SCREENS, type TuiScreen, type ScreenUiState } from "../../src/tui/screen-registry";
import { Screen } from "../../src/tui/screen";
import { setActiveDepth, type ColorDepth } from "../../src/tui/style";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeState(overrides: Partial<ScreenUiState> = {}): ScreenUiState {
  return { scrollOffset: 0, selectedIndex: 0, lastRefresh: "14:32:05", ...overrides };
}

function makeShellState(overrides: Partial<ShellState> = {}): ShellState {
  return { helpOpen: false, picker: null, ...overrides };
}

/** A minimal fake screen for exercising multi-tab shell behavior — SCREENS only has "overview" registered so far. */
function makeFakeScreen(id: string, hotkey: string, title: string, helpKeys?: Array<[string, string]>): TuiScreen<{ label: string }> {
  return {
    id,
    title,
    hotkey,
    buildModel: () => ({ label: `${id}-model` }),
    render: (model, state, cols, rows) => {
      const screen = new Screen(cols, rows);
      screen.drawText(1, 1, `${title} content: ${model.label} scroll=${state.scrollOffset}`);
      return screen;
    },
    helpKeys,
  };
}

const FAKE_SCREENS = [
  makeFakeScreen("a", "1", "Alpha", [["x", "do alpha thing"]]),
  makeFakeScreen("b", "2", "Beta"),
  makeFakeScreen("c", "3", "Gamma"),
];

// ── contentRows ──────────────────────────────────────────────────────────

describe("contentRows", () => {
  test("reserves exactly the tab bar and footer rows", () => {
    expect(contentRows(24)).toBe(22);
    expect(contentRows(40)).toBe(38);
  });

  test("never goes negative for degenerate sizes", () => {
    expect(contentRows(0)).toBe(0);
    expect(contentRows(1)).toBe(0);
  });
});

// ── Tab bar ──────────────────────────────────────────────────────────────

describe("renderShell — tab bar", () => {
  test("renders every registered screen's hotkey and title in order, separated by │", () => {
    const model = FAKE_SCREENS[0]!.buildModel("/tmp");
    const frame = renderShell(FAKE_SCREENS, 0, model, makeState(), makeShellState(), 80, 24).toString();
    const tabRow = frame.split("\n")[0]!;
    expect(tabRow).toContain("1 Alpha");
    expect(tabRow).toContain("2 Beta");
    expect(tabRow).toContain("3 Gamma");
    expect(tabRow.indexOf("1 Alpha")).toBeLessThan(tabRow.indexOf("2 Beta"));
    expect(tabRow.indexOf("2 Beta")).toBeLessThan(tabRow.indexOf("3 Gamma"));
    expect(tabRow).toContain("│");
  });

  test("only registered screens render — an unregistered future tab is simply absent", () => {
    const frame = renderShell(SCREENS, 0, null, makeState(), makeShellState(), 80, 24).toString();
    const tabRow = frame.split("\n")[0]!;
    expect(tabRow).toContain("1 Overview");
    expect(tabRow).not.toContain("Sessions");
    expect(tabRow).not.toContain("Compression");
  });

  describe("active-tab styling", () => {
    let originalDepth: ColorDepth;
    beforeEach(() => {
      originalDepth = "256";
      setActiveDepth("256");
    });
    afterEach(() => {
      setActiveDepth(originalDepth);
    });

    test("the active tab is bold+accent; inactive tabs are plain dim", () => {
      const model = FAKE_SCREENS[0]!.buildModel("/tmp");
      const activeFirst = renderShell(FAKE_SCREENS, 0, model, makeState(), makeShellState(), 80, 24).flushDiff(null);
      const activeSecond = renderShell(FAKE_SCREENS, 1, model, makeState(), makeShellState(), 80, 24).flushDiff(null);

      // accent = "38;5;75", dim = "38;5;60" at 256-color depth (style.ts PALETTE).
      expect(activeFirst).toContain("1;38;5;75m"); // bold+accent somewhere (tab 1 active)
      expect(activeFirst).toContain("38;5;60m"); // dim somewhere (tabs 2/3 inactive)
      expect(activeSecond).toContain("1;38;5;75m"); // bold+accent still present (tab 2 now active)
      // The two frames differ — moving the active tab changes the emitted styling.
      expect(activeFirst).not.toBe(activeSecond);
    });
  });
});

// ── Footer ───────────────────────────────────────────────────────────────

describe("renderShell — footer", () => {
  test("shows key hints and the last-refresh time", () => {
    const model = FAKE_SCREENS[0]!.buildModel("/tmp");
    const frame = renderShell(FAKE_SCREENS, 0, model, makeState({ lastRefresh: "14:32:05" }), makeShellState(), 80, 24).toString();
    const footerRow = frame.split("\n").at(-1)!;
    expect(footerRow).toContain("q quit");
    expect(footerRow).toContain("? help");
    expect(footerRow).toContain("p projects");
    expect(footerRow).toContain("r refresh");
    expect(footerRow).toContain("updated 14:32:05");
  });

  test("shows a Tab/1-N screens hint only when more than one screen is registered", () => {
    const multi = renderShell(FAKE_SCREENS, 0, FAKE_SCREENS[0]!.buildModel("/tmp"), makeState(), makeShellState(), 80, 24).toString();
    expect(multi.split("\n").at(-1)).toContain("Tab/1-3 screens");

    const single = renderShell(SCREENS, 0, null, makeState(), makeShellState(), 80, 24).toString();
    expect(single.split("\n").at(-1)).not.toContain("Tab/1-");
  });
});

// ── Active screen composition ─────────────────────────────────────────────

describe("renderShell — active screen content", () => {
  test("blits the active screen's own render output into the content area", () => {
    const model = FAKE_SCREENS[1]!.buildModel("/tmp");
    const frame = renderShell(FAKE_SCREENS, 1, model, makeState({ scrollOffset: 3 }), makeShellState(), 80, 24).toString();
    expect(frame).toContain("Beta content: b-model scroll=3");
  });

  test("shows a waiting message instead of the screen when model is null", () => {
    const frame = renderShell(FAKE_SCREENS, 0, null, makeState(), makeShellState(), 80, 24).toString();
    expect(frame).toContain("waiting for data");
  });

  test("full frame is exactly 80x24 / 120x40", () => {
    const at80 = renderShell(FAKE_SCREENS, 0, FAKE_SCREENS[0]!.buildModel("/tmp"), makeState(), makeShellState(), 80, 24).toString();
    const lines80 = at80.split("\n");
    expect(lines80).toHaveLength(24);
    for (const line of lines80) expect(line.length).toBe(80);

    const at120 = renderShell(FAKE_SCREENS, 0, FAKE_SCREENS[0]!.buildModel("/tmp"), makeState(), makeShellState(), 120, 40).toString();
    const lines120 = at120.split("\n");
    expect(lines120).toHaveLength(40);
    for (const line of lines120) expect(line.length).toBe(120);
  });
});

// ── Help overlay ─────────────────────────────────────────────────────────

describe("renderShell — help overlay", () => {
  test("combines shell-level keys with the active screen's helpKeys", () => {
    const frame = renderShell(FAKE_SCREENS, 0, FAKE_SCREENS[0]!.buildModel("/tmp"), makeState(), makeShellState({ helpOpen: true }), 80, 24).toString();
    expect(frame).toContain("Help");
    expect(frame).toContain("quit");
    expect(frame).toContain("toggle this help");
    expect(frame).toContain("do alpha thing"); // Alpha's own helpKeys entry
  });

  test("switching the active screen changes which extra helpKeys show", () => {
    const frame = renderShell(FAKE_SCREENS, 1, FAKE_SCREENS[1]!.buildModel("/tmp"), makeState(), makeShellState({ helpOpen: true }), 80, 24).toString();
    expect(frame).not.toContain("do alpha thing"); // Beta has no helpKeys
  });

  test("no overlay when helpOpen is false", () => {
    const frame = renderShell(FAKE_SCREENS, 0, FAKE_SCREENS[0]!.buildModel("/tmp"), makeState(), makeShellState({ helpOpen: false }), 80, 24).toString();
    expect(frame).not.toContain("toggle this help");
  });
});

// ── Project picker overlay ───────────────────────────────────────────────

function makePickerItems(n: number, currentIndex = 0): PickerItem[] {
  return Array.from({ length: n }, (_, i) => ({
    name: `proj-${i}`,
    cwd: `/home/dev/proj-${i}`,
    isCurrent: i === currentIndex,
  }));
}

describe("renderShell — project picker overlay", () => {
  const model = FAKE_SCREENS[0]!.buildModel("/tmp");

  test("draws a centered box with items, a selection marker, and the current-project marker", () => {
    const items = makePickerItems(3, 1);
    const frame = renderShell(
      FAKE_SCREENS,
      0,
      model,
      makeState(),
      makeShellState({ picker: { open: true, index: 1, items } }),
      80,
      24,
    ).toString();

    expect(frame).toContain("Projects");
    expect(frame).toContain("proj-0");
    expect(frame).toContain("proj-1  (current)");
    expect(frame).toContain("proj-2");
    expect(frame).toContain("▸"); // selection marker on the highlighted row
  });

  test("no overlay when picker is null or closed", () => {
    const closed = renderShell(FAKE_SCREENS, 0, model, makeState(), makeShellState({ picker: null }), 80, 24).toString();
    expect(closed).not.toContain("Projects");

    const items = makePickerItems(2);
    const explicitlyClosed = renderShell(
      FAKE_SCREENS,
      0,
      model,
      makeState(),
      makeShellState({ picker: { open: false, index: 0, items } }),
      80,
      24,
    ).toString();
    expect(explicitlyClosed).not.toContain("Projects");
  });

  test("a selection index beyond the item count clamps rather than throwing", () => {
    const items = makePickerItems(3);
    expect(() =>
      renderShell(FAKE_SCREENS, 0, model, makeState(), makeShellState({ picker: { open: true, index: 999, items } }), 80, 24),
    ).not.toThrow();
  });

  test("an empty registry shows a friendly placeholder instead of a blank list", () => {
    const frame = renderShell(
      FAKE_SCREENS,
      0,
      model,
      makeState(),
      makeShellState({ picker: { open: true, index: 0, items: [] } }),
      80,
      24,
    ).toString();
    expect(frame).toContain("Projects");
    expect(frame).toContain("No registered projects");
  });

  test("picker takes precedence over the help overlay when both are open", () => {
    const items = makePickerItems(2);
    const frame = renderShell(
      FAKE_SCREENS,
      0,
      model,
      makeState(),
      makeShellState({ helpOpen: true, picker: { open: true, index: 0, items } }),
      80,
      24,
    ).toString();
    expect(frame).toContain("Projects");
    expect(frame).not.toContain("Help");
  });
});

// ── Too-small terminal ───────────────────────────────────────────────────

describe("renderTooSmall / renderShell too-small fallback", () => {
  test("shows a centered message with the minimum size", () => {
    const frame = renderTooSmall(60, 15).toString();
    expect(frame).toContain("Terminal too small");
    expect(frame).toContain(`${MIN_COLS}×${MIN_ROWS}`);
    expect(frame).toContain("60×15");
  });

  test("renderShell itself falls back to the too-small message below the minimum", () => {
    const frame = renderShell(SCREENS, 0, null, makeState(), makeShellState(), 60, 15).toString();
    expect(frame).toContain("Terminal too small");
  });

  test("does not throw at degenerate sizes", () => {
    expect(() => renderTooSmall(0, 0)).not.toThrow();
    expect(() => renderTooSmall(1, 1)).not.toThrow();
  });
});
