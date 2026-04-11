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
});
