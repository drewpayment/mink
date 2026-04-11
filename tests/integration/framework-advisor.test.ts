import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildKnowledge,
  generateKnowledgeMarkdown,
} from "../../src/core/framework-advisor/generate";
import { validateKnowledge } from "../../src/core/framework-advisor/validate";
import { traverseDecisionTree } from "../../src/core/framework-advisor/decision-tree";
import { getMigrationPrompt } from "../../src/core/framework-advisor/migration-prompts";
import { atomicWriteText, atomicWriteJson } from "../../src/core/fs-utils";
import { isFrameworkAdvisorKnowledge } from "../../src/types/framework-advisor";

describe("Framework Advisor — full workflow", () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mink-fw-advisor-"));
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("build → validate → traverse → recommend → migrate → generate round-trip", () => {
    // 1. Build knowledge
    const knowledge = buildKnowledge();
    expect(knowledge.frameworks.length).toBeGreaterThanOrEqual(12);

    // 2. Validate — must pass
    const validation = validateKnowledge(knowledge);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    // 3. Traverse decision tree with realistic answers
    const answers = {
      "component-model": "react",
      "react-css": "utility-first",
      "react-utility-a11y": "critical",
      "react-utility-critical-bundle": "somewhat",
    };
    const recommendedIds = traverseDecisionTree(answers);
    expect(recommendedIds.length).toBeGreaterThan(0);

    // 4. Verify each recommended framework has a migration prompt
    for (const id of recommendedIds) {
      const prompt = getMigrationPrompt(id);
      expect(prompt).toBeDefined();
      expect(prompt!.sections.length).toBe(6);
    }

    // 5. Generate markdown
    const markdown = generateKnowledgeMarkdown(knowledge);
    expect(markdown.length).toBeGreaterThan(1000);

    // Verify recommended frameworks appear in markdown
    for (const id of recommendedIds) {
      const fw = knowledge.frameworks.find((f) => f.id === id);
      expect(fw).toBeDefined();
      expect(markdown).toContain(fw!.name);
    }

    // 6. Write to temp, read back, verify round-trip
    const mdPath = join(tmpDir, "framework-advisor.md");
    const jsonPath = join(tmpDir, "framework-advisor.json");

    atomicWriteText(mdPath, markdown);
    atomicWriteJson(jsonPath, knowledge);

    const readMd = readFileSync(mdPath, "utf-8");
    expect(readMd).toBe(markdown);

    const readJson = JSON.parse(readFileSync(jsonPath, "utf-8"));
    expect(isFrameworkAdvisorKnowledge(readJson)).toBe(true);
    expect(readJson.frameworks.length).toBe(knowledge.frameworks.length);
  });

  test("unknown framework ID handled gracefully", () => {
    expect(getMigrationPrompt("nonexistent-framework")).toBeUndefined();
  });

  test("Vue path reaches valid recommendations", () => {
    const ids = traverseDecisionTree({
      "component-model": "vue",
      "vue-css": "traditional",
      "vue-scale": "enterprise",
    });
    expect(ids).toContain("primevue");
    const prompt = getMigrationPrompt("primevue");
    expect(prompt).toBeDefined();
  });
});
