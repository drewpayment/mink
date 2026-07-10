import { describe, test, expect } from "bun:test";
import { nextScreenIndex, createScreenStateStore, type TuiScreen } from "../../../src/tui/screen-registry";

function makeScreens(n: number): TuiScreen[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `s${i}`,
    title: `Screen ${i}`,
    hotkey: String(i + 1),
    buildModel: () => null,
    render: () => {
      throw new Error("not used in this test");
    },
  }));
}

// ── nextScreenIndex ──────────────────────────────────────────────────────

describe("nextScreenIndex", () => {
  const screens = makeScreens(3);

  test("Tab advances to the next screen, wrapping at the end", () => {
    expect(nextScreenIndex(0, { name: "tab", ctrl: false }, screens)).toBe(1);
    expect(nextScreenIndex(1, { name: "tab", ctrl: false }, screens)).toBe(2);
    expect(nextScreenIndex(2, { name: "tab", ctrl: false }, screens)).toBe(0);
  });

  test("Shift-Tab moves to the previous screen, wrapping at the start", () => {
    expect(nextScreenIndex(2, { name: "tab", ctrl: false, shift: true }, screens)).toBe(1);
    expect(nextScreenIndex(0, { name: "tab", ctrl: false, shift: true }, screens)).toBe(2);
  });

  test("a digit matching a screen's hotkey jumps directly to it", () => {
    expect(nextScreenIndex(0, { name: "2", ctrl: false }, screens)).toBe(1);
    expect(nextScreenIndex(1, { name: "3", ctrl: false }, screens)).toBe(2);
    // Jumping to the already-active screen's own hotkey is a no-op index (still resolved, caller decides whether to act).
    expect(nextScreenIndex(0, { name: "1", ctrl: false }, screens)).toBe(0);
  });

  test("a key that isn't Tab/Shift-Tab or a registered hotkey returns null", () => {
    expect(nextScreenIndex(0, { name: "j", ctrl: false }, screens)).toBeNull();
    expect(nextScreenIndex(0, { name: "9", ctrl: false }, screens)).toBeNull();
    expect(nextScreenIndex(0, { name: "p", ctrl: false }, screens)).toBeNull();
  });

  test("an empty screens array always returns null", () => {
    expect(nextScreenIndex(0, { name: "tab", ctrl: false }, [])).toBeNull();
    expect(nextScreenIndex(0, { name: "1", ctrl: false }, [])).toBeNull();
  });
});

// ── createScreenStateStore ───────────────────────────────────────────────

describe("createScreenStateStore", () => {
  test("returns the same object on repeated get() calls for the same id, so mutations persist", () => {
    const store = createScreenStateStore();
    const first = store.get("overview");
    first.scrollOffset = 7;

    const second = store.get("overview");
    expect(second).toBe(first);
    expect(second.scrollOffset).toBe(7);
  });

  test("different ids get independent state — switching tabs away and back preserves each screen's own scroll position", () => {
    const store = createScreenStateStore();
    const overview = store.get("overview");
    overview.scrollOffset = 5;

    const sessions = store.get("sessions");
    sessions.scrollOffset = 12;

    // Simulate tabbing back to "overview" — its state must be untouched by visiting "sessions".
    expect(store.get("overview").scrollOffset).toBe(5);
    expect(store.get("sessions").scrollOffset).toBe(12);
  });

  test("a freshly created id defaults to scrollOffset 0", () => {
    const store = createScreenStateStore();
    expect(store.get("new-screen").scrollOffset).toBe(0);
  });
});
