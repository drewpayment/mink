import { describe, test, expect } from "bun:test";
import {
  MIGRATION_PROMPTS,
  getMigrationPrompt,
} from "../../../src/core/framework-advisor/migration-prompts";
import { FRAMEWORK_CATALOG } from "../../../src/core/framework-advisor/catalog";
import { MIGRATION_SECTION_KEYS } from "../../../src/types/framework-advisor";

describe("MIGRATION_PROMPTS", () => {
  test("every framework in catalog has a migration prompt", () => {
    const promptIds = new Set(MIGRATION_PROMPTS.map((p) => p.frameworkId));
    for (const fw of FRAMEWORK_CATALOG) {
      expect(promptIds.has(fw.id)).toBe(true);
    }
  });

  test("every prompt has all 6 required sections", () => {
    for (const prompt of MIGRATION_PROMPTS) {
      const keys = prompt.sections.map((s) => s.key);
      for (const required of MIGRATION_SECTION_KEYS) {
        expect(keys).toContain(required);
      }
    }
  });

  test("no section has empty content", () => {
    for (const prompt of MIGRATION_PROMPTS) {
      for (const section of prompt.sections) {
        expect(section.content.trim()).not.toBe("");
      }
    }
  });

  test("no duplicate framework IDs in prompts", () => {
    const ids = MIGRATION_PROMPTS.map((p) => p.frameworkId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("getMigrationPrompt", () => {
  test("returns the correct prompt", () => {
    const prompt = getMigrationPrompt("shadcn-ui");
    expect(prompt).toBeDefined();
    expect(prompt!.frameworkId).toBe("shadcn-ui");
  });

  test("returns undefined for unknown ID", () => {
    expect(getMigrationPrompt("nonexistent")).toBeUndefined();
  });
});
