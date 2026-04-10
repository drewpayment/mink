import { describe, test, expect } from "bun:test";
import { mergeDuplicates, trimOldest, reflectMemory } from "../../src/core/reflection";
import { createEmptyLearningMemory, addEntry, serializeLearningMemory } from "../../src/core/learning-memory";
import { estimateTokens } from "../../src/core/token-estimate";
import type { LearningMemory } from "../../src/types/learning-memory";

function makeMemory(overrides: Partial<Record<string, string[]>> = {}): LearningMemory {
  const mem = createEmptyLearningMemory("test-project");
  if (overrides["User Preferences"]) mem.sections["User Preferences"] = [...overrides["User Preferences"]];
  if (overrides["Key Learnings"]) mem.sections["Key Learnings"] = [...overrides["Key Learnings"]];
  if (overrides["Do-Not-Repeat"]) mem.sections["Do-Not-Repeat"] = [...overrides["Do-Not-Repeat"]];
  if (overrides["Decision Log"]) mem.sections["Decision Log"] = [...overrides["Decision Log"]];
  return mem;
}

// ─── mergeDuplicates ─────────────────────────────────────────────────────────

describe("mergeDuplicates", () => {
  test("removes exact duplicates within a section", () => {
    const mem = makeMemory({
      "Key Learnings": ["use async/await", "use async/await", "other entry"],
    });
    const result = mergeDuplicates(mem);
    expect(result.sections["Key Learnings"]).toEqual(["use async/await", "other entry"]);
  });

  test("removes whitespace-normalized duplicates", () => {
    const mem = makeMemory({
      "User Preferences": ["prefer  single  quotes", "prefer single quotes"],
    });
    const result = mergeDuplicates(mem);
    expect(result.sections["User Preferences"]).toHaveLength(1);
  });

  test("DNR: entries sharing same quoted pattern keep newer date", () => {
    const mem = makeMemory({
      "Do-Not-Repeat": [
        `Don't use "var" [2024-01-01]`,
        `Avoid "var" usage [2024-06-15]`,
      ],
    });
    const result = mergeDuplicates(mem);
    expect(result.sections["Do-Not-Repeat"]).toHaveLength(1);
    expect(result.sections["Do-Not-Repeat"][0]).toContain("2024-06-15");
  });

  test("DNR: entries sharing same quoted pattern - older entry kept when newer has no date", () => {
    const mem = makeMemory({
      "Do-Not-Repeat": [
        `Don't use "var" [2024-01-01]`,
        `Also avoid "var"`,
      ],
    });
    const result = mergeDuplicates(mem);
    // The one with a date should win since non-date entries don't bump "best"
    expect(result.sections["Do-Not-Repeat"]).toHaveLength(1);
    expect(result.sections["Do-Not-Repeat"][0]).toContain("2024-01-01");
  });

  test("DNR: entries with different quoted patterns are NOT merged", () => {
    const mem = makeMemory({
      "Do-Not-Repeat": [
        `Don't use "var" [2024-01-01]`,
        `Don't use "let" [2024-01-01]`,
      ],
    });
    const result = mergeDuplicates(mem);
    expect(result.sections["Do-Not-Repeat"]).toHaveLength(2);
  });

  test("no duplicates returns unchanged entries", () => {
    const mem = makeMemory({
      "Key Learnings": ["entry one", "entry two", "entry three"],
    });
    const result = mergeDuplicates(mem);
    expect(result.sections["Key Learnings"]).toEqual(["entry one", "entry two", "entry three"]);
  });

  test("same text in two different sections is preserved in both", () => {
    const mem = makeMemory({
      "Key Learnings": ["use strict mode"],
      "User Preferences": ["use strict mode"],
    });
    const result = mergeDuplicates(mem);
    expect(result.sections["Key Learnings"]).toEqual(["use strict mode"]);
    expect(result.sections["User Preferences"]).toEqual(["use strict mode"]);
  });

  test("does not mutate input", () => {
    const mem = makeMemory({
      "Key Learnings": ["dup", "dup"],
    });
    const before = [...mem.sections["Key Learnings"]];
    mergeDuplicates(mem);
    expect(mem.sections["Key Learnings"]).toEqual(before);
  });

  test("empty sections remain empty", () => {
    const mem = makeMemory();
    const result = mergeDuplicates(mem);
    expect(result.sections["Key Learnings"]).toEqual([]);
    expect(result.sections["Do-Not-Repeat"]).toEqual([]);
  });
});

