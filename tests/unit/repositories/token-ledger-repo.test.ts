import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { TokenLedgerRepo } from "../../../src/repositories/token-ledger-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";
import type { SessionSummary } from "../../../src/types/session";

let tmpRoot: string;
let cwd: string;
let projDir: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-tl-repo-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-tl-repo-cwd-"));
  projDir = join(tmpRoot, "projects", projectIdFor(cwd));
  mkdirSync(projDir, { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function makeSummary(sessionId: string, opts: Partial<{
  reads: Array<{ filePath: string; estimatedTokens: number; readCount: number }>;
  writes: Array<{ filePath: string; estimatedTokens: number; action: "create" | "edit" }>;
  tokens: number;
  readCount: number;
  writeCount: number;
  hits: number;
  misses: number;
  savings: number;
}> = {}): SessionSummary {
  return {
    sessionId,
    startTimestamp: "2026-01-01T00:00:00.000Z",
    endTimestamp:   "2026-01-01T01:00:00.000Z",
    reads:  opts.reads ?? [],
    writes: opts.writes ?? [],
    totals: {
      readCount:        opts.readCount  ?? 0,
      writeCount:       opts.writeCount ?? 0,
      estimatedTokens:  opts.tokens     ?? 0,
      repeatedReads:    0,
      fileIndexHits:    opts.hits       ?? 0,
      fileIndexMisses:  opts.misses     ?? 0,
    },
    estimatedSavings: opts.savings ?? 0,
  };
}

describe("TokenLedgerRepo", () => {
  test("appendSession persists totals + reads + writes + lifetime", () => {
    const repo = new TokenLedgerRepo(openProjectDb(cwd));
    repo.appendSession(makeSummary("s1", {
      tokens: 100, readCount: 2, writeCount: 1, hits: 1, misses: 1, savings: 25,
      reads:  [{ filePath: "a.ts", estimatedTokens: 50, readCount: 2 }],
      writes: [{ filePath: "b.ts", estimatedTokens: 50, action: "edit" }],
    }), "dev-a");

    const active = repo.activeSessions();
    expect(active).toHaveLength(1);
    expect(active[0].sessionId).toBe("s1");
    expect(active[0].totals.estimatedTokens).toBe(100);
    expect(active[0].reads).toHaveLength(1);
    expect(active[0].writes).toHaveLength(1);

    const lt = repo.lifetime();
    expect(lt.totalTokens).toBe(100);
    expect(lt.totalSessions).toBe(1);
    expect(lt.totalReads).toBe(2);
    expect(lt.totalWrites).toBe(1);
    expect(lt.totalFileIndexHits).toBe(1);
    expect(lt.totalEstimatedSavings).toBe(25);
  });

  test("updateSession replaces totals + rewires lifetime delta", () => {
    const repo = new TokenLedgerRepo(openProjectDb(cwd));
    repo.appendSession(makeSummary("s1", { tokens: 100, readCount: 5 }), "dev-a");

    repo.updateSession(makeSummary("s1", {
      tokens: 300, readCount: 10,
      reads: [{ filePath: "x.ts", estimatedTokens: 300, readCount: 10 }],
    }), "dev-a");

    const lt = repo.lifetime();
    // Lifetime totals should reflect ONLY the latest values, not 100 + 300.
    expect(lt.totalTokens).toBe(300);
    expect(lt.totalReads).toBe(10);
    expect(lt.totalSessions).toBe(1);

    const sessions = repo.activeSessions();
    expect(sessions[0].totals.estimatedTokens).toBe(300);
    expect(sessions[0].reads).toEqual([
      { filePath: "x.ts", estimatedTokens: 300, readCount: 10 },
    ]);
  });

  test("updateSession on unknown session falls through to insert", () => {
    const repo = new TokenLedgerRepo(openProjectDb(cwd));
    repo.updateSession(makeSummary("never-seen", { tokens: 50 }), "dev-a");
    expect(repo.activeSessions()).toHaveLength(1);
    expect(repo.lifetime().totalTokens).toBe(50);
  });

  test("archive flips the oldest sessions past the retention threshold", () => {
    const repo = new TokenLedgerRepo(openProjectDb(cwd));
    for (let i = 0; i < 5; i++) {
      repo.appendSession({
        ...makeSummary(`s${i}`),
        startTimestamp: `2026-01-0${i + 1}T00:00:00.000Z`,
      }, "dev-a");
    }
    const archivedCount = repo.archive(2);
    expect(archivedCount).toBe(3);
    const active = repo.activeSessions().map((s) => s.sessionId);
    const archived = repo.archivedSessions().map((s) => s.sessionId);
    expect(active.sort()).toEqual(["s3", "s4"]);
    expect(archived.sort()).toEqual(["s0", "s1", "s2"]);
  });

  test("archive is a no-op when within threshold", () => {
    const repo = new TokenLedgerRepo(openProjectDb(cwd));
    repo.appendSession(makeSummary("s1"), "dev-a");
    expect(repo.archive(10)).toBe(0);
    expect(repo.activeSessions()).toHaveLength(1);
  });

  test("lifetime sums across multiple devices", () => {
    const repo = new TokenLedgerRepo(openProjectDb(cwd));
    repo.appendSession(makeSummary("s-a", { tokens: 100 }), "dev-a");
    repo.appendSession(makeSummary("s-b", { tokens: 200 }), "dev-b");
    repo.appendSession(makeSummary("s-c", { tokens: 50 }),  "dev-a");
    const lt = repo.lifetime();
    expect(lt.totalTokens).toBe(350);
    expect(lt.totalSessions).toBe(3);
  });

  test("snapshot returns TokenLedger with sessions ordered by start_timestamp", () => {
    const repo = new TokenLedgerRepo(openProjectDb(cwd));
    repo.appendSession({
      ...makeSummary("s2"),
      startTimestamp: "2026-02-01T00:00:00.000Z",
    }, "dev-a");
    repo.appendSession({
      ...makeSummary("s1"),
      startTimestamp: "2026-01-01T00:00:00.000Z",
    }, "dev-a");
    const snap = repo.snapshot();
    expect(snap.sessions.map((s) => s.sessionId)).toEqual(["s1", "s2"]);
  });

  test("replaceWasteFlagsForDevice round-trips through snapshot()", () => {
    const repo = new TokenLedgerRepo(openProjectDb(cwd));
    repo.replaceWasteFlagsForDevice("dev-a", [
      {
        pattern: "repeated-reads",
        description: "20% of reads were repeated",
        estimatedTokensWasted: 1200,
        suggestion: "Use the index lookup more often",
        detectedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const snap = repo.snapshot();
    expect(snap.wasteFlags).toHaveLength(1);
    expect(snap.wasteFlags?.[0].pattern).toBe("repeated-reads");
    expect(snap.wasteFlags?.[0].estimatedTokensWasted).toBe(1200);

    // Replacing again deletes the prior set.
    repo.replaceWasteFlagsForDevice("dev-a", []);
    expect(repo.snapshot().wasteFlags).toBeUndefined();
  });

  test("static for(cwd) writes and reads through the project DB", () => {
    TokenLedgerRepo.for(cwd).appendSession(makeSummary("via-static", { tokens: 1 }), "dev-a");
    expect(TokenLedgerRepo.for(cwd).lifetime().totalTokens).toBe(1);
  });

  describe("compression measurement", () => {
    test("recordCompression credits a compressed arm with measured savings", () => {
      const repo = new TokenLedgerRepo(openProjectDb(cwd));
      repo.recordCompression({
        toolName: "Grep", contentKind: "search",
        originalTokens: 1000, compressedTokens: 200, holdout: false,
      }, "dev-a");

      const lt = repo.compressionLifetime();
      expect(lt.totalEvents).toBe(1);
      expect(lt.totalHoldoutEvents).toBe(0);
      expect(lt.totalOriginalTokens).toBe(1000);
      expect(lt.totalCompressedTokens).toBe(200);
      expect(lt.totalMeasuredSavings).toBe(800);
    });

    test("a holdout arm records tokens but saves nothing", () => {
      const repo = new TokenLedgerRepo(openProjectDb(cwd));
      repo.recordCompression({
        toolName: "Read", contentKind: "file",
        originalTokens: 1200, compressedTokens: 1200, holdout: true,
      }, "dev-a");

      const lt = repo.compressionLifetime();
      expect(lt.totalEvents).toBe(1);
      expect(lt.totalHoldoutEvents).toBe(1);
      expect(lt.totalOriginalTokens).toBe(1200);
      expect(lt.totalMeasuredSavings).toBe(0);
    });

    test("compressionLifetime sums across devices", () => {
      const repo = new TokenLedgerRepo(openProjectDb(cwd));
      repo.recordCompression({ toolName: "Grep", contentKind: "search", originalTokens: 1000, compressedTokens: 400, holdout: false }, "dev-a");
      repo.recordCompression({ toolName: "Bash", contentKind: "log",    originalTokens: 2000, compressedTokens: 500, holdout: false }, "dev-b");
      const lt = repo.compressionLifetime();
      expect(lt.totalEvents).toBe(2);
      expect(lt.totalMeasuredSavings).toBe(600 + 1500);
    });

    test("compressionEvents returns recorded rows newest-first", () => {
      const repo = new TokenLedgerRepo(openProjectDb(cwd));
      repo.recordCompression({ toolName: "Grep", contentKind: "search", originalTokens: 900, compressedTokens: 300, holdout: false, createdAt: "2026-01-01T00:00:00.000Z" }, "dev-a");
      repo.recordCompression({ toolName: "Bash", contentKind: "log",    originalTokens: 900, compressedTokens: 300, holdout: false, createdAt: "2026-01-02T00:00:00.000Z" }, "dev-a");
      const events = repo.compressionEvents();
      expect(events).toHaveLength(2);
      expect(events[0].toolName).toBe("Bash");
      expect(events[0].holdout).toBe(false);
    });

    test("compressionLifetime is zeroed when nothing has been recorded", () => {
      const repo = new TokenLedgerRepo(openProjectDb(cwd));
      const lt = repo.compressionLifetime();
      expect(lt.totalEvents).toBe(0);
      expect(lt.totalMeasuredSavings).toBe(0);
    });
  });
});
