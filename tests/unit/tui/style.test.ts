import { describe, expect, test } from "bun:test";
import { detectColorDepth, sgr, reset } from "../../../src/tui/style";

describe("detectColorDepth", () => {
  test("NO_COLOR forces none regardless of other signals", () => {
    expect(detectColorDepth({ NO_COLOR: "1", COLORTERM: "truecolor", TERM: "xterm-256color" })).toBe("none");
  });

  test("NO_COLOR is honored even when set to an empty-looking non-empty value", () => {
    expect(detectColorDepth({ NO_COLOR: "0" })).toBe("none");
  });

  test("COLORTERM=truecolor wins over TERM", () => {
    expect(detectColorDepth({ COLORTERM: "truecolor", TERM: "xterm" })).toBe("truecolor");
  });

  test("COLORTERM=24bit is also truecolor", () => {
    expect(detectColorDepth({ COLORTERM: "24bit", TERM: "xterm" })).toBe("truecolor");
  });

  test("TERM including 256color resolves to 256", () => {
    expect(detectColorDepth({ TERM: "xterm-256color" })).toBe("256");
  });

  test("screen/tmux TERM without COLORTERM resolves to 256", () => {
    expect(detectColorDepth({ TERM: "screen" })).toBe("256");
    expect(detectColorDepth({ TERM: "tmux" })).toBe("256");
  });

  test("dumb TERM resolves to none", () => {
    expect(detectColorDepth({ TERM: "dumb" })).toBe("none");
  });

  test("absent TERM resolves to none", () => {
    expect(detectColorDepth({})).toBe("none");
  });

  test("an otherwise-unrecognized TERM falls back to 256", () => {
    expect(detectColorDepth({ TERM: "xterm" })).toBe("256");
  });
});

describe("sgr", () => {
  test("returns empty string at depth none", () => {
    expect(sgr({ fg: "accent" }, "none")).toBe("");
  });

  test("returns empty string for an empty style", () => {
    expect(sgr({}, "truecolor")).toBe("");
  });

  test("truecolor depth emits a 38;2;r;g;b sequence", () => {
    const out = sgr({ fg: "accent" }, "truecolor");
    expect(out.startsWith("\x1b[")).toBe(true);
    expect(out).toContain("38;2;");
  });

  test("256 depth emits a 38;5;n sequence", () => {
    const out = sgr({ fg: "accent" }, "256");
    expect(out).toContain("38;5;");
  });

  test("bold and dim flags add SGR codes", () => {
    const out = sgr({ bold: true, dim: true }, "256");
    expect(out).toContain("1");
    expect(out).toContain("2");
  });
});

describe("reset", () => {
  test("is the standard SGR reset sequence", () => {
    expect(reset).toBe("\x1b[0m");
  });
});