// ─── trimOldest ──────────────────────────────────────────────────────────────

describe("trimOldest", () => {
  test("trims from Decision Log first", () => {
    const mem = makeMemory({
      "Decision Log": ["dl-1", "dl-2"],
      "Key Learnings": ["kl-1"],
      "User Preferences": ["up-1"],
      "Do-Not-Repeat": ["dnr-1"],
    });
    const result = trimOldest(mem, 1);
    expect(result.sections["Decision Log"]).toEqual(["dl-2"]);
    expect(result.sections["Key Learnings"]).toEqual(["kl-1"]);
    expect(result.sections["User Preferences"]).toEqual(["up-1"]);
    expect(result.sections["Do-Not-Repeat"]).toEqual(["dnr-1"]);
  });

  test("trims Key Learnings after Decision Log is empty", () => {
    const mem = makeMemory({
      "Decision Log": ["dl-1"],
      "Key Learnings": ["kl-1", "kl-2"],
      "User Preferences": ["up-1"],
      "Do-Not-Repeat": ["dnr-1"],
    });
    // trim 2: remove dl-1 then kl-1
    const result = trimOldest(mem, 2);
    expect(result.sections["Decision Log"]).toEqual([]);
    expect(result.sections["Key Learnings"]).toEqual(["kl-2"]);
    expect(result.sections["User Preferences"]).toEqual(["up-1"]);
    expect(result.sections["Do-Not-Repeat"]).toEqual(["dnr-1"]);
  });

  test("trims User Preferences after Decision Log and Key Learnings are empty", () => {
    const mem = makeMemory({
      "Decision Log": ["dl-1"],
      "Key Learnings": ["kl-1"],
      "User Preferences": ["up-1", "up-2"],
      "Do-Not-Repeat": ["dnr-1"],
    });
    // trim 3: remove dl-1, kl-1, up-1
    const result = trimOldest(mem, 3);
    expect(result.sections["Decision Log"]).toEqual([]);
    expect(result.sections["Key Learnings"]).toEqual([]);
    expect(result.sections["User Preferences"]).toEqual(["up-2"]);
    expect(result.sections["Do-Not-Repeat"]).toEqual(["dnr-1"]);
  });

  test("trims Do-Not-Repeat last", () => {
    const mem = makeMemory({
      "Decision Log": ["dl-1"],
      "Key Learnings": ["kl-1"],
      "User Preferences": ["up-1"],
      "Do-Not-Repeat": ["dnr-1", "dnr-2"],
    });
    // trim 4: remove dl-1, kl-1, up-1, dnr-1
    const result = trimOldest(mem, 4);
    expect(result.sections["Decision Log"]).toEqual([]);
    expect(result.sections["Key Learnings"]).toEqual([]);
    expect(result.sections["User Preferences"]).toEqual([]);
    expect(result.sections["Do-Not-Repeat"]).toEqual(["dnr-2"]);
  });

  test("no-op for trimCount 0", () => {
    const mem = makeMemory({
      "Decision Log": ["dl-1"],
      "Key Learnings": ["kl-1"],
    });
    const result = trimOldest(mem, 0);
    expect(result.sections["Decision Log"]).toEqual(["dl-1"]);
    expect(result.sections["Key Learnings"]).toEqual(["kl-1"]);
  });

  test("handles trimming more than total entries", () => {
    const mem = makeMemory({
      "Decision Log": ["dl-1"],
      "Key Learnings": ["kl-1"],
    });
    const result = trimOldest(mem, 100);
    expect(result.sections["Decision Log"]).toEqual([]);
    expect(result.sections["Key Learnings"]).toEqual([]);
    expect(result.sections["User Preferences"]).toEqual([]);
    expect(result.sections["Do-Not-Repeat"]).toEqual([]);
  });

  test("does not mutate input", () => {
    const mem = makeMemory({ "Decision Log": ["dl-1", "dl-2"] });
    trimOldest(mem, 1);
    expect(mem.sections["Decision Log"]).toEqual(["dl-1", "dl-2"]);
  });
});

// ─── reflectMemory ───────────────────────────────────────────────────────────

