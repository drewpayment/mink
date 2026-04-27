import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  entryKey,
  loadMeta,
  saveMeta,
  setMetaForEntry,
  getMetaForEntry,
  removeMetaForEntry,
  pruneOrphans,
} from "../../src/core/learning-memory-meta";
import { learningMemoryMetaPath } from "../../src/core/paths";
import { createEmptyLearningMemory, addEntry } from "../../src/core/learning-memory";

function makeCwd(): string {
  return mkdtempSync(join(tmpdir(), "mink-meta-test-"));
}

const createdProjectDirs: string[] = [];

afterEach(() => {
  for (const p of createdProjectDirs.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("entryKey", () => {
  test("normalizes whitespace and case", () => {
    const a = entryKey("Key Learnings", "Use Bun");
    const b = entryKey("Key Learnings", "  use bun  ");
    expect(a).toBe(b);
  });

  test("differentiates by section", () => {
    const a = entryKey("Key Learnings", "x");
    const b = entryKey("Do-Not-Repeat", "x");
    expect(a).not.toBe(b);
  });

  test("returns 16-char hex", () => {
    const k = entryKey("User Preferences", "test");
    expect(k).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("loadMeta / saveMeta round-trip", () => {
  test("returns empty meta when file is absent", () => {
    const cwd = makeCwd();
    const meta = loadMeta(cwd);
    expect(meta.version).toBe(1);
    expect(meta.entries).toEqual({});
  });

  test("persists and reloads structured meta", () => {
    const cwd = makeCwd();
    const meta = loadMeta(cwd);
    const record = setMetaForEntry(meta, "User Preferences", "Use Bun", {
      source: "llm:auto",
      confidence: 0.91,
    });
    saveMeta(cwd, meta);
    createdProjectDirs.push(join(learningMemoryMetaPath(cwd), ".."));

    const reloaded = loadMeta(cwd);
    expect(Object.keys(reloaded.entries)).toHaveLength(1);
    const fetched = getMetaForEntry(reloaded, "User Preferences", "Use Bun");
    expect(fetched?.id).toBe(record.id);
    expect(fetched?.source).toBe("llm:auto");
    expect(fetched?.confidence).toBe(0.91);
  });

  test("ignores corrupt sidecar JSON gracefully", () => {
    const cwd = makeCwd();
    const path = learningMemoryMetaPath(cwd);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "{ not json");
    createdProjectDirs.push(join(path, ".."));
    const meta = loadMeta(cwd);
    expect(meta.entries).toEqual({});
  });
});

describe("setMetaForEntry", () => {
  test("preserves id + createdAt across updates", () => {
    const cwd = makeCwd();
    const meta = loadMeta(cwd);
    const first = setMetaForEntry(meta, "Decision Log", "Pick Bun", {
      source: "user",
    });
    const second = setMetaForEntry(meta, "Decision Log", "Pick Bun", {
      source: "llm:refined",
      confidence: 0.7,
    });
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.source).toBe("llm:refined");
    expect(second.confidence).toBe(0.7);
  });
});

describe("removeMetaForEntry", () => {
  test("deletes the matching key", () => {
    const cwd = makeCwd();
    const meta = loadMeta(cwd);
    setMetaForEntry(meta, "Key Learnings", "X", { source: "user" });
    removeMetaForEntry(meta, "Key Learnings", "X");
    expect(getMetaForEntry(meta, "Key Learnings", "X")).toBeUndefined();
  });
});

describe("pruneOrphans", () => {
  test("drops keys whose entry no longer exists in markdown", () => {
    const cwd = makeCwd();
    const meta = loadMeta(cwd);
    setMetaForEntry(meta, "Key Learnings", "Live", { source: "user" });
    setMetaForEntry(meta, "Key Learnings", "Dead", { source: "user" });

    const mem = createEmptyLearningMemory("p");
    addEntry(mem, "Key Learnings", "Live");

    const pruned = pruneOrphans(meta, mem);
    expect(getMetaForEntry(pruned, "Key Learnings", "Live")).toBeDefined();
    expect(getMetaForEntry(pruned, "Key Learnings", "Dead")).toBeUndefined();
  });

  test("returns empty entries when memory is empty", () => {
    const cwd = makeCwd();
    const meta = loadMeta(cwd);
    setMetaForEntry(meta, "Key Learnings", "Anything", { source: "user" });
    const pruned = pruneOrphans(meta, createEmptyLearningMemory("p"));
    expect(pruned.entries).toEqual({});
  });
});
