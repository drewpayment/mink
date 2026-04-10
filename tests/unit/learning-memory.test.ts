import { describe, test, expect } from "bun:test";
import {
  createEmptyLearningMemory,
  parseLearningMemory,
  serializeLearningMemory,
  addEntry,
  removeEntry,
  getEntries,
  totalEntryCount,
} from "../../src/core/learning-memory";
import type { LearningMemory } from "../../src/types/learning-memory";

const WELL_FORMED_MARKDOWN = `# Learning Memory — my-project

## User Preferences
- Prefer single quotes
- 2-space indentation

## Key Learnings
- Bun test runner uses bun:test

## Do-Not-Repeat
- Don't use var

## Decision Log
- Chose Bun over Node for speed
`;

describe("createEmptyLearningMemory", () => {
  test("creates memory with given project name", () => {
    const mem = createEmptyLearningMemory("my-project");
    expect(mem.projectName).toBe("my-project");
  });

  test("creates all four sections as empty arrays", () => {
    const mem = createEmptyLearningMemory("x");
    expect(mem.sections["User Preferences"]).toEqual([]);
    expect(mem.sections["Key Learnings"]).toEqual([]);
    expect(mem.sections["Do-Not-Repeat"]).toEqual([]);
    expect(mem.sections["Decision Log"]).toEqual([]);
  });
});

describe("parseLearningMemory", () => {
  test("parses well-formed markdown", () => {
    const mem = parseLearningMemory(WELL_FORMED_MARKDOWN);
    expect(mem.projectName).toBe("my-project");
    expect(mem.sections["User Preferences"]).toEqual([
      "Prefer single quotes",
      "2-space indentation",
    ]);
    expect(mem.sections["Key Learnings"]).toEqual([
      "Bun test runner uses bun:test",
    ]);
    expect(mem.sections["Do-Not-Repeat"]).toEqual(["Don't use var"]);
    expect(mem.sections["Decision Log"]).toEqual([
      "Chose Bun over Node for speed",
    ]);
  });

  test("parses empty sections", () => {
    const md = `# Learning Memory — proj

## User Preferences

## Key Learnings

## Do-Not-Repeat

## Decision Log
`;
    const mem = parseLearningMemory(md);
    expect(mem.projectName).toBe("proj");
    expect(mem.sections["User Preferences"]).toEqual([]);
    expect(mem.sections["Key Learnings"]).toEqual([]);
    expect(mem.sections["Do-Not-Repeat"]).toEqual([]);
    expect(mem.sections["Decision Log"]).toEqual([]);
  });

  test("uses 'unknown' for missing title", () => {
    const md = `## User Preferences
- some entry
`;
    const mem = parseLearningMemory(md);
    expect(mem.projectName).toBe("unknown");
    expect(mem.sections["User Preferences"]).toEqual(["some entry"]);
  });

  test("ignores content outside recognized sections", () => {
    const md = `# Learning Memory — proj

Some free-form text here.

## Unknown Section
- this should be ignored

## User Preferences
- kept entry

More text
`;
    const mem = parseLearningMemory(md);
    expect(mem.sections["User Preferences"]).toEqual(["kept entry"]);
    expect(totalEntryCount(mem)).toBe(1);
  });

  test("handles empty string input", () => {
    const mem = parseLearningMemory("");
    expect(mem.projectName).toBe("unknown");
    expect(totalEntryCount(mem)).toBe(0);
  });

  test("handles whitespace-only input", () => {
    const mem = parseLearningMemory("   \n   ");
    expect(mem.projectName).toBe("unknown");
    expect(totalEntryCount(mem)).toBe(0);
  });

  test("round-trip: parse → serialize → parse produces same result", () => {
    const original = parseLearningMemory(WELL_FORMED_MARKDOWN);
    const serialized = serializeLearningMemory(original);
    const reparsed = parseLearningMemory(serialized);
    expect(reparsed.projectName).toBe(original.projectName);
    expect(reparsed.sections).toEqual(original.sections);
  });
});

