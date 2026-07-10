import { describe, expect, test } from "bun:test";
import { Screen } from "../../../src/tui/screen";
import { drawBox, statTile, sparkline, hbar, stackedBar, drawTable, drawHelpOverlay } from "../../../src/tui/widgets";

describe("drawBox", () => {
  test("draws corners and a title in the top border", () => {
    const screen = new Screen(12, 4);
    drawBox(screen, { x: 0, y: 0, w: 12, h: 4, title: "Stats" });
    const lines = screen.toString().split("\n");
    expect(lines[0].startsWith("┌")).toBe(true);
    expect(lines[0].endsWith("┐")).toBe(true);
    expect(lines[0]).toContain("Stats");
    expect(lines[3].startsWith("└")).toBe(true);
    expect(lines[3].endsWith("┘")).toBe(true);
    expect(lines[1].startsWith("│")).toBe(true);
    expect(lines[1].endsWith("│")).toBe(true);
  });

  test("does nothing for degenerate sizes", () => {
    const screen = new Screen(5, 5);
    expect(() => drawBox(screen, { x: 0, y: 0, w: 1, h: 1 })).not.toThrow();
    expect(screen.toString()).toBe("     \n     \n     \n     \n     ");
  });

  test("truncates an overlong title instead of overflowing the border", () => {
    const screen = new Screen(10, 3);
    drawBox(screen, { x: 0, y: 0, w: 10, h: 3, title: "A Very Long Title That Overflows" });
    const line0 = screen.toString().split("\n")[0];
    expect(line0.length).toBeLessThanOrEqual(10);
    expect(line0.startsWith("┌")).toBe(true);
    expect(line0.endsWith("┐")).toBe(true);
  });
});

describe("statTile", () => {
  test("draws label, value, and sub on consecutive rows", () => {
    const screen = new Screen(20, 3);
    statTile(screen, { x: 0, y: 0, w: 20, label: "TOTAL TOKENS SAVED", value: "1.23M", sub: "heuristic/measured" });
    const lines = screen.toString().split("\n");
    expect(lines[0]).toContain("TOTAL TOKENS SAVED");
    expect(lines[1]).toContain("1.23M");
    expect(lines[2]).toContain("heuristic/measured");
  });

  test("omits the sub line when not provided", () => {
    const screen = new Screen(20, 3);
    statTile(screen, { x: 0, y: 0, w: 20, label: "Sessions", value: "42" });
    const lines = screen.toString().split("\n");
    expect(lines[2]).toBe(" ".repeat(20));
  });
});

describe("sparkline", () => {
  test("empty series renders as blank space", () => {
    expect(sparkline([], 5)).toBe("     ");
  });

  test("all-zero series renders a flat baseline", () => {
    expect(sparkline([0, 0, 0, 0], 4)).toBe("▁▁▁▁");
  });

  test("width 0 returns an empty string", () => {
    expect(sparkline([1, 2, 3], 0)).toBe("");
  });

  test("output length always matches the requested width", () => {
    expect(sparkline([1, 5, 2, 9, 3], 3).length).toBe(3);
    expect(sparkline([1, 5, 2], 8).length).toBe(8);
  });

  test("an ascending series ends higher than it starts", () => {
    const SPARK_CHARS = "▁▂▃▄▅▆▇█";
    const out = sparkline([1, 2, 3, 4, 5, 6, 7, 8], 8);
    expect(SPARK_CHARS.indexOf(out[out.length - 1])).toBeGreaterThan(SPARK_CHARS.indexOf(out[0]));
  });
});

describe("hbar", () => {
  test("zero value renders all empty cells", () => {
    expect(hbar(0, 10, 5)).toBe("░░░░░");
  });

  test("full value renders all filled cells", () => {
    expect(hbar(10, 10, 5)).toBe("█████");
  });

  test("half value renders roughly half filled", () => {
    const out = hbar(5, 10, 10);
    expect(out.length).toBe(10);
    expect(out.slice(0, 5)).toBe("█████");
  });

  test("a zero max does not divide by zero", () => {
    expect(hbar(5, 0, 4)).toBe("░░░░");
  });

  test("width 0 returns an empty string", () => {
    expect(hbar(5, 10, 0)).toBe("");
  });
});

describe("stackedBar", () => {
  test("splits width proportionally across parts by style", () => {
    const screen = new Screen(10, 1);
    stackedBar(screen, 0, 0, [
      { value: 5, styleKey: "good" },
      { value: 5, styleKey: "warn" },
    ], 10);
    expect(screen.toString()).toBe("██████████");
  });

  test("zero total renders a dim empty track", () => {
    const screen = new Screen(6, 1);
    stackedBar(screen, 0, 0, [{ value: 0, styleKey: "good" }], 6);
    expect(screen.toString()).toBe("░░░░░░");
  });
});

describe("drawTable", () => {
  const columns = [
    { label: "ID", width: 4 },
    { label: "Tokens", width: 8, align: "right" as const },
  ];

  test("draws a header row and body rows within the visible window", () => {
    const screen = new Screen(20, 4); // 1 header + 3 body rows visible
    drawTable(screen, {
      x: 0,
      y: 0,
      w: 20,
      h: 4,
      columns,
      rows: [
        ["a1", "100"],
        ["a2", "200"],
        ["a3", "300"],
        ["a4", "400"],
      ],
      scrollOffset: 0,
    });
    const lines = screen.toString().split("\n");
    expect(lines[0]).toContain("ID");
    expect(lines[0]).toContain("Tokens");
    expect(lines[1]).toContain("a1");
    expect(lines[3]).toContain("a3");
  });

  test("scroll offset shifts the visible window and shows a down indicator", () => {
    const screen = new Screen(20, 3); // 1 header + 2 body rows visible
    drawTable(screen, {
      x: 0,
      y: 0,
      w: 20,
      h: 3,
      columns,
      rows: [["a1", "1"], ["a2", "2"], ["a3", "3"], ["a4", "4"]],
      scrollOffset: 1,
    });
    const lines = screen.toString().split("\n");
    expect(lines[1]).toContain("a2");
    expect(lines[2]).toContain("a3");
    expect(lines[1]).not.toContain("a1");
  });

  test("shows an up indicator once scrolled past the top", () => {
    const screen = new Screen(20, 3);
    drawTable(screen, {
      x: 0,
      y: 0,
      w: 20,
      h: 3,
      columns,
      rows: [["a1", "1"], ["a2", "2"], ["a3", "3"], ["a4", "4"]],
      scrollOffset: 2,
    });
    const headerLine = screen.toString().split("\n")[0];
    expect(headerLine.endsWith("▲")).toBe(true);
  });
});

describe("drawHelpOverlay", () => {
  test("renders a centered box containing every key/description pair", () => {
    const screen = new Screen(40, 20);
    drawHelpOverlay(screen, [
      ["q", "quit"],
      ["?", "help"],
      ["r", "refresh"],
    ]);
    const text = screen.toString();
    expect(text).toContain("quit");
    expect(text).toContain("help");
    expect(text).toContain("refresh");
    expect(text).toContain("┌");
    expect(text).toContain("┘");
  });
});
