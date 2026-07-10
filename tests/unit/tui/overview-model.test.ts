import { describe, test, expect } from "bun:test";
import {
  deriveOverviewModel,
  fmtNum,
  fmtDuration,
  fmtTime,
  fmtDay,
  type OverviewModel,
} from "../../../src/tui/overview-model";
import type {
  OverviewPayload,
  TokenLedgerPayload,
  CompressionPayload,
} from "../../../src/types/dashboard";
import type { LedgerSession } from "../../../src/types/token-ledger";

// ── Fixtures ─────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function makeSession(overrides: Partial<LedgerSession> = {}): LedgerSession {
  return {
    sessionId: "sess-1",
    startTimestamp: isoDaysAgo(0),
    endTimestamp: isoDaysAgo(0),
    reads: [],
    writes: [],
    totals: {
      readCount: 0,
      writeCount: 0,
      estimatedTokens: 0,
      repeatedReads: 0,
      fileIndexHits: 0,
      fileIndexMisses: 0,
    },
    estimatedSavings: 0,
    ...overrides,
  };
}

function makeOverview(overrides: Partial<OverviewPayload> = {}): OverviewPayload {
  return {
    project: { name: "mink", description: "", cwd: "/tmp/proj" },
    daemon: { running: false },
    summary: {
      totalSessions: 0,
      totalTokens: 0,
      totalReads: 0,
      totalWrites: 0,
      estimatedSavings: 0,
    },
    stateFiles: [],
    ...overrides,
  };
}

function makeLedgerPayload(overrides: Partial<TokenLedgerPayload> = {}): TokenLedgerPayload {
  return {
    lifetime: {
      totalTokens: 0,
      totalReads: 0,
      totalWrites: 0,
      totalSessions: 0,
      totalFileIndexHits: 0,
      totalFileIndexMisses: 0,
      totalRepeatedReads: 0,
      totalEstimatedSavings: 0,
    },
    sessions: [],
    wasteFlags: [],
    ...overrides,
  };
}

function makeCompressionPayload(overrides: Partial<CompressionPayload> = {}): CompressionPayload {
  return {
    enabled: false,
    lifetime: {
      totalEvents: 0,
      totalHoldoutEvents: 0,
      totalOriginalTokens: 0,
      totalCompressedTokens: 0,
      totalMeasuredSavings: 0,
    },
    arms: {
      compressed: { events: 0, originalTokens: 0, compressedTokens: 0 },
      holdout: { events: 0, originalTokens: 0 },
    },
    byKind: [],
    byTool: [],
    recent: [],
    ...overrides,
  };
}

const DAY_LABEL_RE = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2}\/\d{1,2}$/;

// ── Empty ledger (fresh project) ────────────────────────────────────────

describe("deriveOverviewModel — empty ledger", () => {
  test("zero-fills the model without crashing", () => {
    const model = deriveOverviewModel(makeOverview(), makeLedgerPayload(), makeCompressionPayload());

    expect(model.project).toBe("mink");
    expect(model.daemon).toEqual({ running: false, uptimeMs: null });
    expect(model.savings).toEqual({ total: 0, heuristic: 0, measured: 0 });
    expect(model.lifetime).toEqual({
      totalTokens: 0,
      totalSessions: 0,
      heuristicSavings: 0,
      measuredSavings: 0,
      compRatioPct: 0,
    });
    expect(model.currentSession).toBeNull();
    expect(model.history).toEqual([]);
    expect(model.compression.hasData).toBe(false);
  });

  test("last7Days has exactly 7 zero-filled entries, oldest first", () => {
    const model = deriveOverviewModel(makeOverview(), makeLedgerPayload(), makeCompressionPayload());

    expect(model.last7Days).toHaveLength(7);
    for (const day of model.last7Days) {
      expect(day.saved).toBe(0);
      expect(day.tokensIn).toBe(0);
      expect(day.writes).toBe(0);
      expect(day.day).toMatch(DAY_LABEL_RE);
    }
    // Oldest-first: the last entry should be "today".
    expect(model.last7Days[6]!.day).toBe(fmtDay(new Date()));
  });

  test("project falls back to em dash when project metadata is missing", () => {
    const model = deriveOverviewModel(
      makeOverview({ project: null }),
      makeLedgerPayload(),
      makeCompressionPayload(),
    );
    expect(model.project).toBe("—");
  });
});

