// Integration test for Phase 5's incremental scan path. Builds a tiny
// project on disk, runs scan twice, and checks that the second run skips
// unchanged files and only re-extracts files whose content actually
// changed.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { scan } from "../../src/commands/scan";
import { FileIndexRepo } from "../../src/repositories/file-index-repo";
import { _resetDbCacheForTests } from "../../src/storage/db";
import { projectIdFor } from "../../src/core/project-id";

let tmpRoot: string;
let cwd: string;

const originalLog = console.log;
let logs: string[];

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-incr-scan-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-incr-scan-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
  logs = [];
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.log = originalLog;
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function lastLog(): string {
  return logs[logs.length - 1] ?? "";
}

describe("incremental scan", () => {
  test("first scan extracts every file", () => {
    writeFileSync(join(cwd, "a.ts"), "export const a = 1;\n");
    writeFileSync(join(cwd, "b.ts"), "export const b = 2;\n");

    scan(cwd, { check: false });

    const repo = FileIndexRepo.for(cwd);
    expect(repo.totalFiles()).toBe(2);
    expect(repo.lookupEntry("a.ts")).not.toBeNull();
    expect(lastLog()).toMatch(/2 re-indexed/);
  });

  test("re-scan with no changes is a no-op", () => {
    writeFileSync(join(cwd, "a.ts"), "export const a = 1;\n");

    scan(cwd, { check: false });
    _resetDbCacheForTests();
    logs = [];

    scan(cwd, { check: false });

    expect(lastLog()).toMatch(/no changes/);
  });

  test("re-scan after editing one file only re-extracts that file", () => {
    writeFileSync(join(cwd, "kept.ts"),    "export const kept = 1;\n");
    writeFileSync(join(cwd, "changed.ts"), "export const v1 = 1;\n");

    scan(cwd, { check: false });
    _resetDbCacheForTests();
    logs = [];

    // Mutate one file. Bump its mtime so the scanner notices.
    writeFileSync(join(cwd, "changed.ts"), "export const v2 = 2;\n");
    const future = new Date(Date.now() + 5_000);
    utimesSync(join(cwd, "changed.ts"), future, future);

    scan(cwd, { check: false });

    expect(lastLog()).toMatch(/1 re-indexed/);
    expect(lastLog()).toMatch(/1 unchanged/);
  });

  test("touch without edit takes the touch-only path", () => {
    writeFileSync(join(cwd, "f.ts"), "export const f = 1;\n");
    scan(cwd, { check: false });
    _resetDbCacheForTests();
    logs = [];

    // Bump mtime but keep contents identical.
    const future = new Date(Date.now() + 5_000);
    utimesSync(join(cwd, "f.ts"), future, future);

    scan(cwd, { check: false });

    expect(lastLog()).toMatch(/1 touch-only/);
  });

  test("re-scan prunes orphans for deleted files", () => {
    writeFileSync(join(cwd, "keep.ts"),   "1");
    writeFileSync(join(cwd, "delete.ts"), "2");
    scan(cwd, { check: false });
    _resetDbCacheForTests();
    logs = [];

    unlinkSync(join(cwd, "delete.ts"));
    scan(cwd, { check: false });

    expect(FileIndexRepo.for(cwd).totalFiles()).toBe(1);
    expect(lastLog()).toMatch(/1 pruned/);
  });
});
