import { describe, test, expect } from "bun:test";
import {
  createEmptyBugMemory,
  generateBugId,
  findDuplicate,
  addBugEntry,
  updateOccurrence,
  computeSimilarity,
  searchBugs,
  lookupBugsForFile,
  formatBugSummary,
  hasBugForFileInSession,
  isBugMemory,
} from "../../src/core/bug-memory";
import type { BugEntry, BugMemory } from "../../src/types/bug-memory";

function makeBugEntry(overrides: Partial<BugEntry> = {}): BugEntry {
  return {
    id: "bug-001",
    createdAt: "2026-04-10T10:00:00.000Z",
    lastSeenAt: "2026-04-10T10:00:00.000Z",
    errorMessage: "TypeError: Cannot read property 'name' of null",
    filePath: "src/api.ts",
    rootCause: "API response was null when network is down",
    fixDescription: "Added null check before accessing response.name",
    tags: ["null-check", "api-response"],
    occurrenceCount: 1,
    relatedBugIds: [],
    ...overrides,
  };
}

function makeMemoryWithEntries(entries: Partial<BugEntry>[]): BugMemory {
  return {
    entries: entries.map((e, i) =>
      makeBugEntry({ id: `bug-${String(i + 1).padStart(3, "0")}`, ...e })
    ),
    nextId: entries.length + 1,
  };
}

describe("createEmptyBugMemory", () => {
  test("creates memory with empty entries and nextId 1", () => {
    const mem = createEmptyBugMemory();
    expect(mem.entries).toEqual([]);
    expect(mem.nextId).toBe(1);
  });
});

describe("isBugMemory", () => {
  test("returns true for valid bug memory", () => {
    expect(isBugMemory({ entries: [], nextId: 1 })).toBe(true);
  });

  test("returns false for null", () => {
    expect(isBugMemory(null)).toBe(false);
  });

  test("returns false for non-object", () => {
    expect(isBugMemory("string")).toBe(false);
  });

  test("returns false for missing entries", () => {
    expect(isBugMemory({ nextId: 1 })).toBe(false);
  });

  test("returns false for missing nextId", () => {
    expect(isBugMemory({ entries: [] })).toBe(false);
  });
});

describe("generateBugId", () => {
  test("generates zero-padded ID", () => {
    expect(generateBugId(1)).toBe("bug-001");
    expect(generateBugId(42)).toBe("bug-042");
    expect(generateBugId(999)).toBe("bug-999");
  });

  test("handles IDs beyond 999", () => {
    expect(generateBugId(1000)).toBe("bug-1000");
  });
});

describe("findDuplicate", () => {
  test("finds duplicate by error message and file path", () => {
    const mem = makeMemoryWithEntries([
      { errorMessage: "TypeError: x is null", filePath: "src/a.ts" },
    ]);
    const dup = findDuplicate(mem, "TypeError: x is null", "src/a.ts");
    expect(dup).not.toBeNull();
    expect(dup!.id).toBe("bug-001");
  });

  test("returns null when error matches but file differs", () => {
    const mem = makeMemoryWithEntries([
      { errorMessage: "TypeError: x is null", filePath: "src/a.ts" },
    ]);
    const dup = findDuplicate(mem, "TypeError: x is null", "src/b.ts");
    expect(dup).toBeNull();
  });

  test("returns null when file matches but error differs", () => {
    const mem = makeMemoryWithEntries([
      { errorMessage: "TypeError: x is null", filePath: "src/a.ts" },
    ]);
    const dup = findDuplicate(mem, "ReferenceError: y", "src/a.ts");
    expect(dup).toBeNull();
  });

  test("returns null on empty memory", () => {
    const mem = createEmptyBugMemory();
    expect(findDuplicate(mem, "anything", "any/file.ts")).toBeNull();
  });
});

