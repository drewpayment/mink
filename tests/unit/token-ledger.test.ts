import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createEmptyLedger,
  isTokenLedger,
  loadLedger,
  saveLedger,
  summaryToLedgerSession,
  appendSession,
  updateSession,
  archiveIfNeeded,
  loadArchive,
  saveArchive,
  createLedgerFinalizer,
} from "../../src/core/token-ledger";
import type { TokenLedger, LedgerSession } from "../../src/types/token-ledger";
import type { SessionSummary } from "../../src/types/session";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "2024-01-01T00:00:00.000Z-abcd",
    startTimestamp: "2024-01-01T00:00:00.000Z",
    endTimestamp: "2024-01-01T01:00:00.000Z",
    reads: [
      { filePath: "/src/a.ts", estimatedTokens: 100, readCount: 1, firstReadAt: "2024-01-01T00:00:00.000Z" },
      { filePath: "/src/b.ts", estimatedTokens: 200, readCount: 2, firstReadAt: "2024-01-01T00:00:00.000Z" },
    ],
    writes: [
      { filePath: "/src/c.ts", action: "create", estimatedTokens: 300, timestamp: "2024-01-01T00:30:00.000Z" },
    ],
    totals: {
      readCount: 2,
      writeCount: 1,
      estimatedTokens: 600,
      repeatedReads: 1,
      fileIndexHits: 1,
      fileIndexMisses: 1,
    },
    estimatedSavings: 400,
    ...overrides,
  };
}

