import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { CountersRepo } from "../../../src/repositories/counters-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-ctr-repo-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-ctr-repo-cwd-"));
  const projDir = join(tmpRoot, "projects", projectIdFor(cwd));
  mkdirSync(projDir, { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("CountersRepo", () => {
  test("forDevice returns zeros when no row exists", () => {
    const repo = new CountersRepo(openProjectDb(cwd));
    expect(repo.forDevice("dev-x")).toEqual({ hits: 0, misses: 0 });
  });

  test("incrementHit / incrementMiss accumulate per device", () => {
    const repo = new CountersRepo(openProjectDb(cwd));
    repo.incrementHit("dev-a");
    repo.incrementHit("dev-a");
    repo.incrementMiss("dev-a");
    repo.incrementMiss("dev-b");
    expect(repo.forDevice("dev-a")).toEqual({ hits: 2, misses: 1 });
    expect(repo.forDevice("dev-b")).toEqual({ hits: 0, misses: 1 });
  });

  test("totals sums across all device rows", () => {
    const repo = new CountersRepo(openProjectDb(cwd));
    repo.incrementHit("dev-a");
    repo.incrementMiss("dev-a");
    repo.incrementHit("dev-b");
    repo.incrementMiss("dev-b");
    repo.incrementMiss("dev-b");
    expect(repo.totals()).toEqual({ hits: 2, misses: 3 });
  });

  test("perDevice exposes the full breakdown", () => {
    const repo = new CountersRepo(openProjectDb(cwd));
    repo.incrementHit("dev-a");
    repo.incrementMiss("dev-b");
    const breakdown = repo.perDevice();
    expect(breakdown).toEqual({
      "dev-a": { hits: 1, misses: 0 },
      "dev-b": { hits: 0, misses: 1 },
    });
  });
});