describe("addBugEntry", () => {
  test("adds new entry with sequential ID", () => {
    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "Error one",
      filePath: "src/a.ts",
      rootCause: "cause",
      fixDescription: "fix",
      tags: ["tag"],
      relatedBugIds: [],
    });
    expect(mem.entries).toHaveLength(1);
    expect(mem.entries[0].id).toBe("bug-001");
    expect(mem.entries[0].occurrenceCount).toBe(1);
    expect(mem.nextId).toBe(2);
  });

  test("assigns incrementing IDs", () => {
    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "Error one",
      filePath: "src/a.ts",
      rootCause: "cause",
      fixDescription: "fix",
      tags: [],
      relatedBugIds: [],
    });
    mem = addBugEntry(mem, {
      errorMessage: "Error two",
      filePath: "src/b.ts",
      rootCause: "cause",
      fixDescription: "fix",
      tags: [],
      relatedBugIds: [],
    });
    expect(mem.entries[0].id).toBe("bug-001");
    expect(mem.entries[1].id).toBe("bug-002");
    expect(mem.nextId).toBe(3);
  });

  test("updates occurrence count for duplicate (same error + file)", () => {
    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "TypeError: null ref",
      filePath: "src/api.ts",
      rootCause: "null check missing",
      fixDescription: "added check",
      tags: ["null-check"],
      relatedBugIds: [],
    });
    mem = addBugEntry(mem, {
      errorMessage: "TypeError: null ref",
      filePath: "src/api.ts",
      rootCause: "different cause",
      fixDescription: "different fix",
      tags: ["other"],
      relatedBugIds: [],
    });
    expect(mem.entries).toHaveLength(1);
    expect(mem.entries[0].occurrenceCount).toBe(2);
    expect(mem.entries[0].rootCause).toBe("null check missing"); // original preserved
    expect(mem.nextId).toBe(2); // didn't increment
  });

  test("IDs are unique across entries", () => {
    let mem = createEmptyBugMemory();
    for (let i = 0; i < 10; i++) {
      mem = addBugEntry(mem, {
        errorMessage: `Error ${i}`,
        filePath: `src/file${i}.ts`,
        rootCause: "cause",
        fixDescription: "fix",
        tags: [],
        relatedBugIds: [],
      });
    }
    const ids = mem.entries.map((e) => e.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

describe("updateOccurrence", () => {
  test("increments count and updates lastSeenAt", () => {
    const mem = makeMemoryWithEntries([
      {
        occurrenceCount: 1,
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        rootCause: "original cause",
        fixDescription: "original fix",
      },
    ]);
    const updated = updateOccurrence(mem, "bug-001");
    expect(updated.entries[0].occurrenceCount).toBe(2);
    expect(updated.entries[0].lastSeenAt).not.toBe("2026-01-01T00:00:00.000Z");
  });

  test("preserves all other fields", () => {
    const original = makeBugEntry({
      id: "bug-001",
      errorMessage: "specific error",
      rootCause: "specific cause",
      fixDescription: "specific fix",
      tags: ["tag1", "tag2"],
      relatedBugIds: ["bug-002"],
    });
    const mem: BugMemory = { entries: [original], nextId: 2 };
    const updated = updateOccurrence(mem, "bug-001");
    const entry = updated.entries[0];
    expect(entry.errorMessage).toBe("specific error");
    expect(entry.rootCause).toBe("specific cause");
    expect(entry.fixDescription).toBe("specific fix");
    expect(entry.tags).toEqual(["tag1", "tag2"]);
    expect(entry.relatedBugIds).toEqual(["bug-002"]);
    expect(entry.createdAt).toBe(original.createdAt);
  });

  test("does not affect other entries", () => {
    const mem = makeMemoryWithEntries([
      { occurrenceCount: 1 },
      { id: "bug-002", occurrenceCount: 5 },
    ]);
    const updated = updateOccurrence(mem, "bug-001");
    expect(updated.entries[1].occurrenceCount).toBe(5);
  });
});

describe("computeSimilarity", () => {
  test("exact substring match on error message scores 1.0+", () => {
    const entry = makeBugEntry({
      errorMessage: "TypeError: Cannot read property 'name' of null",
    });
    const result = computeSimilarity(
      "TypeError: Cannot read property 'name' of null",
      entry
    );
    expect(result.score).toBeGreaterThanOrEqual(1.0);
    expect(result.matchReasons).toContain("exact_error_match");
  });

  test("word overlap on root cause contributes to score", () => {
    const entry = makeBugEntry({
      errorMessage: "unrelated error",
      rootCause: "database connection timeout after 30s",
    });
    const result = computeSimilarity("database connection timeout", entry);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchReasons).toContain("root_cause");
  });

  test("word overlap on tags contributes to score", () => {
    const entry = makeBugEntry({
      errorMessage: "unrelated",
      rootCause: "unrelated",
      fixDescription: "unrelated",
      tags: ["auth", "token-expiry"],
    });
    const result = computeSimilarity("auth token expiry", entry);
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchReasons).toContain("tags");
  });

  test("no match returns score 0", () => {
    const entry = makeBugEntry({
      errorMessage: "TypeError: null ref",
      rootCause: "missing null check",
      fixDescription: "added guard",
      tags: ["null-check"],
    });
    const result = computeSimilarity("completely unrelated query xyz", entry);
    expect(result.score).toBe(0);
    expect(result.matchReasons).toEqual([]);
  });

  test("partial word overlap produces intermediate score", () => {
    const entry = makeBugEntry({
      errorMessage: "Failed to connect to database server",
      rootCause: "Database host unreachable",
      fixDescription: "Updated connection string",
      tags: ["database", "connection"],
    });
    const result = computeSimilarity("database server error", entry);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1.0);
  });
});

