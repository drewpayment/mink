import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  findSimilarTasks,
  formatSimilarTasks,
  jaccard,
  sessionFiles,
} from "../../src/core/similar-tasks";
import { TokenLedgerRepo } from "../../src/repositories/token-ledger-repo";
import { _resetDbCacheForTests } from "../../src/storage/db";
import { projectIdFor } from "../../src/core/project-id";
import type { SessionSummary } from "../../src/types/session";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-sim-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-sim-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function addSession(id: string, start: string, files: string[]): void {
  const summary: SessionSummary = {
    sessionId: id,
    startTimestamp: start,
    endTimestamp: start,
    reads: files.map((f) => ({ filePath: f, estimatedTokens: 10, readCount: 1, firstReadAt: start })),
    writes: [],
    totals: {
      readCount: files.length,
      writeCount: 0,
      estimatedTokens: 10 * files.length,
      repeatedReads: 0,
      fileIndexHits: 0,
      fileIndexMisses: 0,
    },
    estimatedSavings: 0,
  };
  TokenLedgerRepo.for(cwd).appendSession(summary, "dev-a");
}

describe("jaccard + sessionFiles", () => {
  test("jaccard of overlapping sets", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["b", "c"]))).toBeCloseTo(1 / 3, 6);
  });
  test("empty set → 0", () => {
    expect(jaccard(new Set(), new Set(["a"]))).toBe(0);
  });
  test("sessionFiles unions reads and writes", () => {
    const s = {
      sessionId: "x", startTimestamp: "t", endTimestamp: "t",
      reads: [{ filePath: "a", estimatedTokens: 1, readCount: 1 }],
      writes: [{ filePath: "b", estimatedTokens: 1, action: "edit" as const }],
      totals: { readCount: 1, writeCount: 1, estimatedTokens: 2, repeatedReads: 0, fileIndexHits: 0, fileIndexMisses: 0 },
      estimatedSavings: 0,
    };
    expect([...sessionFiles(s)].sort()).toEqual(["a", "b"]);
  });
});

describe("findSimilarTasks", () => {
  test("ranks by file overlap (Jaccard)", () => {
    addSession("s1", "2026-01-01T00:00:00Z", ["src/auth.ts", "src/user.ts"]);
    addSession("s2", "2026-01-02T00:00:00Z", ["src/payment.ts"]);
    const res = findSimilarTasks(cwd, { files: ["src/auth.ts", "src/user.ts", "src/session.ts"] });
    expect(res[0].sessionId).toBe("s1");
    expect(res[0].sharedFiles).toEqual(["src/auth.ts", "src/user.ts"]);
    expect(res.find((r) => r.sessionId === "s2")).toBeUndefined(); // no overlap
  });

  test("excludes a session by id", () => {
    addSession("cur", "2026-01-03T00:00:00Z", ["src/a.ts"]);
    const res = findSimilarTasks(cwd, { files: ["src/a.ts"], excludeSessionId: "cur" });
    expect(res).toHaveLength(0);
  });

  test("query matches against file paths", () => {
    addSession("s1", "2026-01-01T00:00:00Z", ["src/payment/stripe.ts"]);
    addSession("s2", "2026-01-02T00:00:00Z", ["src/auth/login.ts"]);
    const res = findSimilarTasks(cwd, { query: "stripe payment" });
    expect(res[0].sessionId).toBe("s1");
  });

  test("deterministic tie-break prefers the newer session", () => {
    addSession("old", "2026-01-01T00:00:00Z", ["src/a.ts"]);
    addSession("new", "2026-06-01T00:00:00Z", ["src/a.ts"]);
    const res = findSimilarTasks(cwd, { files: ["src/a.ts"] });
    expect(res[0].sessionId).toBe("new"); // same score → newer wins
  });

  test("no signal yields no results", () => {
    addSession("s1", "2026-01-01T00:00:00Z", ["src/a.ts"]);
    expect(findSimilarTasks(cwd, {})).toHaveLength(0);
  });
});

describe("formatSimilarTasks", () => {
  test("empty → plain message", () => {
    expect(formatSimilarTasks([])).toContain("No similar prior tasks");
  });
});
