import { describe, expect, test } from "bun:test";
import {
  createEmptyIndex,
  isFileIndex,
  upsertEntry,
  removeEntry,
  lookupEntry,
  recordHit,
  recordMiss,
  checkStaleness,
} from "../../src/core/index-store";
import type { FileIndex, FileIndexEntry } from "../../src/types/file-index";

function makeEntry(filePath: string): FileIndexEntry {
  return {
    filePath,
    description: `Description for ${filePath}`,
    estimatedTokens: 100,
    lastModified: "2026-01-01T00:00:00.000Z",
    lastIndexed: "2026-01-01T00:00:00.000Z",
  };
}

describe("index-store", () => {
  describe("createEmptyIndex", () => {
    test("returns empty header with zero counters", () => {
      const index = createEmptyIndex();
      expect(index.header.lastScanTimestamp).toBe("");
      expect(index.header.totalFiles).toBe(0);
      expect(index.header.lifetimeHits).toBe(0);
      expect(index.header.lifetimeMisses).toBe(0);
    });

    test("returns empty entries object", () => {
      const index = createEmptyIndex();
      expect(Object.keys(index.entries)).toHaveLength(0);
    });
  });

  describe("isFileIndex", () => {
    test("returns true for valid index", () => {
      const index = createEmptyIndex();
      expect(isFileIndex(index)).toBe(true);
    });

    test("returns false for null", () => {
      expect(isFileIndex(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isFileIndex(undefined)).toBe(false);
    });

    test("returns false for string", () => {
      expect(isFileIndex("not an index")).toBe(false);
    });

    test("returns false for object without header", () => {
      expect(isFileIndex({ entries: {} })).toBe(false);
    });

    test("returns false for object without entries", () => {
      expect(isFileIndex({ header: {} })).toBe(false);
    });

    test("returns false for object with null header", () => {
      expect(isFileIndex({ header: null, entries: {} })).toBe(false);
    });

    test("returns true for index with populated entries", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("src/app.ts"));
      expect(isFileIndex(index)).toBe(true);
    });
  });

  describe("upsertEntry", () => {
    test("adds new entry to empty index", () => {
      const index = createEmptyIndex();
      const entry = makeEntry("src/app.ts");
      upsertEntry(index, entry);

      expect(index.entries["src/app.ts"]).toEqual(entry);
      expect(index.header.totalFiles).toBe(1);
    });

    test("updates existing entry", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("src/app.ts"));

      const updated: FileIndexEntry = {
        filePath: "src/app.ts",
        description: "Updated description",
        estimatedTokens: 200,
        lastModified: "2026-06-01T00:00:00.000Z",
        lastIndexed: "2026-06-01T00:00:00.000Z",
      };
      upsertEntry(index, updated);

      expect(index.entries["src/app.ts"].description).toBe("Updated description");
      expect(index.entries["src/app.ts"].estimatedTokens).toBe(200);
      expect(index.header.totalFiles).toBe(1);
    });

    test("increments totalFiles for new entries", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("b.ts"));
      upsertEntry(index, makeEntry("c.ts"));

      expect(index.header.totalFiles).toBe(3);
    });
  });

  describe("removeEntry", () => {
    test("removes existing entry", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("src/app.ts"));
      removeEntry(index, "src/app.ts");

      expect(index.entries["src/app.ts"]).toBeUndefined();
      expect(index.header.totalFiles).toBe(0);
    });

    test("no-ops for non-existent entry", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("src/app.ts"));
      removeEntry(index, "src/other.ts");

      expect(index.header.totalFiles).toBe(1);
    });

    test("decrements totalFiles", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("b.ts"));
      removeEntry(index, "a.ts");

      expect(index.header.totalFiles).toBe(1);
    });
  });

  describe("lookupEntry", () => {
    test("returns entry when found", () => {
      const index = createEmptyIndex();
      const entry = makeEntry("src/app.ts");
      upsertEntry(index, entry);

      const result = lookupEntry(index, "src/app.ts");
      expect(result).toEqual(entry);
    });

    test("returns null when not found", () => {
      const index = createEmptyIndex();
      const result = lookupEntry(index, "src/missing.ts");
      expect(result).toBeNull();
    });
  });

  describe("recordHit", () => {
    test("increments lifetimeHits", () => {
      const index = createEmptyIndex();
      recordHit(index);
      recordHit(index);
      recordHit(index);

      expect(index.header.lifetimeHits).toBe(3);
    });
  });

  describe("recordMiss", () => {
    test("increments lifetimeMisses", () => {
      const index = createEmptyIndex();
      recordMiss(index);
      recordMiss(index);

      expect(index.header.lifetimeMisses).toBe(2);
    });
  });

  describe("checkStaleness", () => {
    test("reports no staleness when index matches scanned files", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("b.ts"));

      const report = checkStaleness(index, ["a.ts", "b.ts"]);
      expect(report.isStale).toBe(false);
      expect(report.missingFromIndex).toHaveLength(0);
      expect(report.orphanedEntries).toHaveLength(0);
    });

    test("detects files missing from index", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));

      const report = checkStaleness(index, ["a.ts", "b.ts", "c.ts"]);
      expect(report.isStale).toBe(true);
      expect(report.missingFromIndex).toEqual(["b.ts", "c.ts"]);
      expect(report.orphanedEntries).toHaveLength(0);
    });

    test("detects orphaned entries", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("deleted.ts"));

      const report = checkStaleness(index, ["a.ts"]);
      expect(report.isStale).toBe(true);
      expect(report.missingFromIndex).toHaveLength(0);
      expect(report.orphanedEntries).toEqual(["deleted.ts"]);
    });

    test("detects both missing and orphaned simultaneously", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("old.ts"));

      const report = checkStaleness(index, ["new.ts"]);
      expect(report.isStale).toBe(true);
      expect(report.missingFromIndex).toEqual(["new.ts"]);
      expect(report.orphanedEntries).toEqual(["old.ts"]);
    });

    test("empty index with scanned files reports all missing", () => {
      const index = createEmptyIndex();

      const report = checkStaleness(index, ["a.ts", "b.ts"]);
      expect(report.isStale).toBe(true);
      expect(report.missingFromIndex).toEqual(["a.ts", "b.ts"]);
    });

    test("populated index with no scanned files reports all orphaned", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("b.ts"));

      const report = checkStaleness(index, []);
      expect(report.isStale).toBe(true);
      expect(report.orphanedEntries).toContain("a.ts");
      expect(report.orphanedEntries).toContain("b.ts");
    });

    test("both empty returns not stale", () => {
      const index = createEmptyIndex();
      const report = checkStaleness(index, []);
      expect(report.isStale).toBe(false);
    });
  });
});
