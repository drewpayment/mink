import { describe, test, expect } from "bun:test";
import { extractPatterns, matchPatterns } from "../../src/core/pattern-engine";
import type { ExtractedPattern } from "../../src/types/learning-memory";

// ─── extractPatterns ────────────────────────────────────────────────────────

describe("extractPatterns", () => {
  test("extracts double-quoted string as literal", () => {
    const results = extractPatterns(['[2026-04-10] Never use "var"']);
    const literals = results.filter((p) => p.type === "literal");
    expect(literals).toHaveLength(1);
    expect(literals[0].pattern).toBe("var");
  });

  test("extracts single-quoted string as literal", () => {
    const results = extractPatterns(["Avoid using 'eval' at all costs"]);
    const literals = results.filter((p) => p.type === "literal");
    expect(literals).toHaveLength(1);
    expect(literals[0].pattern).toBe("eval");
  });

  test("extracts multiple quoted strings from one entry as literals", () => {
    const results = extractPatterns(['Use "const" not "var" ever']);
    const literals = results.filter((p) => p.type === "literal");
    expect(literals).toHaveLength(2);
    const patterns = literals.map((p) => p.pattern);
    expect(patterns).toContain("const");
    expect(patterns).toContain("var");
  });

  test("extracts 'never use' phrase as word-boundary", () => {
    const results = extractPatterns(["Never use default exports"]);
    const wb = results.filter((p) => p.type === "word-boundary");
    expect(wb).toHaveLength(1);
    expect(wb[0].pattern).toBe("default exports");
  });

  test("extracts 'avoid' phrase as word-boundary", () => {
    const results = extractPatterns([
      "Avoid mocking the database in integration tests",
    ]);
    const wb = results.filter((p) => p.type === "word-boundary");
    expect(wb).toHaveLength(1);
    expect(wb[0].pattern).toBe("mocking the database in integration tests");
  });

  test("phrase stops at em-dash (—)", () => {
    const results = extractPatterns(["Never use var — it causes hoisting issues"]);
    const wb = results.filter((p) => p.type === "word-boundary");
    expect(wb.length).toBeGreaterThan(0);
    // The phrase should not include content after the dash
    for (const p of wb) {
      expect(p.pattern).not.toContain("hoisting");
    }
  });

  test("phrase stops at hyphen (-)", () => {
    const results = extractPatterns(["Avoid callbacks - prefer promises instead"]);
    const wb = results.filter((p) => p.type === "word-boundary");
    expect(wb.length).toBeGreaterThan(0);
    for (const p of wb) {
      expect(p.pattern).not.toContain("prefer");
    }
  });

  test("phrase stops at period (.)", () => {
    const results = extractPatterns(["Never use var. It causes bugs."]);
    const wb = results.filter((p) => p.type === "word-boundary");
    expect(wb.length).toBeGreaterThan(0);
    for (const p of wb) {
      expect(p.pattern).not.toContain("It causes");
    }
  });

  test("both quoted and phrase patterns come from one entry", () => {
    const results = extractPatterns(['Never use "var" in any module']);
    const literals = results.filter((p) => p.type === "literal");
    const wb = results.filter((p) => p.type === "word-boundary");
    // Quoted portion extracted as literal
    expect(literals).toHaveLength(1);
    expect(literals[0].pattern).toBe("var");
    // Phrase extracted (minus quoted content) as word-boundary
    expect(wb).toHaveLength(1);
    expect(wb[0].pattern).not.toContain('"var"');
  });

  test("entry with no extractable pattern produces nothing", () => {
    const results = extractPatterns(["This is just a general note"]);
    expect(results).toHaveLength(0);
  });

  test("multiple entries processed independently", () => {
    const results = extractPatterns([
      'Never use "eval"',
      "Avoid global state",
      "Some general note",
    ]);
    const literals = results.filter((p) => p.type === "literal");
    const wb = results.filter((p) => p.type === "word-boundary");
    expect(literals).toHaveLength(1);
    expect(literals[0].pattern).toBe("eval");
    expect(wb).toHaveLength(1);
    expect(wb[0].pattern).toBe("global state");
  });

  test("empty input array returns empty array", () => {
    expect(extractPatterns([])).toEqual([]);
  });

  test("sourceEntry is set to the original entry string", () => {
    const entry = 'Never use "var"';
    const results = extractPatterns([entry]);
    for (const p of results) {
      expect(p.sourceEntry).toBe(entry);
    }
  });
});

// ─── matchPatterns ───────────────────────────────────────────────────────────

describe("matchPatterns", () => {
  const literalPat: ExtractedPattern = {
    type: "literal",
    pattern: "var",
    sourceEntry: 'Never use "var"',
  };

  const wbPat: ExtractedPattern = {
    type: "word-boundary",
    pattern: "default exports",
    sourceEntry: "Never use default exports",
  };

  test("literal pattern matches in content (case-sensitive)", () => {
    const matches = matchPatterns([literalPat], "let x = var + 1;");
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedText).toBe("var");
    expect(matches[0].index).toBe(8);
  });

  test("literal pattern misses on different case", () => {
    const matches = matchPatterns([literalPat], "let x = VAR + 1;");
    expect(matches).toHaveLength(0);
  });

  test("word-boundary pattern matches case-insensitively", () => {
    const matches = matchPatterns(
      [wbPat],
      "You should not use Default Exports in this module"
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].matchedText.toLowerCase()).toBe("default exports");
  });

  test("no match when pattern is absent", () => {
    const matches = matchPatterns([literalPat], "const x = 1;");
    expect(matches).toHaveLength(0);
  });

  test("multiple patterns match same content", () => {
    const pat2: ExtractedPattern = {
      type: "literal",
      pattern: "eval",
      sourceEntry: 'Never use "eval"',
    };
    const matches = matchPatterns(
      [literalPat, pat2],
      "Never use var or eval in production"
    );
    expect(matches).toHaveLength(2);
    const texts = matches.map((m) => m.matchedText);
    expect(texts).toContain("var");
    expect(texts).toContain("eval");
  });

  test("empty content returns empty array", () => {
    const matches = matchPatterns([literalPat], "");
    expect(matches).toHaveLength(0);
  });

  test("empty patterns array returns empty array", () => {
    const matches = matchPatterns([], "some content with var");
    expect(matches).toHaveLength(0);
  });

  test("pattern match carries reference to original pattern", () => {
    const matches = matchPatterns([literalPat], "use var here");
    expect(matches[0].pattern).toBe(literalPat);
  });

  test("word-boundary does not match substring within word", () => {
    // "var" as word-boundary should not match inside "variable"
    const wbVarPat: ExtractedPattern = {
      type: "word-boundary",
      pattern: "var",
      sourceEntry: "Never use var",
    };
    const matches = matchPatterns([wbVarPat], "avoid variables");
    expect(matches).toHaveLength(0);
  });
});