// ── Single session today ────────────────────────────────────────────────

describe("deriveOverviewModel — single session today", () => {
  test("aggregates into today's bucket, current session, and history", () => {
    const session = makeSession({
      sessionId: "today-1",
      startTimestamp: isoDaysAgo(0),
      endTimestamp: "",
      totals: {
        readCount: 5,
        writeCount: 2,
        estimatedTokens: 2000,
        repeatedReads: 0,
        fileIndexHits: 4,
        fileIndexMisses: 1,
      },
      estimatedSavings: 300,
    });
    const model = deriveOverviewModel(
      makeOverview(),
      makeLedgerPayload({ sessions: [session] }),
      makeCompressionPayload(),
    );

    const today = model.last7Days[6]!;
    const writeTokens = 2 * 600; // 1200
    expect(today.writes).toBe(writeTokens);
    expect(today.tokensIn).toBe(Math.max(0, 2000 - writeTokens)); // 800
    expect(today.saved).toBe(300);

    expect(model.currentSession).toEqual({
      id: "today-1",
      isActive: true,
      endedAt: null,
      reads: 5,
      writes: 2,
      tokens: 2000,
      saved: 300,
      indexHits: 4,
      indexMisses: 1,
    });

    expect(model.history).toHaveLength(1);
    expect(model.history[0]!.id).toBe("today-1");
  });
});

// ── Sessions spanning >7 days ────────────────────────────────────────────

describe("deriveOverviewModel — sessions spanning more than 7 days", () => {
  test("excludes older sessions from last7Days but keeps them in history", () => {
    const old10 = makeSession({ sessionId: "old-10", startTimestamp: isoDaysAgo(10), totals: { readCount: 1, writeCount: 0, estimatedTokens: 500, repeatedReads: 0, fileIndexHits: 0, fileIndexMisses: 0 }, estimatedSavings: 50 });
    const old8 = makeSession({ sessionId: "old-8", startTimestamp: isoDaysAgo(8), totals: { readCount: 1, writeCount: 0, estimatedTokens: 700, repeatedReads: 0, fileIndexHits: 0, fileIndexMisses: 0 }, estimatedSavings: 70 });
    const recent3 = makeSession({ sessionId: "recent-3", startTimestamp: isoDaysAgo(3), totals: { readCount: 1, writeCount: 0, estimatedTokens: 900, repeatedReads: 0, fileIndexHits: 0, fileIndexMisses: 0 }, estimatedSavings: 90 });
    const today = makeSession({ sessionId: "today", startTimestamp: isoDaysAgo(0), totals: { readCount: 1, writeCount: 0, estimatedTokens: 100, repeatedReads: 0, fileIndexHits: 0, fileIndexMisses: 0 }, estimatedSavings: 10 });

    const model = deriveOverviewModel(
      makeOverview(),
      makeLedgerPayload({ sessions: [old10, old8, recent3, today] }),
      makeCompressionPayload(),
    );

    // history keeps everything (newest first).
    expect(model.history.map((h) => h.id)).toEqual(["today", "recent-3", "old-8", "old-10"]);

    // last7Days only reflects the in-window sessions (recent-3 and today).
    const totalTokensInWindow = model.last7Days.reduce((acc, d) => acc + d.tokensIn, 0);
    const totalSavedInWindow = model.last7Days.reduce((acc, d) => acc + d.saved, 0);
    expect(totalTokensInWindow).toBe(900 + 100);
    expect(totalSavedInWindow).toBe(90 + 10);
  });
});

// ── Measured-savings fallback chain ─────────────────────────────────────

