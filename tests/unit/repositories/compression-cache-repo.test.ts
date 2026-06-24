import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { CompressionCacheRepo } from "../../../src/repositories/compression-cache-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-cc-repo-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-cc-repo-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("CompressionCacheRepo", () => {
  test("store then get returns the byte-exact original", () => {
    const repo = new CompressionCacheRepo(openProjectDb(cwd));
    const original = "line one\nline two\nbinary-ish: \tééé\nend";
    const token = repo.store({
      toolName: "Grep", contentKind: "search",
      content: original, retentionHours: 168,
    }, "dev-a");

    const got = repo.get(token);
    expect(got).not.toBeNull();
    expect(got!.content).toBe(original);
    expect(got!.toolName).toBe("Grep");
    expect(got!.contentKind).toBe("search");
  });

  test("unknown token is a miss", () => {
    const repo = new CompressionCacheRepo(openProjectDb(cwd));
    expect(repo.get("mc-nope1234")).toBeNull();
  });

  test("expired token is a miss and is evicted", () => {
    const repo = new CompressionCacheRepo(openProjectDb(cwd));
    const past = new Date("2026-01-01T00:00:00.000Z");
    const token = repo.store({
      toolName: "Bash", contentKind: "log",
      content: "old output", retentionHours: 1, now: past,
    }, "dev-a");

    // 2 hours later, the 1-hour TTL has elapsed.
    const later = new Date(past.getTime() + 2 * 3_600_000);
    expect(repo.get(token, later)).toBeNull();
    expect(repo.count()).toBe(0); // evicted on the miss
  });

  test("token still valid within the retention window", () => {
    const repo = new CompressionCacheRepo(openProjectDb(cwd));
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    const token = repo.store({
      toolName: "Read", contentKind: "file",
      content: "still here", retentionHours: 24, now: t0,
    }, "dev-a");
    const within = new Date(t0.getTime() + 12 * 3_600_000);
    expect(repo.get(token, within)?.content).toBe("still here");
  });

  test("evictExpired removes only elapsed rows", () => {
    const repo = new CompressionCacheRepo(openProjectDb(cwd));
    const t0 = new Date("2026-01-01T00:00:00.000Z");
    repo.store({ toolName: "Bash", contentKind: "log", content: "a", retentionHours: 1, now: t0 }, "dev-a");
    repo.store({ toolName: "Bash", contentKind: "log", content: "b", retentionHours: 100, now: t0 }, "dev-a");
    const later = new Date(t0.getTime() + 2 * 3_600_000);
    expect(repo.evictExpired(later)).toBe(1);
    expect(repo.count()).toBe(1);
  });

  test("newToken is unique and prefixed", () => {
    const a = CompressionCacheRepo.newToken();
    const b = CompressionCacheRepo.newToken();
    expect(a).not.toBe(b);
    expect(a.startsWith("mc-")).toBe(true);
  });
});
