import { describe, expect, test } from "bun:test";
import { Screen } from "../../../src/tui/screen";

describe("Screen basics", () => {
  test("starts fully blank", () => {
    const screen = new Screen(5, 2);
    expect(screen.toString()).toBe("     \n     ");
  });

  test("set() places a character", () => {
    const screen = new Screen(3, 1);
    screen.set(1, 0, "x");
    expect(screen.toString()).toBe(" x ");
  });

  test("set() ignores out-of-bounds coordinates", () => {
    const screen = new Screen(3, 1);
    expect(() => screen.set(10, 10, "x")).not.toThrow();
    expect(screen.toString()).toBe("   ");
  });

  test("a wide character occupies two cells", () => {
    const screen = new Screen(4, 1);
    screen.set(0, 0, "日"); // occupies columns 0 and 1
    screen.set(2, 0, "!"); // column 2; column 3 stays blank
    expect(screen.toString()).toBe("日! ");
  });

  test("a wide character dropped at the last column does not corrupt the row", () => {
    const screen = new Screen(3, 1);
    screen.set(2, 0, "日"); // needs columns 2 and 3, but only 3 columns exist (0,1,2)
    expect(screen.toString()).toBe("   ");
  });

  test("drawText clips at the screen edge", () => {
    const screen = new Screen(5, 1);
    screen.drawText(3, 0, "hello");
    expect(screen.toString()).toBe("   he");
  });

  test("drawText respects maxWidth", () => {
    const screen = new Screen(10, 1);
    screen.drawText(0, 0, "hello world", null, 5);
    expect(screen.toString()).toBe("hello     ");
  });

  test("resize reallocates a blank grid at the new size", () => {
    const screen = new Screen(3, 1);
    screen.set(0, 0, "x");
    screen.resize(2, 2);
    expect(screen.cols).toBe(2);
    expect(screen.rows).toBe(2);
    expect(screen.toString()).toBe("  \n  ");
  });
});

describe("Screen.flushDiff", () => {
  test("emits nothing for two identical frames", () => {
    const a = new Screen(4, 2);
    a.drawText(0, 0, "abcd");
    const b = new Screen(4, 2);
    b.drawText(0, 0, "abcd");
    expect(b.flushDiff(a)).toBe("");
  });

  test("emits ANSI only for the changed cell", () => {
    const a = new Screen(4, 1);
    a.drawText(0, 0, "abcd");
    const b = new Screen(4, 1);
    b.drawText(0, 0, "abXd");

    const diff = b.flushDiff(a);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff).toContain("X");
    // Cursor should move to column 3 (1-indexed), row 1.
    expect(diff).toContain("\x1b[1;3H");
    // Unchanged columns 0, 1, 3 must not appear as freshly-written content.
    expect(diff).not.toContain("a");
    expect(diff).not.toContain("d");
  });

  test("null prev forces a full repaint", () => {
    const screen = new Screen(2, 1);
    screen.drawText(0, 0, "ab");
    const diff = screen.flushDiff(null);
    expect(diff).toContain("a");
    expect(diff).toContain("b");
  });

  test("a size change forces a full repaint even with a non-null prev", () => {
    const a = new Screen(2, 1);
    a.drawText(0, 0, "ab");
    const b = new Screen(3, 1);
    b.drawText(0, 0, "abc");
    const diff = b.flushDiff(a);
    expect(diff).toContain("a");
    expect(diff).toContain("b");
    expect(diff).toContain("c");
  });

  test("never emits a full-screen clear sequence", () => {
    const a = new Screen(4, 1);
    a.drawText(0, 0, "abcd");
    const b = new Screen(4, 1);
    b.drawText(0, 0, "abXd");
    expect(b.flushDiff(a)).not.toContain("\x1b[2J");
    expect(b.flushDiff(null)).not.toContain("\x1b[2J");
  });
});