describe("serializeLearningMemory", () => {
  test("produces markdown with correct title", () => {
    const mem = createEmptyLearningMemory("test-project");
    const out = serializeLearningMemory(mem);
    expect(out).toContain("# Learning Memory — test-project");
  });

  test("produces sections in fixed order", () => {
    const mem = createEmptyLearningMemory("proj");
    const out = serializeLearningMemory(mem);
    const prefIdx = out.indexOf("## User Preferences");
    const klIdx = out.indexOf("## Key Learnings");
    const dnrIdx = out.indexOf("## Do-Not-Repeat");
    const dlIdx = out.indexOf("## Decision Log");
    expect(prefIdx).toBeLessThan(klIdx);
    expect(klIdx).toBeLessThan(dnrIdx);
    expect(dnrIdx).toBeLessThan(dlIdx);
  });

  test("ends with a single newline", () => {
    const mem = createEmptyLearningMemory("proj");
    const out = serializeLearningMemory(mem);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });

  test("serializes entries as bullet list items", () => {
    const mem = createEmptyLearningMemory("proj");
    mem.sections["Key Learnings"].push("entry one");
    mem.sections["Key Learnings"].push("entry two");
    const out = serializeLearningMemory(mem);
    expect(out).toContain("- entry one");
    expect(out).toContain("- entry two");
  });
});

describe("addEntry", () => {
  test("appends entry to the specified section", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "User Preferences", "new entry");
    expect(mem.sections["User Preferences"]).toEqual(["new entry"]);
  });

  test("appends multiple entries in order", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "Do-Not-Repeat", "first");
    addEntry(mem, "Do-Not-Repeat", "second");
    expect(mem.sections["Do-Not-Repeat"]).toEqual(["first", "second"]);
  });
});

describe("removeEntry", () => {
  test("removes entry at valid index", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "Key Learnings", "alpha");
    addEntry(mem, "Key Learnings", "beta");
    addEntry(mem, "Key Learnings", "gamma");
    removeEntry(mem, "Key Learnings", 1);
    expect(mem.sections["Key Learnings"]).toEqual(["alpha", "gamma"]);
  });

  test("removes first entry", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "Decision Log", "first");
    addEntry(mem, "Decision Log", "second");
    removeEntry(mem, "Decision Log", 0);
    expect(mem.sections["Decision Log"]).toEqual(["second"]);
  });

  test("removes last entry", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "Decision Log", "first");
    addEntry(mem, "Decision Log", "second");
    removeEntry(mem, "Decision Log", 1);
    expect(mem.sections["Decision Log"]).toEqual(["first"]);
  });

  test("no-op when index is out of bounds (too high)", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "User Preferences", "only");
    removeEntry(mem, "User Preferences", 5);
    expect(mem.sections["User Preferences"]).toEqual(["only"]);
  });

  test("no-op when index is negative", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "User Preferences", "only");
    removeEntry(mem, "User Preferences", -1);
    expect(mem.sections["User Preferences"]).toEqual(["only"]);
  });

  test("no-op on empty section", () => {
    const mem = createEmptyLearningMemory("proj");
    removeEntry(mem, "Key Learnings", 0);
    expect(mem.sections["Key Learnings"]).toEqual([]);
  });
});

describe("getEntries", () => {
  test("returns entries for a section", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "Do-Not-Repeat", "rule one");
    expect(getEntries(mem, "Do-Not-Repeat")).toEqual(["rule one"]);
  });

  test("returns empty array for empty section", () => {
    const mem = createEmptyLearningMemory("proj");
    expect(getEntries(mem, "Key Learnings")).toEqual([]);
  });
});

describe("totalEntryCount", () => {
  test("returns 0 for empty memory", () => {
    const mem = createEmptyLearningMemory("proj");
    expect(totalEntryCount(mem)).toBe(0);
  });

  test("counts entries across all sections", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "User Preferences", "a");
    addEntry(mem, "User Preferences", "b");
    addEntry(mem, "Key Learnings", "c");
    addEntry(mem, "Decision Log", "d");
    expect(totalEntryCount(mem)).toBe(4);
  });
});
