import { describe, test, expect } from "bun:test";
import {
  buildKnowledge,
  generateKnowledgeMarkdown,
} from "../../../src/core/framework-advisor/generate";
import { FRAMEWORK_CATALOG } from "../../../src/core/framework-advisor/catalog";

describe("buildKnowledge", () => {
  test("returns a complete knowledge object", () => {
    const k = buildKnowledge();
    expect(k.version).toBe("1.0.0");
    expect(k.generatedAt).toBeTruthy();
    expect(k.frameworks.length).toBeGreaterThanOrEqual(12);
    expect(k.decisionTree.length).toBeGreaterThan(0);
    expect(k.migrationPrompts.length).toBeGreaterThanOrEqual(12);
  });
});

describe("generateKnowledgeMarkdown", () => {
  const k = buildKnowledge();
  const md = generateKnowledgeMarkdown(k);

  test("contains the title", () => {
    expect(md).toContain("# Framework Advisor Knowledge Base");
  });

  test("contains a comparison matrix section", () => {
    expect(md).toContain("## Comparison Matrix");
  });

  test("comparison matrix has a row for every framework", () => {
    for (const fw of FRAMEWORK_CATALOG) {
      expect(md).toContain(fw.name);
    }
  });

  test("contains decision tree section", () => {
    expect(md).toContain("## Decision Tree");
  });

  test("contains framework details section", () => {
    expect(md).toContain("## Framework Details");
  });

  test("contains migration prompts section", () => {
    expect(md).toContain("## Migration Prompts");
  });

  test("comparison table has correct column headers", () => {
    expect(md).toContain("| Framework |");
    expect(md).toContain("CSS Approach");
    expect(md).toContain("Bundle");
    expect(md).toContain("A11y");
  });

  test("markdown does not contain 'undefined'", () => {
    expect(md).not.toContain("undefined");
  });

  describe("prompt-cache layout", () => {
    test("prefix (first 5 lines) contains no volatile content", () => {
      const prefix = md.split("\n").slice(0, 5).join("\n");
      // No ISO timestamps in the prefix
      expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      // No "Generated:" line at the top
      expect(prefix.toLowerCase()).not.toContain("generated:");
      // Title is the first line
      expect(md.split("\n")[0]).toBe("# Framework Advisor Knowledge Base");
    });

    test("regenerating with different timestamps yields identical prefix bytes", () => {
      const k1 = buildKnowledge();
      // Build a second knowledge object with a different generatedAt to
      // simulate a re-generation at a later time.
      const k2 = { ...k1, generatedAt: new Date(Date.now() + 60_000).toISOString() };

      const md1 = generateKnowledgeMarkdown(k1);
      const md2 = generateKnowledgeMarkdown(k2);

      const footerMarker = "<!-- mink:footer";
      const prefix1 = md1.slice(0, md1.indexOf(footerMarker));
      const prefix2 = md2.slice(0, md2.indexOf(footerMarker));
      expect(prefix1).toBe(prefix2);

      // The footer carries the volatile timestamp.
      expect(md2).toContain(k2.generatedAt);
      expect(md2).toMatch(/<!-- mink:footer/);
    });
  });
});
