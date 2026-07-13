import { describe, expect, test } from "bun:test";
import { charWidth, stringWidth, truncateToWidth, padToWidth } from "../../../src/tui/width";

describe("charWidth", () => {
  test("ASCII is width 1", () => {
    expect(charWidth("a".codePointAt(0)!)).toBe(1);
  });

  test("CJK ideographs are width 2", () => {
    expect(charWidth("日".codePointAt(0)!)).toBe(2);
  });

  test("combining marks are width 0", () => {
    expect(charWidth(0x0301)).toBe(0); // combining acute accent
  });

  test("control characters are width 0", () => {
    expect(charWidth(0x0001)).toBe(0);
  });
});

describe("stringWidth", () => {
  test("CJK string width matches double-wide expectation", () => {
    expect(stringWidth("日本語")).toBe(6);
  });

  test("plain ASCII string width equals length", () => {
    expect(stringWidth("hello")).toBe(5);
  });

  test("emoji ZWJ family sequence counts as a single width-2 cluster", () => {
    // man + ZWJ + woman + ZWJ + girl + ZWJ + boy
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}";
    expect(stringWidth(family)).toBe(2);
  });

  test("combining accent does not add width to its base character", () => {
    expect(stringWidth("é")).toBe(1); // é as e + combining acute
  });

  test("empty string has zero width", () => {
    expect(stringWidth("")).toBe(0);
  });

  test("mixed ASCII + CJK sums correctly", () => {
    expect(stringWidth("ab日本cd")).toBe(2 + 4 + 2);
  });
});

describe("truncateToWidth", () => {
  test("returns the original string when it already fits", () => {
    expect(truncateToWidth("hello", 10)).toBe("hello");
  });

  test("truncates ASCII with an ellipsis", () => {
    expect(truncateToWidth("hello world", 6)).toBe("hello…");
    expect(stringWidth(truncateToWidth("hello world", 6))).toBeLessThanOrEqual(6);
  });

  test("never splits a wide character in half", () => {
    const out = truncateToWidth("日本語", 5);
    expect(stringWidth(out)).toBeLessThanOrEqual(5);
    // Each retained character must be a whole grapheme from the source.
    for (const ch of out.replace("…", "")) {
      expect("日本語".includes(ch)).toBe(true);
    }
  });

  test("max of 0 returns empty string", () => {
    expect(truncateToWidth("hello", 0)).toBe("");
  });

  test("custom ellipsis is honored", () => {
    const out = truncateToWidth("hello world", 7, "...");
    expect(stringWidth(out)).toBeLessThanOrEqual(7);
    expect(out.endsWith("...")).toBe(true);
  });
});

describe("padToWidth", () => {
  test("pads left-aligned by default", () => {
    expect(padToWidth("ab", 5)).toBe("ab   ");
  });

  test("pads right-aligned", () => {
    expect(padToWidth("ab", 5, "right")).toBe("   ab");
  });

  test("no-ops when already at or above target width", () => {
    expect(padToWidth("hello", 3)).toBe("hello");
  });

  test("accounts for wide-character width, not string length", () => {
    const out = padToWidth("日本", 6); // width 4, needs 2 more columns
    expect(out).toBe("日本  ");
  });
});