function makeSession(id: string = "sess-1"): LedgerSession {
  return {
    sessionId: id,
    startTimestamp: "2024-01-01T00:00:00.000Z",
    endTimestamp: "2024-01-01T01:00:00.000Z",
    reads: [{ filePath: "/src/a.ts", estimatedTokens: 100, readCount: 1 }],
    writes: [{ filePath: "/src/b.ts", estimatedTokens: 200, action: "edit" }],
    totals: {
      readCount: 1,
      writeCount: 1,
      estimatedTokens: 300,
      repeatedReads: 0,
      fileIndexHits: 1,
      fileIndexMisses: 0,
    },
    estimatedSavings: 200,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `mink-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Task 2: Core functions ────────────────────────────────────────────────────

describe("createEmptyLedger", () => {
  test("returns ledger with zeroed lifetime counters", () => {
    const ledger = createEmptyLedger();
    expect(ledger.lifetime).toEqual({
      totalTokens: 0,
      totalReads: 0,
      totalWrites: 0,
      totalSessions: 0,
      totalFileIndexHits: 0,
      totalFileIndexMisses: 0,
      totalRepeatedReads: 0,
      totalEstimatedSavings: 0,
    });
  });

  test("returns ledger with empty sessions array", () => {
    const ledger = createEmptyLedger();
    expect(ledger.sessions).toEqual([]);
  });
});

describe("isTokenLedger", () => {
  test("returns true for a valid ledger", () => {
    const ledger = createEmptyLedger();
    expect(isTokenLedger(ledger)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isTokenLedger(null)).toBe(false);
  });

  test("returns false for object without sessions array", () => {
    expect(isTokenLedger({ lifetime: {} })).toBe(false);
  });

  test("returns false for object without lifetime", () => {
    expect(isTokenLedger({ sessions: [] })).toBe(false);
  });

  test("returns false for primitive", () => {
    expect(isTokenLedger(42)).toBe(false);
    expect(isTokenLedger("string")).toBe(false);
  });
});

describe("loadLedger", () => {
  test("returns empty ledger when file does not exist", () => {
    const path = join(tmpDir, "nonexistent.json");
    const ledger = loadLedger(path);
    expect(isTokenLedger(ledger)).toBe(true);
    expect(ledger.sessions).toEqual([]);
  });

  test("loads a valid ledger from disk", () => {
    const path = join(tmpDir, "ledger.json");
    const original = createEmptyLedger();
    original.lifetime.totalSessions = 5;
    saveLedger(path, original);

    const loaded = loadLedger(path);
    expect(loaded.lifetime.totalSessions).toBe(5);
  });

  test("returns empty ledger on corrupt file", () => {
    const path = join(tmpDir, "corrupt.json");
    require("fs").writeFileSync(path, "not json!!!");
    const ledger = loadLedger(path);
    expect(ledger.sessions).toEqual([]);
  });

  test("returns empty ledger when file contains non-ledger JSON", () => {
    const path = join(tmpDir, "wrong.json");
    require("fs").writeFileSync(path, JSON.stringify({ foo: "bar" }));
    const ledger = loadLedger(path);
    expect(ledger.sessions).toEqual([]);
  });
});

describe("saveLedger", () => {
  test("writes valid JSON to the path", () => {
    const path = join(tmpDir, "ledger.json");
    const ledger = createEmptyLedger();
    saveLedger(path, ledger);
    expect(existsSync(path)).toBe(true);
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    expect(isTokenLedger(raw)).toBe(true);
  });

  test("round-trips through load", () => {
    const path = join(tmpDir, "ledger.json");
    const ledger = createEmptyLedger();
    ledger.lifetime.totalTokens = 999;
    saveLedger(path, ledger);
    const loaded = loadLedger(path);
    expect(loaded.lifetime.totalTokens).toBe(999);
  });
});

// ── Task 3: Append Session ────────────────────────────────────────────────────

describe("summaryToLedgerSession", () => {
  test("transforms summary to ledger session correctly", () => {
    const summary = makeSummary();
    const session = summaryToLedgerSession(summary);

    expect(session.sessionId).toBe(summary.sessionId);
    expect(session.startTimestamp).toBe(summary.startTimestamp);
    expect(session.endTimestamp).toBe(summary.endTimestamp);
    expect(session.estimatedSavings).toBe(summary.estimatedSavings);
  });

  test("maps reads to filePath, estimatedTokens, readCount", () => {
    const summary = makeSummary();
    const session = summaryToLedgerSession(summary);

    expect(session.reads).toHaveLength(2);
    expect(session.reads[0]).toEqual({
      filePath: "/src/a.ts",
      estimatedTokens: 100,
      readCount: 1,
    });
    expect(session.reads[1]).toEqual({
      filePath: "/src/b.ts",
      estimatedTokens: 200,
      readCount: 2,
    });
  });

  test("maps writes to filePath, estimatedTokens, action", () => {
    const summary = makeSummary();
    const session = summaryToLedgerSession(summary);

    expect(session.writes).toHaveLength(1);
    expect(session.writes[0]).toEqual({
      filePath: "/src/c.ts",
      estimatedTokens: 300,
      action: "create",
    });
  });

  test("copies totals including fileIndexHits/fileIndexMisses", () => {
    const summary = makeSummary();
    const session = summaryToLedgerSession(summary);

    expect(session.totals).toEqual({
      readCount: 2,
      writeCount: 1,
      estimatedTokens: 600,
      repeatedReads: 1,
      fileIndexHits: 1,
      fileIndexMisses: 1,
    });
  });
});

describe("appendSession", () => {
  test("appends to empty ledger", () => {
    const ledger = createEmptyLedger();
    const summary = makeSummary();
    appendSession(ledger, summary);
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0].sessionId).toBe(summary.sessionId);
  });

  test("increments totalSessions in lifetime", () => {
    const ledger = createEmptyLedger();
    appendSession(ledger, makeSummary());
    expect(ledger.lifetime.totalSessions).toBe(1);
  });

  test("adds session totals to lifetime counters", () => {
    const ledger = createEmptyLedger();
    const summary = makeSummary();
    appendSession(ledger, summary);

    expect(ledger.lifetime.totalTokens).toBe(600);
    expect(ledger.lifetime.totalReads).toBe(2);
    expect(ledger.lifetime.totalWrites).toBe(1);
    expect(ledger.lifetime.totalFileIndexHits).toBe(1);
    expect(ledger.lifetime.totalFileIndexMisses).toBe(1);
    expect(ledger.lifetime.totalRepeatedReads).toBe(1);
    expect(ledger.lifetime.totalEstimatedSavings).toBe(400);
  });

  test("accumulates across multiple appends", () => {
    const ledger = createEmptyLedger();
    appendSession(ledger, makeSummary({ sessionId: "sess-1" }));
    appendSession(ledger, makeSummary({ sessionId: "sess-2" }));
    appendSession(ledger, makeSummary({ sessionId: "sess-3" }));

    expect(ledger.sessions).toHaveLength(3);
    expect(ledger.lifetime.totalSessions).toBe(3);
    expect(ledger.lifetime.totalTokens).toBe(1800);
  });

  test("existing sessions are unchanged", () => {
    const ledger = createEmptyLedger();
    const firstSummary = makeSummary({ sessionId: "first" });
    appendSession(ledger, firstSummary);
    const firstSession = ledger.sessions[0];

    appendSession(ledger, makeSummary({ sessionId: "second" }));
    expect(ledger.sessions[0]).toEqual(firstSession);
  });
});

// ── Task 4: Update Session ────────────────────────────────────────────────────

describe("updateSession", () => {
  test("replaces existing session by sessionId", () => {
    const ledger = createEmptyLedger();
    appendSession(ledger, makeSummary({ sessionId: "sess-1" }));

    const updated = makeSummary({
      sessionId: "sess-1",
      totals: {
        readCount: 5,
        writeCount: 2,
        estimatedTokens: 1000,
        repeatedReads: 2,
        fileIndexHits: 3,
        fileIndexMisses: 2,
      },
      estimatedSavings: 800,
    });
    updateSession(ledger, updated);

    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0].totals.estimatedTokens).toBe(1000);
  });

  test("adjusts lifetime by delta when replacing", () => {
    const ledger = createEmptyLedger();
    appendSession(ledger, makeSummary({ sessionId: "sess-1", estimatedSavings: 400 }));

    const updated = makeSummary({
      sessionId: "sess-1",
      totals: {
        readCount: 5,
        writeCount: 2,
        estimatedTokens: 1000,
        repeatedReads: 2,
        fileIndexHits: 3,
        fileIndexMisses: 2,
      },
      estimatedSavings: 800,
    });
    updateSession(ledger, updated);

    // Lifetime should reflect new session, not old
    expect(ledger.lifetime.totalTokens).toBe(1000);
    expect(ledger.lifetime.totalSessions).toBe(1);
    expect(ledger.lifetime.totalEstimatedSavings).toBe(800);
  });

  test("falls back to append when session not found", () => {
    const ledger = createEmptyLedger();
    const summary = makeSummary({ sessionId: "unknown" });
    updateSession(ledger, summary);

    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.lifetime.totalSessions).toBe(1);
  });

  test("preserves other sessions when updating", () => {
    const ledger = createEmptyLedger();
    appendSession(ledger, makeSummary({ sessionId: "sess-1" }));
    appendSession(ledger, makeSummary({ sessionId: "sess-2" }));
    appendSession(ledger, makeSummary({ sessionId: "sess-3" }));

    const updated = makeSummary({ sessionId: "sess-2", estimatedSavings: 999 });
    updateSession(ledger, updated);

    expect(ledger.sessions).toHaveLength(3);
    expect(ledger.sessions[0].sessionId).toBe("sess-1");
    expect(ledger.sessions[1].estimatedSavings).toBe(999);
    expect(ledger.sessions[2].sessionId).toBe("sess-3");
  });
});

// ── Task 5: Archive ───────────────────────────────────────────────────────────

describe("archiveIfNeeded", () => {
  test("no-op when sessions count is at threshold", () => {
    const ledger = createEmptyLedger();
    for (let i = 0; i < 5; i++) {
      ledger.sessions.push(makeSession(`sess-${i}`));
    }
    const { archived } = archiveIfNeeded(ledger, 5);
    expect(archived).toHaveLength(0);
    expect(ledger.sessions).toHaveLength(5);
  });

  test("no-op when sessions count is below threshold", () => {
    const ledger = createEmptyLedger();
    ledger.sessions.push(makeSession("sess-1"));
    const { archived } = archiveIfNeeded(ledger, 1000);
    expect(archived).toHaveLength(0);
    expect(ledger.sessions).toHaveLength(1);
  });

  test("archives oldest sessions when over threshold", () => {
    const ledger = createEmptyLedger();
    for (let i = 0; i < 5; i++) {
      ledger.sessions.push(makeSession(`sess-${i}`));
    }
    const { archived } = archiveIfNeeded(ledger, 3);
    expect(archived).toHaveLength(2);
    expect(archived[0].sessionId).toBe("sess-0");
    expect(archived[1].sessionId).toBe("sess-1");
    expect(ledger.sessions).toHaveLength(3);
    expect(ledger.sessions[0].sessionId).toBe("sess-2");
  });

  test("does not adjust lifetime counters when archiving", () => {
    const ledger = createEmptyLedger();
    for (let i = 0; i < 5; i++) {
      appendSession(ledger, makeSummary({ sessionId: `sess-${i}` }));
    }
    const lifetimeBefore = { ...ledger.lifetime };
    archiveIfNeeded(ledger, 3);
    expect(ledger.lifetime).toEqual(lifetimeBefore);
  });

  test("threshold of 0 is a no-op", () => {
    const ledger = createEmptyLedger();
    for (let i = 0; i < 10; i++) {
      ledger.sessions.push(makeSession(`sess-${i}`));
    }
    const { archived } = archiveIfNeeded(ledger, 0);
    expect(archived).toHaveLength(0);
    expect(ledger.sessions).toHaveLength(10);
  });

  test("negative threshold is a no-op", () => {
    const ledger = createEmptyLedger();
    for (let i = 0; i < 10; i++) {
      ledger.sessions.push(makeSession(`sess-${i}`));
    }
    const { archived } = archiveIfNeeded(ledger, -5);
    expect(archived).toHaveLength(0);
    expect(ledger.sessions).toHaveLength(10);
  });
});

describe("loadArchive", () => {
  test("returns empty array when file does not exist", () => {
    const path = join(tmpDir, "nonexistent-archive.json");
    expect(loadArchive(path)).toEqual([]);
  });

  test("returns empty array on corrupt file", () => {
    const path = join(tmpDir, "corrupt-archive.json");
    require("fs").writeFileSync(path, "{{not valid json");
    expect(loadArchive(path)).toEqual([]);
  });

  test("returns empty array when file contains non-array JSON", () => {
    const path = join(tmpDir, "wrong-archive.json");
    require("fs").writeFileSync(path, JSON.stringify({ foo: "bar" }));
    expect(loadArchive(path)).toEqual([]);
  });

  test("loads an existing archive", () => {
    const path = join(tmpDir, "archive.json");
    const sessions = [makeSession("sess-1"), makeSession("sess-2")];
    require("fs").writeFileSync(path, JSON.stringify(sessions));
    const loaded = loadArchive(path);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].sessionId).toBe("sess-1");
  });
});

describe("saveArchive", () => {
  test("saves newly archived sessions", () => {
    const path = join(tmpDir, "archive.json");
    const sessions = [makeSession("sess-1")];
    saveArchive(path, sessions);
    const loaded = loadArchive(path);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sessionId).toBe("sess-1");
  });

  test("prepends new sessions to existing archive", () => {
    const path = join(tmpDir, "archive.json");
    const existing = [makeSession("old-1"), makeSession("old-2")];
    require("fs").writeFileSync(path, JSON.stringify(existing));

    const newSessions = [makeSession("new-1")];
    saveArchive(path, newSessions);

    const loaded = loadArchive(path);
    expect(loaded).toHaveLength(3);
    expect(loaded[0].sessionId).toBe("new-1");
    expect(loaded[1].sessionId).toBe("old-1");
    expect(loaded[2].sessionId).toBe("old-2");
  });

  test("handles missing archive gracefully on first save", () => {
    const path = join(tmpDir, "new-archive.json");
    const sessions = [makeSession("sess-1"), makeSession("sess-2")];
    saveArchive(path, sessions);
    const loaded = loadArchive(path);
    expect(loaded).toHaveLength(2);
  });
});

// ── Task 7/8: Property Tests ──────────────────────────────────────────────────

describe("properties", () => {
  test("lifetime counters equal sum of session values after N appends", () => {
    const ledger = createEmptyLedger();
    const summaries = [
      makeSummary({ sessionId: "prop-1" }),
      makeSummary({
        sessionId: "prop-2",
        totals: {
          readCount: 3,
          writeCount: 2,
          estimatedTokens: 900,
          repeatedReads: 2,
          fileIndexHits: 3,
          fileIndexMisses: 2,
        },
        estimatedSavings: 600,
      }),
      makeSummary({
        sessionId: "prop-3",
        totals: {
          readCount: 5,
          writeCount: 0,
          estimatedTokens: 1500,
          repeatedReads: 0,
          fileIndexHits: 5,
          fileIndexMisses: 0,
        },
        estimatedSavings: 1000,
      }),
    ];

    for (const s of summaries) {
      appendSession(ledger, s);
    }

    const totalTokens = ledger.sessions.reduce((sum, s) => sum + s.totals.estimatedTokens, 0);
    const totalReads = ledger.sessions.reduce((sum, s) => sum + s.totals.readCount, 0);
    const totalWrites = ledger.sessions.reduce((sum, s) => sum + s.totals.writeCount, 0);
    const totalSessions = ledger.sessions.length;
    const totalFileIndexHits = ledger.sessions.reduce((sum, s) => sum + s.totals.fileIndexHits, 0);
    const totalFileIndexMisses = ledger.sessions.reduce((sum, s) => sum + s.totals.fileIndexMisses, 0);
    const totalRepeatedReads = ledger.sessions.reduce((sum, s) => sum + s.totals.repeatedReads, 0);
    const totalEstimatedSavings = ledger.sessions.reduce((sum, s) => sum + s.estimatedSavings, 0);

    expect(ledger.lifetime.totalTokens).toBe(totalTokens);
    expect(ledger.lifetime.totalReads).toBe(totalReads);
    expect(ledger.lifetime.totalWrites).toBe(totalWrites);
    expect(ledger.lifetime.totalSessions).toBe(totalSessions);
    expect(ledger.lifetime.totalFileIndexHits).toBe(totalFileIndexHits);
    expect(ledger.lifetime.totalFileIndexMisses).toBe(totalFileIndexMisses);
    expect(ledger.lifetime.totalRepeatedReads).toBe(totalRepeatedReads);
    expect(ledger.lifetime.totalEstimatedSavings).toBe(totalEstimatedSavings);
  });

  test("lifetime counters remain correct after update", () => {
    const ledger = createEmptyLedger();
    const s1 = makeSummary({ sessionId: "prop-s1" });
    const s2 = makeSummary({ sessionId: "prop-s2" });
    appendSession(ledger, s1);
    appendSession(ledger, s2);

    // Update s1 with different values
    const s1Updated = makeSummary({
      sessionId: "prop-s1",
      totals: {
        readCount: 10,
        writeCount: 5,
        estimatedTokens: 2000,
        repeatedReads: 3,
        fileIndexHits: 7,
        fileIndexMisses: 3,
      },
      estimatedSavings: 1500,
    });
    updateSession(ledger, s1Updated);

    const totalTokens = ledger.sessions.reduce((sum, s) => sum + s.totals.estimatedTokens, 0);
    const totalReads = ledger.sessions.reduce((sum, s) => sum + s.totals.readCount, 0);
    const totalWrites = ledger.sessions.reduce((sum, s) => sum + s.totals.writeCount, 0);
    const totalEstimatedSavings = ledger.sessions.reduce((sum, s) => sum + s.estimatedSavings, 0);

    expect(ledger.lifetime.totalTokens).toBe(totalTokens);
    expect(ledger.lifetime.totalReads).toBe(totalReads);
    expect(ledger.lifetime.totalWrites).toBe(totalWrites);
    expect(ledger.lifetime.totalSessions).toBe(2);
    expect(ledger.lifetime.totalEstimatedSavings).toBe(totalEstimatedSavings);
  });

  test("sessions array is strictly append-only", () => {
    const ledger = createEmptyLedger();
    appendSession(ledger, makeSummary({ sessionId: "ao-1" }));
    const snapshot1 = JSON.stringify(ledger.sessions[0]);

    appendSession(ledger, makeSummary({ sessionId: "ao-2" }));
    const snapshot1After2 = JSON.stringify(ledger.sessions[0]);

    appendSession(ledger, makeSummary({ sessionId: "ao-3" }));
    const snapshot1After3 = JSON.stringify(ledger.sessions[0]);

    expect(snapshot1After2).toBe(snapshot1);
    expect(snapshot1After3).toBe(snapshot1);
  });
});

// ── Task 6: Ledger Finalizer Factory ─────────────────────────────────────────

describe("createLedgerFinalizer", () => {
  test("appendSession creates ledger and writes it to disk", () => {
    const finalizer = createLedgerFinalizer(tmpDir);
    const summary = makeSummary({ sessionId: "sess-1" });
    finalizer.appendSession(summary);

    const ledgerPath = join(tmpDir, "token-ledger.json");
    expect(existsSync(ledgerPath)).toBe(true);
    const ledger = loadLedger(ledgerPath);
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0].sessionId).toBe("sess-1");
    expect(ledger.lifetime.totalSessions).toBe(1);
  });

  test("updateSession replaces session and adjusts lifetime", () => {
    const finalizer = createLedgerFinalizer(tmpDir);
    finalizer.appendSession(makeSummary({ sessionId: "sess-1", estimatedSavings: 400 }));

    const updatedSummary = makeSummary({
      sessionId: "sess-1",
      totals: {
        readCount: 10,
        writeCount: 5,
        estimatedTokens: 2000,
        repeatedReads: 3,
        fileIndexHits: 5,
        fileIndexMisses: 5,
      },
      estimatedSavings: 1200,
    });
    finalizer.updateSession(updatedSummary);

    const ledgerPath = join(tmpDir, "token-ledger.json");
    const ledger = loadLedger(ledgerPath);
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0].totals.estimatedTokens).toBe(2000);
    expect(ledger.lifetime.totalTokens).toBe(2000);
    expect(ledger.lifetime.totalEstimatedSavings).toBe(1200);
  });

  test("archives when threshold is exceeded", () => {
    const finalizer = createLedgerFinalizer(tmpDir, 3);

    for (let i = 0; i < 4; i++) {
      finalizer.appendSession(makeSummary({ sessionId: `sess-${i}` }));
    }

    const ledgerPath = join(tmpDir, "token-ledger.json");
    const archivePath = join(tmpDir, "token-ledger-archive.json");

    const ledger = loadLedger(ledgerPath);
    expect(ledger.sessions).toHaveLength(3);

    const archived = loadArchive(archivePath);
    expect(archived).toHaveLength(1);
    expect(archived[0].sessionId).toBe("sess-0");
  });

  test("multiple appends accumulate in lifetime", () => {
    const finalizer = createLedgerFinalizer(tmpDir);
    for (let i = 0; i < 3; i++) {
      finalizer.appendSession(makeSummary({ sessionId: `sess-${i}` }));
    }

    const ledgerPath = join(tmpDir, "token-ledger.json");
    const ledger = loadLedger(ledgerPath);
    expect(ledger.lifetime.totalSessions).toBe(3);
    expect(ledger.lifetime.totalTokens).toBe(1800);
  });
});
