import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runMergeDriver } from "../../src/core/sync-merge-drivers";
import { parseLearningMemory } from "../../src/core/learning-memory";
import type { FileIndex } from "../../src/types/file-index";
import type { DeviceRegistry } from "../../src/types/config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "mink-merge-driver-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function paths() {
  return {
    base: join(dir, "base"),
    ours: join(dir, "ours"),
    theirs: join(dir, "theirs"),
  };
}

function writeAll(content: { base: string; ours: string; theirs: string }) {
  const p = paths();
  writeFileSync(p.base, content.base);
  writeFileSync(p.ours, content.ours);
  writeFileSync(p.theirs, content.theirs);
  return p;
}

describe("mink-json-union (file-index)", () => {
  test("unions entries by filePath, preferring max(lastModified)", () => {
    const ours: FileIndex = {
      header: {
        lastScanTimestamp: "2026-04-01T00:00:00.000Z",
        totalFiles: 1,
        lifetimeHits: 0,
        lifetimeMisses: 0,
      },
      entries: {
        "src/a.ts": {
          filePath: "src/a.ts",
          description: "ours",
          estimatedTokens: 100,
          lastModified: "2026-04-05T00:00:00.000Z",
          lastIndexed: "2026-04-05T00:00:00.000Z",
        },
      },
    };
    const theirs: FileIndex = {
      header: {
        lastScanTimestamp: "2026-04-10T00:00:00.000Z",
        totalFiles: 1,
        lifetimeHits: 0,
        lifetimeMisses: 0,
      },
      entries: {
        "src/a.ts": {
          filePath: "src/a.ts",
          description: "theirs",
          estimatedTokens: 100,
          lastModified: "2026-04-10T00:00:00.000Z",
          lastIndexed: "2026-04-10T00:00:00.000Z",
        },
        "src/b.ts": {
          filePath: "src/b.ts",
          description: "new",
          estimatedTokens: 50,
          lastModified: "2026-04-08T00:00:00.000Z",
          lastIndexed: "2026-04-08T00:00:00.000Z",
        },
      },
    };
    const p = writeAll({
      base: "{}",
      ours: JSON.stringify(ours),
      theirs: JSON.stringify(theirs),
    });
    const code = runMergeDriver(
      "mink-json-union",
      p.base,
      p.ours,
      p.theirs,
      "file-index.json"
    );
    expect(code).toBe(0);
    const merged: FileIndex = JSON.parse(readFileSync(p.ours, "utf-8"));
    expect(merged.header.totalFiles).toBe(2);
    expect(merged.entries["src/a.ts"].description).toBe("theirs");
    expect(merged.entries["src/b.ts"].description).toBe("new");
    expect(merged.header.lastScanTimestamp).toBe(
      "2026-04-10T00:00:00.000Z"
    );
  });

  test("falls back to ours on garbage input, returns 0", () => {
    const p = writeAll({ base: "{}", ours: "not-json", theirs: "{}" });
    const code = runMergeDriver(
      "mink-json-union",
      p.base,
      p.ours,
      p.theirs,
      "file-index.json"
    );
    expect(code).toBe(0);
    expect(readFileSync(p.ours, "utf-8")).toBe("not-json");
  });
});

describe("mink-learning-memory", () => {
  test("unions section entries deduped by case-insensitive trim", () => {
    const ours = `# Learning Memory — proj

## User Preferences
- prefers TypeScript
- uses VS Code

## Key Learnings

## Do-Not-Repeat

## Decision Log
`;
    const theirs = `# Learning Memory — proj

## User Preferences
- Prefers TypeScript
- prefers tabs

## Key Learnings
- atomic writes everywhere

## Do-Not-Repeat

## Decision Log
- adopted ESM
`;
    const p = writeAll({ base: "", ours, theirs });
    const code = runMergeDriver(
      "mink-learning-memory",
      p.base,
      p.ours,
      p.theirs,
      "learning-memory.md"
    );
    expect(code).toBe(0);
    const merged = parseLearningMemory(readFileSync(p.ours, "utf-8"));
    expect(merged.sections["User Preferences"]).toEqual([
      "prefers TypeScript",
      "uses VS Code",
      "prefers tabs",
    ]);
    expect(merged.sections["Key Learnings"]).toEqual([
      "atomic writes everywhere",
    ]);
    expect(merged.sections["Decision Log"]).toEqual(["adopted ESM"]);
  });
});

describe("mink-devices", () => {
  test("unions device entries, max lastSeen, min firstSeen", () => {
    const ours: DeviceRegistry = {
      devices: {
        "dev-A": {
          name: "macbook",
          hostname: "h1",
          platform: "darwin",
          firstSeen: "2026-04-01T00:00:00.000Z",
          lastSeen: "2026-04-05T00:00:00.000Z",
        },
      },
    };
    const theirs: DeviceRegistry = {
      devices: {
        "dev-A": {
          name: "macbook",
          hostname: "h1",
          platform: "darwin",
          firstSeen: "2026-03-15T00:00:00.000Z",
          lastSeen: "2026-04-10T00:00:00.000Z",
        },
        "dev-B": {
          name: "linux-box",
          hostname: "h2",
          platform: "linux",
          firstSeen: "2026-04-02T00:00:00.000Z",
          lastSeen: "2026-04-09T00:00:00.000Z",
        },
      },
    };
    const p = writeAll({
      base: "{}",
      ours: JSON.stringify(ours),
      theirs: JSON.stringify(theirs),
    });
    const code = runMergeDriver(
      "mink-devices",
      p.base,
      p.ours,
      p.theirs,
      "devices.json"
    );
    expect(code).toBe(0);
    const merged: DeviceRegistry = JSON.parse(readFileSync(p.ours, "utf-8"));
    expect(Object.keys(merged.devices).sort()).toEqual(["dev-A", "dev-B"]);
    expect(merged.devices["dev-A"].firstSeen).toBe(
      "2026-03-15T00:00:00.000Z"
    );
    expect(merged.devices["dev-A"].lastSeen).toBe(
      "2026-04-10T00:00:00.000Z"
    );
    expect(merged.devices["dev-B"].name).toBe("linux-box");
  });
});

describe("dispatcher", () => {
  test("unknown driver name still returns 0 (never blocks merge)", () => {
    const p = writeAll({ base: "", ours: "ours-content", theirs: "" });
    const code = runMergeDriver(
      "mink-nonexistent",
      p.base,
      p.ours,
      p.theirs,
      "x"
    );
    expect(code).toBe(0);
    expect(readFileSync(p.ours, "utf-8")).toBe("ours-content");
  });
});