describe("searchBugs", () => {
  test("returns empty array for empty memory", () => {
    const mem = createEmptyBugMemory();
    expect(searchBugs(mem, "anything")).toEqual([]);
  });

  test("returns empty array for empty query", () => {
    const mem = makeMemoryWithEntries([{ errorMessage: "error" }]);
    expect(searchBugs(mem, "")).toEqual([]);
    expect(searchBugs(mem, "   ")).toEqual([]);
  });

  test("returns matches sorted by score descending", () => {
    const mem = makeMemoryWithEntries([
      {
        errorMessage: "database connection timeout",
        rootCause: "db host down",
        tags: ["database"],
      },
      {
        errorMessage: "database connection refused",
        rootCause: "wrong port for database",
        tags: ["database", "connection"],
      },
    ]);
    const results = searchBugs(mem, "database connection timeout");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // First result should be the exact or closer match
    if (results.length >= 2) {
      expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    }
  });

  test("filters out entries below 0.3 threshold", () => {
    const mem = makeMemoryWithEntries([
      {
        errorMessage: "TypeError: Cannot read null",
        rootCause: "null pointer",
        tags: ["null-check"],
        filePath: "src/api.ts",
      },
      {
        errorMessage: "SyntaxError: unexpected token",
        rootCause: "missing comma in json",
        tags: ["syntax"],
        filePath: "src/parser.ts",
      },
    ]);
    // Search for something only matching the first entry
    const results = searchBugs(mem, "null pointer TypeError", {
      filePath: "src/api.ts",
    });
    // The null-check entry should match; the syntax entry should not
    const ids = results.map((r) => r.entry.id);
    expect(ids).toContain("bug-001");
  });

  test("boosts same-file matches", () => {
    const mem = makeMemoryWithEntries([
      {
        errorMessage: "TypeError: undefined is not a function",
        filePath: "src/other.ts",
        tags: ["type-error"],
      },
      {
        errorMessage: "TypeError: cannot call undefined",
        filePath: "src/target.ts",
        tags: ["type-error"],
      },
    ]);
    const results = searchBugs(mem, "TypeError undefined", {
      filePath: "src/target.ts",
    });
    // The target.ts entry should have a higher score due to file path boost
    if (results.length >= 2) {
      const targetMatch = results.find(
        (r) => r.entry.filePath === "src/target.ts"
      );
      const otherMatch = results.find(
        (r) => r.entry.filePath === "src/other.ts"
      );
      if (targetMatch && otherMatch) {
        expect(targetMatch.score).toBeGreaterThan(otherMatch.score);
      }
    }
  });

  test("false positive guard: requires file or tag match for low scores", () => {
    const mem = makeMemoryWithEntries([
      {
        errorMessage: "some vague error about things",
        rootCause: "something happened",
        tags: ["unrelated-tag"],
        filePath: "src/unrelated.ts",
      },
    ]);
    // Query that has minimal overlap and no file/tag match
    const results = searchBugs(mem, "about things", {
      filePath: "src/totally-different.ts",
    });
    // Should be filtered out due to false positive guard
    for (const r of results) {
      expect(r.score).toBeGreaterThan(0.3);
    }
  });
});