describe("reflectMemory", () => {
  function makeLargeMemory(): LearningMemory {
    const mem = createEmptyLearningMemory("big-project");
    for (let i = 0; i < 50; i++) {
      addEntry(mem, "Decision Log", `Decision number ${i}: we chose option A over option B because it was faster and safer`);
    }
    for (let i = 0; i < 50; i++) {
      addEntry(mem, "Key Learnings", `Learning number ${i}: always check for null values before accessing properties`);
    }
    return mem;
  }

  test("under budget is a no-op — returns same entries and withinBudget=true", () => {
    const mem = makeMemory({ "Key Learnings": ["small entry"] });
    const { memory, result } = reflectMemory(mem, 10000);
    expect(result.withinBudget).toBe(true);
    expect(result.mergedCount).toBe(0);
    expect(result.trimmedCount).toBe(0);
    expect(memory.sections["Key Learnings"]).toEqual(["small entry"]);
  });

  test("merge dups gets under budget", () => {
    // Create a memory where duplicates are causing the oversize, budget tight enough
    const mem = createEmptyLearningMemory("proj");
    const longEntry = "This is a somewhat long entry that repeats a lot of tokens in the budget analysis";
    // Add many duplicates
    for (let i = 0; i < 20; i++) {
      addEntry(mem, "Key Learnings", longEntry);
    }
    // With duplicates: ~20 copies. Serialized tokens should exceed a small budget
    const serialized = serializeLearningMemory(mem);
    const totalTokens = estimateTokens(serialized, "learning-memory.md");
    // Budget that is tight but achievable by deduplication (1 copy)
    const singleCopySerialized = serializeLearningMemory(
      makeMemory({ "Key Learnings": [longEntry] })
    );
    const singleCopyTokens = estimateTokens(singleCopySerialized, "learning-memory.md");

    if (totalTokens > singleCopyTokens) {
      const budget = singleCopyTokens + 10;
      const { memory, result } = reflectMemory(mem, budget);
      expect(result.mergedCount).toBeGreaterThan(0);
      expect(result.withinBudget).toBe(true);
      expect(memory.sections["Key Learnings"]).toHaveLength(1);
    }
  });

  test("trim when merge insufficient", () => {
    const mem = makeLargeMemory();
    const serialized = serializeLearningMemory(mem);
    const tokens = estimateTokens(serialized, "learning-memory.md");
    // Set budget to a small fraction — needs trimming
    const budget = Math.floor(tokens / 5);
    const { result } = reflectMemory(mem, budget);
    expect(result.trimmedCount).toBeGreaterThan(0);
    expect(result.beforeTokens).toBeGreaterThan(result.afterTokens);
  });

  test("returns updated memory with fewer entries after trimming", () => {
    const mem = makeLargeMemory();
    const serialized = serializeLearningMemory(mem);
    const tokens = estimateTokens(serialized, "learning-memory.md");
    const budget = Math.floor(tokens / 3);
    const { memory, result } = reflectMemory(mem, budget);
    const before = mem.sections["Decision Log"].length + mem.sections["Key Learnings"].length;
    const after =
      memory.sections["Decision Log"].length + memory.sections["Key Learnings"].length;
    expect(after).toBeLessThan(before);
    expect(result.trimmedCount).toBeGreaterThan(0);
  });

  test("zero budget skips pruning and returns withinBudget=true", () => {
    const mem = makeLargeMemory();
    const { result } = reflectMemory(mem, 0);
    expect(result.withinBudget).toBe(true);
    expect(result.mergedCount).toBe(0);
    expect(result.trimmedCount).toBe(0);
  });

  test("negative budget skips pruning and returns withinBudget=true", () => {
    const mem = makeLargeMemory();
    const { result } = reflectMemory(mem, -100);
    expect(result.withinBudget).toBe(true);
    expect(result.mergedCount).toBe(0);
    expect(result.trimmedCount).toBe(0);
  });

  test("beforeTokens is populated correctly", () => {
    const mem = makeMemory({ "Key Learnings": ["entry one", "entry two"] });
    const serialized = serializeLearningMemory(mem);
    const expected = estimateTokens(serialized, "learning-memory.md");
    const { result } = reflectMemory(mem, 10000);
    expect(result.beforeTokens).toBe(expected);
  });

  test("does not mutate the input memory", () => {
    const mem = makeLargeMemory();
    const originalDLCount = mem.sections["Decision Log"].length;
    const serialized = serializeLearningMemory(mem);
    const tokens = estimateTokens(serialized, "learning-memory.md");
    reflectMemory(mem, Math.floor(tokens / 3));
    expect(mem.sections["Decision Log"].length).toBe(originalDLCount);
  });
});