describe("deriveOverviewModel — measured savings fallback", () => {
  test("prefers compression.lifetime.totalMeasuredSavings when present (including 0)", () => {
    const model = deriveOverviewModel(
      makeOverview({
        compression: {
          totalEvents: 1,
          totalHoldoutEvents: 0,
          totalOriginalTokens: 1000,
          totalCompressedTokens: 400,
          totalMeasuredSavings: 999,
        },
      }),
      makeLedgerPayload(),
      makeCompressionPayload({
        lifetime: {
          totalEvents: 1,
          totalHoldoutEvents: 0,
          totalOriginalTokens: 1000,
          totalCompressedTokens: 400,
          totalMeasuredSavings: 500,
        },
      }),
    );
    expect(model.savings.measured).toBe(500);
  });

  test("falls back to overview.compression.totalMeasuredSavings when compression.lifetime's value is missing", () => {
    const compression = makeCompressionPayload();
    // Simulate a partially-populated payload (defensive runtime fallback,
    // mirroring overview-panel.tsx's optional chaining on `compression?.lifetime`).
    (compression.lifetime as { totalMeasuredSavings?: number }).totalMeasuredSavings = undefined;

    const model = deriveOverviewModel(
      makeOverview({
        compression: {
          totalEvents: 1,
          totalHoldoutEvents: 0,
          totalOriginalTokens: 1000,
          totalCompressedTokens: 400,
          totalMeasuredSavings: 999,
        },
      }),
      makeLedgerPayload(),
      compression,
    );
    expect(model.savings.measured).toBe(999);
  });

  test("defaults to 0 when both sources are missing", () => {
    const compression = makeCompressionPayload();
    (compression.lifetime as { totalMeasuredSavings?: number }).totalMeasuredSavings = undefined;

    const model = deriveOverviewModel(makeOverview(), makeLedgerPayload(), compression);
    expect(model.savings.measured).toBe(0);
    expect(model.savings.total).toBe(0);
  });
});

// ── Ratio with zero denominator ─────────────────────────────────────────

describe("deriveOverviewModel — compression ratio", () => {
  test("is 0, not NaN, when originalTokens is 0", () => {
    const model = deriveOverviewModel(makeOverview(), makeLedgerPayload(), makeCompressionPayload());
    expect(model.lifetime.compRatioPct).toBe(0);
    expect(model.compression.ratioPct).toBe(0);
    expect(Number.isNaN(model.lifetime.compRatioPct)).toBe(false);
  });

  test("computes a real percentage when originalTokens > 0", () => {
    const model = deriveOverviewModel(
      makeOverview(),
      makeLedgerPayload(),
      makeCompressionPayload({
        lifetime: {
          totalEvents: 3,
          totalHoldoutEvents: 1,
          totalOriginalTokens: 1000,
          totalCompressedTokens: 250,
          totalMeasuredSavings: 750,
        },
        arms: {
          compressed: { events: 2, originalTokens: 1000, compressedTokens: 250 },
          holdout: { events: 1, originalTokens: 300 },
        },
      }),
    );
    expect(model.lifetime.compRatioPct).toBe(75);
    expect(model.compression.ratioPct).toBe(75);
    expect(model.compression.hasData).toBe(true);
  });
});

// ── History cap + order ──────────────────────────────────────────────────

describe("deriveOverviewModel — session history", () => {
  test("caps at 30 entries, newest first", () => {
    const sessions: LedgerSession[] = [];
    for (let i = 0; i < 35; i++) {
      sessions.push(makeSession({ sessionId: `s-${i}`, startTimestamp: isoDaysAgo(35 - i) }));
    }
    const model = deriveOverviewModel(makeOverview(), makeLedgerPayload({ sessions }), makeCompressionPayload());

    expect(model.history).toHaveLength(30);
    expect(model.history[0]!.id).toBe("s-34"); // newest (last pushed) first
    expect(model.history[29]!.id).toBe("s-5"); // 30th newest
  });
});