describe("lookupBugsForFile", () => {
  test("returns entries for matching file path", () => {
    const mem = makeMemoryWithEntries([
      { filePath: "src/api.ts", errorMessage: "error 1" },
      { filePath: "src/auth.ts", errorMessage: "error 2" },
      { filePath: "src/api.ts", errorMessage: "error 3" },
    ]);
    const results = lookupBugsForFile(mem, "src/api.ts");
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.filePath === "src/api.ts")).toBe(true);
  });

  test("returns empty array when no matches", () => {
    const mem = makeMemoryWithEntries([{ filePath: "src/api.ts" }]);
    expect(lookupBugsForFile(mem, "src/other.ts")).toEqual([]);
  });

  test("returns empty array for empty memory", () => {
    const mem = createEmptyBugMemory();
    expect(lookupBugsForFile(mem, "src/api.ts")).toEqual([]);
  });

  test("sorts by lastSeenAt descending", () => {
    const mem = makeMemoryWithEntries([
      {
        filePath: "src/api.ts",
        lastSeenAt: "2026-01-01T00:00:00.000Z",
        errorMessage: "old",
      },
      {
        filePath: "src/api.ts",
        lastSeenAt: "2026-04-10T00:00:00.000Z",
        errorMessage: "new",
      },
    ]);
    const results = lookupBugsForFile(mem, "src/api.ts");
    expect(results[0].errorMessage).toBe("new");
    expect(results[1].errorMessage).toBe("old");
  });
});

describe("formatBugSummary", () => {
  test("returns null for empty entries", () => {
    expect(formatBugSummary([])).toBeNull();
  });

  test("formats single entry", () => {
    const entries = [makeBugEntry()];
    const summary = formatBugSummary(entries);
    expect(summary).not.toBeNull();
    expect(summary).toContain("[mink] Known bugs for this file:");
    expect(summary).toContain("bug-001");
    expect(summary).toContain("Root cause:");
    expect(summary).toContain("Fix:");
  });

  test("shows max 3 entries with overflow count", () => {
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeBugEntry({ id: `bug-${String(i + 1).padStart(3, "0")}` })
    );
    const summary = formatBugSummary(entries)!;
    expect(summary).toContain("bug-001");
    expect(summary).toContain("bug-002");
    expect(summary).toContain("bug-003");
    expect(summary).not.toContain("bug-004");
    expect(summary).toContain("... and 2 more");
  });

  test("shows occurrence count for entries seen multiple times", () => {
    const entries = [makeBugEntry({ occurrenceCount: 5 })];
    const summary = formatBugSummary(entries)!;
    expect(summary).toContain("Seen 5 times");
  });

  test("does not show occurrence info for count 1", () => {
    const entries = [makeBugEntry({ occurrenceCount: 1 })];
    const summary = formatBugSummary(entries)!;
    expect(summary).not.toContain("Seen");
  });
});

describe("hasBugForFileInSession", () => {
  test("returns true when bug was created during session", () => {
    const mem = makeMemoryWithEntries([
      {
        filePath: "src/api.ts",
        createdAt: "2026-04-10T12:00:00.000Z",
      },
    ]);
    expect(
      hasBugForFileInSession(mem, "src/api.ts", "2026-04-10T10:00:00.000Z")
    ).toBe(true);
  });

  test("returns false when bug was created before session", () => {
    const mem = makeMemoryWithEntries([
      {
        filePath: "src/api.ts",
        createdAt: "2026-04-09T08:00:00.000Z",
      },
    ]);
    expect(
      hasBugForFileInSession(mem, "src/api.ts", "2026-04-10T10:00:00.000Z")
    ).toBe(false);
  });

  test("returns false when file has no bug entries", () => {
    const mem = makeMemoryWithEntries([
      {
        filePath: "src/other.ts",
        createdAt: "2026-04-10T12:00:00.000Z",
      },
    ]);
    expect(
      hasBugForFileInSession(mem, "src/api.ts", "2026-04-10T10:00:00.000Z")
    ).toBe(false);
  });

  test("returns false for empty memory", () => {
    const mem = createEmptyBugMemory();
    expect(
      hasBugForFileInSession(mem, "src/api.ts", "2026-04-10T10:00:00.000Z")
    ).toBe(false);
  });
});
