import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

import { buildContextPack, stablePrefix, VOLATILE_MARKER } from "../../src/core/context-pack";
import { _resetDbCacheForTests } from "../../src/storage/db";
import { projectIdFor } from "../../src/core/project-id";
import { learningMemoryPath } from "../../src/core/paths";
import { serializeLearningMemory } from "../../src/core/learning-memory";
import type { LearningMemory } from "../../src/types/learning-memory";
import { BugMemoryRepo } from "../../src/repositories/bug-memory-repo";
import { FileIndexRepo } from "../../src/repositories/file-index-repo";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-ctx-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-ctx-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function seedRules() {
  const mem: LearningMemory = {
    projectName: "x",
    sections: {
      "User Preferences": ["Prefer bun over npm"],
      "Key Learnings": ["FTS5 needs porter"],
      "Do-Not-Repeat": ["Do not hardcode paths"],
      "Decision Log": ["Chose SQLite"],
    },
  };
  const p = learningMemoryPath(cwd);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, serializeLearningMemory(mem));
}

function seedBug(errorMessage: string, occ = 1) {
  const repo = BugMemoryRepo.for(cwd);
  const e = repo.add({
    errorMessage,
    filePath: "src/x.ts",
    rootCause: "rc",
    fixDescription: "fix",
    tags: [],
    relatedBugIds: [],
  });
  for (let i = 1; i < occ; i++) repo.incrementOccurrence(e.id);
  return e;
}

function seedFiles(n: number) {
  const repo = FileIndexRepo.for(cwd);
  for (let i = 0; i < n; i++) {
    repo.upsert({
      filePath: `src/file${String(i).padStart(3, "0")}.ts`,
      description: `description of file ${i}`,
      estimatedTokens: 100,
      lastModified: "2026-01-01T00:00:00.000Z",
      lastIndexed: "2026-01-01T00:00:00.000Z",
    });
  }
}

describe("buildContextPack", () => {
  test("includes rules, bugs, and files", () => {
    seedRules();
    seedBug("EADDRINUSE listen failed", 3);
    seedFiles(2);
    const pack = buildContextPack(cwd, { now: new Date("2026-07-01T00:00:00Z") });
    expect(pack).toContain("Learned rules");
    expect(pack).toContain("Prefer bun over npm");
    expect(pack).toContain("Recurring bugs");
    expect(pack).toContain("EADDRINUSE listen failed");
    expect(pack).toContain("Files");
    expect(pack).toContain("src/file000.ts");
  });

  test("stable prefix is byte-identical across calls (cache-friendly)", () => {
    seedRules();
    seedBug("bug one", 2);
    seedFiles(3);
    const a = buildContextPack(cwd, { now: new Date("2026-07-01T00:00:00Z") });
    const b = buildContextPack(cwd, { now: new Date("2030-12-31T23:59:59Z") }); // different time
    // The volatile footer differs, but the stable prefix must not.
    expect(stablePrefix(a)).toBe(stablePrefix(b));
    expect(a).not.toBe(b); // footers differ
  });

  test("volatile fields live below the marker", () => {
    seedFiles(1);
    const pack = buildContextPack(cwd, { now: new Date("2026-07-01T00:00:00Z") });
    const [prefix, footer] = pack.split(VOLATILE_MARKER);
    expect(prefix).not.toContain("generated:");
    expect(footer).toContain("generated:");
  });

  test("respects the token budget by truncating files", () => {
    seedFiles(200);
    const small = buildContextPack(cwd, { budgetTokens: 120, now: new Date("2026-07-01T00:00:00Z") });
    const large = buildContextPack(cwd, { budgetTokens: 5000, now: new Date("2026-07-01T00:00:00Z") });
    expect(small).toContain("budget reached");
    expect(small.length).toBeLessThan(large.length);
  });

  test("ranks recurring bugs first (deterministic)", () => {
    seedBug("rare bug", 1);
    seedBug("common bug", 9);
    const pack = buildContextPack(cwd, { now: new Date("2026-07-01T00:00:00Z") });
    expect(pack.indexOf("common bug")).toBeLessThan(pack.indexOf("rare bug"));
  });

  test("empty project produces a header and footer without crashing", () => {
    const pack = buildContextPack(cwd, { now: new Date("2026-07-01T00:00:00Z") });
    expect(pack).toContain("Mink context pack");
    expect(pack).toContain(VOLATILE_MARKER);
    expect(pack).toContain("files: 0");
  });
});