// ── Active vs ended session detection ───────────────────────────────────

describe("deriveOverviewModel — active vs ended session", () => {
  test("a session with no endTimestamp is active", () => {
    const session = makeSession({ sessionId: "live", endTimestamp: "" });
    const model = deriveOverviewModel(makeOverview(), makeLedgerPayload({ sessions: [session] }), makeCompressionPayload());
    expect(model.currentSession?.isActive).toBe(true);
    expect(model.currentSession?.endedAt).toBeNull();
  });

  test("a session with an endTimestamp is not active", () => {
    const session = makeSession({ sessionId: "done", endTimestamp: isoDaysAgo(0) });
    const model = deriveOverviewModel(makeOverview(), makeLedgerPayload({ sessions: [session] }), makeCompressionPayload());
    expect(model.currentSession?.isActive).toBe(false);
    expect(model.currentSession?.endedAt).toBe(session.endTimestamp);
  });

  test("duration for an active session is measured against now", () => {
    const start = new Date(Date.now() - 90_000).toISOString();
    const session = makeSession({ sessionId: "live", startTimestamp: start, endTimestamp: "" });
    const model = deriveOverviewModel(makeOverview(), makeLedgerPayload({ sessions: [session] }), makeCompressionPayload());
    expect(model.history[0]!.durationMs).toBeGreaterThanOrEqual(90_000 - 1000);
    expect(model.history[0]!.durationMs).toBeLessThan(90_000 + 5000);
  });
});

// ── fmtNum ────────────────────────────────────────────────────────────────

describe("fmtNum", () => {
  test("small integers render as-is", () => {
    expect(fmtNum(0)).toBe("0");
    expect(fmtNum(987)).toBe("987");
  });

  test("thousands render with one decimal and lowercase k", () => {
    expect(fmtNum(1000)).toBe("1.0k");
    expect(fmtNum(45600)).toBe("45.6k");
  });

  test("millions render with two decimals and uppercase M", () => {
    expect(fmtNum(1234567)).toBe("1.23M");
    expect(fmtNum(1_000_000)).toBe("1.00M");
  });

  test("handles negative numbers", () => {
    expect(fmtNum(-500)).toBe("-500");
    expect(fmtNum(-2500)).toBe("-2.5k");
  });

  test("non-finite input is safe", () => {
    expect(fmtNum(NaN)).toBe("0");
    expect(fmtNum(Infinity)).toBe("0");
  });
});

// ── fmtDuration ──────────────────────────────────────────────────────────

describe("fmtDuration", () => {
  test("zero and negative render as 0s", () => {
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(-100)).toBe("0s");
  });

  test("seconds only", () => {
    expect(fmtDuration(45_000)).toBe("45s");
  });

  test("minutes and seconds", () => {
    expect(fmtDuration(90_000)).toBe("1m 30s");
  });

  test("hours and minutes", () => {
    expect(fmtDuration(2 * 3_600_000 + 14 * 60_000)).toBe("2h 14m");
  });
});

// ── fmtTime / fmtDay ─────────────────────────────────────────────────────

describe("fmtTime", () => {
  test("empty or invalid input renders as em dash", () => {
    expect(fmtTime("")).toBe("—");
    expect(fmtTime("not-a-date")).toBe("—");
  });

  test("formats a valid ISO timestamp", () => {
    const out = fmtTime("2026-01-01T13:05:00.000Z", { timezone: "utc", clock: "24h" });
    expect(out).toContain("13:05");
  });
});

describe("fmtDay", () => {
  test("formats weekday + numeric month/day", () => {
    // 2026-07-08 is a Wednesday.
    const d = new Date(2026, 6, 8);
    expect(fmtDay(d)).toBe("Wed 7/8");
  });
});

// Type-only assertion: ensures the exported OverviewModel shape stays in
// sync with what tests construct above (compile-time check, not a runtime
// test).
const _typeCheck: OverviewModel | undefined = undefined;
void _typeCheck;
