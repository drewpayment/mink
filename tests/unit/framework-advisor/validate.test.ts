import { describe, test, expect } from "bun:test";
import { validateKnowledge } from "../../../src/core/framework-advisor/validate";
import { buildKnowledge } from "../../../src/core/framework-advisor/generate";
import type {
  FrameworkAdvisorKnowledge,
  FrameworkEntry,
} from "../../../src/types/framework-advisor";

describe("validateKnowledge", () => {
  test("valid knowledge passes validation", () => {
    const k = buildKnowledge();
    const result = validateKnowledge(k);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("catches fewer than 12 frameworks", () => {
    const k = buildKnowledge();
    k.frameworks = k.frameworks.slice(0, 5);
    const result = validateKnowledge(k);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("minimum 12"))).toBe(true);
  });

  test("catches duplicate framework IDs", () => {
    const k = buildKnowledge();
    k.frameworks = [...k.frameworks, { ...k.frameworks[0] }];
    const result = validateKnowledge(k);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  test("catches empty framework fields", () => {
    const k = buildKnowledge();
    const modified = { ...k.frameworks[0], name: "" } as FrameworkEntry;
    k.frameworks = [modified, ...k.frameworks.slice(1)];
    const result = validateKnowledge(k);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("empty field"))).toBe(true);
  });

  test("catches dangling decision tree references", () => {
    const k = buildKnowledge();
    k.decisionTree = [
      {
        id: "root",
        question: "Test?",
        options: [
          { label: "A", value: "a", nextNodeId: "nonexistent" },
        ],
      },
    ];
    const result = validateKnowledge(k);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unknown node"))).toBe(true);
  });

  test("catches unknown framework in tree recommendations", () => {
    const k = buildKnowledge();
    k.decisionTree = [
      {
        id: "root",
        question: "Test?",
        options: [
          {
            label: "A",
            value: "a",
            nextNodeId: null,
            recommends: ["nonexistent-fw"],
          },
        ],
      },
    ];
    const result = validateKnowledge(k);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("unknown framework"))
    ).toBe(true);
  });

  test("catches missing migration prompt for a framework", () => {
    const k = buildKnowledge();
    k.migrationPrompts = k.migrationPrompts.slice(1);
    const result = validateKnowledge(k);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes("no migration prompt"))
    ).toBe(true);
  });

  test("catches missing migration section", () => {
    const k = buildKnowledge();
    k.migrationPrompts = k.migrationPrompts.map((p) =>
      p.frameworkId === k.frameworks[0].id
        ? { ...p, sections: p.sections.slice(1) }
        : p
    );
    const result = validateKnowledge(k);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("missing section"))).toBe(
      true
    );
  });
});
