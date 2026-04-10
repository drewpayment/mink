import { describe, expect, test } from "bun:test";
import { analyzePreWrite } from "../../src/commands/pre-write";

describe("analyzePreWrite", () => {
  test("DNR literal match triggers warning", () => {
    const entries = ['[2026-03-10] Never use "var"'];
    const content = "var x = 1;";

    const result = analyzePreWrite("src/app.ts", content, entries);

    expect(result.patternMatches).toHaveLength(1);
    expect(result.patternMatches[0].matchedText).toBe("var");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("var");
    expect(result.warnings[0]).toContain("Do-Not-Repeat");
  });

  test("DNR word-boundary match triggers warning", () => {
    const entries = ["[2026-03-11] Avoid console.log"];
    const content = "function debug() { console.log('test'); }";

    const result = analyzePreWrite("src/app.ts", content, entries);

    expect(result.patternMatches.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.warnings[0]).toContain("Do-Not-Repeat");
  });

  test("empty DNR entries produce no warnings", () => {
    const result = analyzePreWrite("src/app.ts", "const x = 1;", []);

    expect(result.patternMatches).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test("empty write content produces no matches", () => {
    const entries = ['[2026-03-10] Never use "var"'];
    const result = analyzePreWrite("src/app.ts", "", entries);

    expect(result.patternMatches).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test("multiple DNR entries can produce multiple matches", () => {
    const entries = [
      '[2026-03-10] Never use "var"',
      '[2026-03-11] Never use "any"',
    ];
    const content = "var x: any = 1;";

    const result = analyzePreWrite("src/app.ts", content, entries);

    expect(result.patternMatches.length).toBeGreaterThanOrEqual(2);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
  });

  test("vague DNR entry with no extractable pattern produces no warnings", () => {
    const entries = ["Be careful with auth"];
    const content = "const auth = new AuthService();";

    const result = analyzePreWrite("src/app.ts", content, entries);

    // "Be careful with auth" has no quoted strings and no "never use"/"avoid" trigger
    expect(result.patternMatches).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test("bug summary stub returns null", () => {
    const result = analyzePreWrite("src/app.ts", "const x = 1;", []);

    expect(result.bugSummary).toBeNull();
  });

  test("pattern matching works on partial content from Edit tool", () => {
    const entries = ['[2026-03-10] Never use "var"'];
    // Simulates new_string from an Edit tool — just a small replacement
    const content = "var newVal = oldVal + 1;";

    const result = analyzePreWrite("src/app.ts", content, entries);

    expect(result.patternMatches).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
  });

  test("non-matching content produces no warnings", () => {
    const entries = ['[2026-03-10] Never use "var"'];
    const content = "const x = 1;\nlet y = 2;";

    const result = analyzePreWrite("src/app.ts", content, entries);

    expect(result.patternMatches).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
