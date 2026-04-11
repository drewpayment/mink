import { describe, test, expect } from "bun:test";
import {
  defaultDetectionConfig,
  detectRepeatedReads,
  detectMissedIndexOpportunities,
  detectActionLogBloat,
  detectLearningMemoryStaleness,
  detectIndexMissRate,
  runDetection,
} from "../../src/core/waste-detection";
import { createEmptyLedger } from "../../src/core/token-ledger";
import type { LedgerSession, TokenLedger } from "../../src/types/token-ledger";
import type { FileIndexEntry, FileIndexHeader } from "../../src/types/file-index";
import type { DetectionConfig } from "../../src/types/waste-detection";

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = "2024-06-01T12:00:00.000Z";

function makeSession(overrides: Partial<LedgerSession> = {}): LedgerSession {
  return {
    sessionId: "2024-01-01T00:00:00.000Z-abcd",
    startTimestamp: "2024-01-01T00:00:00.000Z",
    endTimestamp: "2024-01-01T01:00:00.000Z",
    reads: [
      { filePath: "src/a.ts", estimatedTokens: 100, readCount: 1 },
    ],
    writes: [
      { filePath: "src/b.ts", estimatedTokens: 200, action: "edit" },
    ],
    totals: {
      readCount: 1,
      writeCount: 1,
      estimatedTokens: 300,
      repeatedReads: 0,
      fileIndexHits: 1,
      fileIndexMisses: 0,
    },
    estimatedSavings: 200,
    ...overrides,
  };
}

function makeLedger(sessions: LedgerSession[]): TokenLedger {
  const ledger = createEmptyLedger();
  ledger.sessions = sessions;
  return ledger;
}

function makeIndexEntry(
  filePath: string,
  description: string,
  estimatedTokens: number
): FileIndexEntry {
  return {
    filePath,
    description,
    estimatedTokens,
    lastModified: "2024-01-01T00:00:00.000Z",
    lastIndexed: "2024-01-01T00:00:00.000Z",
  };
}

function makeConfig(overrides: Partial<DetectionConfig> = {}): DetectionConfig {
  return { ...defaultDetectionConfig(), ...overrides };
}

// ── defaultDetectionConfig ──────────────────────────────────────────────────

describe("defaultDetectionConfig", () => {
  test("returns correct defaults", () => {
    const config = defaultDetectionConfig();
    expect(config.actionLogBloatThreshold).toBe(5000);
    expect(config.learningMemoryStaleDays).toBe(14);
    expect(config.indexMissRateThreshold).toBe(0.20);
    expect(config.missedIndexMinTokens).toBe(500);
  });
});

// ── detectRepeatedReads ─────────────────────────────────────────────────────

describe("detectRepeatedReads", () => {
  test("flags file read 3 times with correct waste estimate", () => {
    const session = makeSession({
      reads: [
        { filePath: "src/large-module.ts", estimatedTokens: 800, readCount: 3 },
      ],
    });
    const flags = detectRepeatedReads([session], NOW);
    expect(flags).toHaveLength(1);
    expect(flags[0].pattern).toBe("repeated-reads");
    expect(flags[0].estimatedTokensWasted).toBe(1600); // (3-1) * 800
    expect(flags[0].description).toContain("src/large-module.ts");
    expect(flags[0].description).toContain("3 times");
  });

  test("does not flag file read exactly once", () => {
    const session = makeSession({
      reads: [{ filePath: "src/a.ts", estimatedTokens: 100, readCount: 1 }],
    });
    const flags = detectRepeatedReads([session], NOW);
    expect(flags).toHaveLength(0);
  });

  test("flags file read 2 times (minimum repeat)", () => {
    const session = makeSession({
      reads: [{ filePath: "src/a.ts", estimatedTokens: 500, readCount: 2 }],
    });
    const flags = detectRepeatedReads([session], NOW);
    expect(flags).toHaveLength(1);
    expect(flags[0].estimatedTokensWasted).toBe(500); // (2-1) * 500
  });

  test("produces separate flags for repeated reads in different sessions", () => {
    const s1 = makeSession({
      sessionId: "s1",
      reads: [{ filePath: "src/a.ts", estimatedTokens: 100, readCount: 2 }],
    });
    const s2 = makeSession({
      sessionId: "s2",
      reads: [{ filePath: "src/a.ts", estimatedTokens: 100, readCount: 3 }],
    });
    const flags = detectRepeatedReads([s1, s2], NOW);
    expect(flags).toHaveLength(2);
    expect(flags[0].description).toContain("s1");
    expect(flags[1].description).toContain("s2");
  });

  test("flags every file individually when all reads are repeated", () => {
    const session = makeSession({
      reads: [
        { filePath: "src/a.ts", estimatedTokens: 100, readCount: 2 },
        { filePath: "src/b.ts", estimatedTokens: 200, readCount: 3 },
        { filePath: "src/c.ts", estimatedTokens: 300, readCount: 4 },
      ],
    });
    const flags = detectRepeatedReads([session], NOW);
    expect(flags).toHaveLength(3);
  });

  test("returns empty flags for empty sessions array", () => {
    const flags = detectRepeatedReads([], NOW);
    expect(flags).toHaveLength(0);
  });

  test("flag has all required fields", () => {
    const session = makeSession({
      reads: [{ filePath: "src/a.ts", estimatedTokens: 100, readCount: 2 }],
    });
    const flags = detectRepeatedReads([session], NOW);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toHaveProperty("pattern");
    expect(flags[0]).toHaveProperty("description");
    expect(flags[0]).toHaveProperty("estimatedTokensWasted");
    expect(flags[0]).toHaveProperty("suggestion");
    expect(flags[0]).toHaveProperty("detectedAt");
    expect(flags[0].detectedAt).toBe(NOW);
  });
});

// ── detectMissedIndexOpportunities ──────────────────────────────────────────

describe("detectMissedIndexOpportunities", () => {
  const config = makeConfig();

  test("flags large file read when index has description", () => {
    const session = makeSession({
      reads: [{ filePath: "src/big.ts", estimatedTokens: 800, readCount: 1 }],
    });
    const entries: Record<string, FileIndexEntry> = {
      "src/big.ts": makeIndexEntry("src/big.ts", "Big module for processing", 800),
    };
    const flags = detectMissedIndexOpportunities([session], entries, config, NOW);
    expect(flags).toHaveLength(1);
    expect(flags[0].pattern).toBe("missed-index-opportunity");
    expect(flags[0].estimatedTokensWasted).toBe(800);
    expect(flags[0].suggestion).toContain("Big module for processing");
  });

  test("does not flag file with 499 tokens (below threshold)", () => {
    const session = makeSession({
      reads: [{ filePath: "src/small.ts", estimatedTokens: 499, readCount: 1 }],
    });
    const entries: Record<string, FileIndexEntry> = {
      "src/small.ts": makeIndexEntry("src/small.ts", "Small util", 499),
    };
    const flags = detectMissedIndexOpportunities([session], entries, config, NOW);
    expect(flags).toHaveLength(0);
  });

  test("does not flag file with exactly 500 tokens (at threshold)", () => {
    const session = makeSession({
      reads: [{ filePath: "src/mid.ts", estimatedTokens: 500, readCount: 1 }],
    });
    const entries: Record<string, FileIndexEntry> = {
      "src/mid.ts": makeIndexEntry("src/mid.ts", "Mid module", 500),
    };
    const flags = detectMissedIndexOpportunities([session], entries, config, NOW);
    expect(flags).toHaveLength(0);
  });

  test("flags file with 501 tokens (above threshold)", () => {
    const session = makeSession({
      reads: [{ filePath: "src/mid.ts", estimatedTokens: 501, readCount: 1 }],
    });
    const entries: Record<string, FileIndexEntry> = {
      "src/mid.ts": makeIndexEntry("src/mid.ts", "Mid module", 501),
    };
    const flags = detectMissedIndexOpportunities([session], entries, config, NOW);
    expect(flags).toHaveLength(1);
  });

  test("does not flag when no index entry exists", () => {
    const session = makeSession({
      reads: [{ filePath: "src/new.ts", estimatedTokens: 800, readCount: 1 }],
    });
    const flags = detectMissedIndexOpportunities([session], {}, config, NOW);
    expect(flags).toHaveLength(0);
  });

  test("does not flag when index entry has empty description", () => {
    const session = makeSession({
      reads: [{ filePath: "src/big.ts", estimatedTokens: 800, readCount: 1 }],
    });
    const entries: Record<string, FileIndexEntry> = {
      "src/big.ts": makeIndexEntry("src/big.ts", "", 800),
    };
    const flags = detectMissedIndexOpportunities([session], entries, config, NOW);
    expect(flags).toHaveLength(0);
  });

  test("deduplicates by filePath across sessions", () => {
    const s1 = makeSession({
      sessionId: "s1",
      reads: [{ filePath: "src/big.ts", estimatedTokens: 800, readCount: 1 }],
    });
    const s2 = makeSession({
      sessionId: "s2",
      reads: [{ filePath: "src/big.ts", estimatedTokens: 800, readCount: 1 }],
    });
    const entries: Record<string, FileIndexEntry> = {
      "src/big.ts": makeIndexEntry("src/big.ts", "Big module", 800),
    };
    const flags = detectMissedIndexOpportunities([s1, s2], entries, config, NOW);
    expect(flags).toHaveLength(1);
    expect(flags[0].estimatedTokensWasted).toBe(1600); // aggregated
  });

  test("respects custom config threshold", () => {
    const session = makeSession({
      reads: [{ filePath: "src/a.ts", estimatedTokens: 300, readCount: 1 }],
    });
    const entries: Record<string, FileIndexEntry> = {
      "src/a.ts": makeIndexEntry("src/a.ts", "Module A", 300),
    };
    const customConfig = makeConfig({ missedIndexMinTokens: 200 });
    const flags = detectMissedIndexOpportunities([session], entries, customConfig, NOW);
    expect(flags).toHaveLength(1);
  });
});

// ── detectActionLogBloat ────────────────────────────────────────────────────

describe("detectActionLogBloat", () => {
  const config = makeConfig();

  // prose ratio is 4.0 chars/token, so 5000 tokens = 20000 chars
  test("flags action log exceeding threshold", () => {
    // 6000 tokens at 4.0 chars/token = 24000 chars
    const content = "x".repeat(24000);
    const flag = detectActionLogBloat(content, config, NOW);
    expect(flag).not.toBeNull();
    expect(flag!.pattern).toBe("action-log-bloat");
    expect(flag!.estimatedTokensWasted).toBe(6000 - 5000);
  });

  test("does not flag at exactly threshold", () => {
    // 5000 tokens at 4.0 chars/token = 20000 chars
    const content = "x".repeat(20000);
    const flag = detectActionLogBloat(content, config, NOW);
    expect(flag).toBeNull();
  });

  test("flags one above threshold", () => {
    // 5001 tokens => 20004 chars (ceil(20004/4) = 5001)
    const content = "x".repeat(20001);
    const flag = detectActionLogBloat(content, config, NOW);
    expect(flag).not.toBeNull();
  });

  test("does not flag below threshold", () => {
    // 4999 tokens at 4.0 chars/token = 19996 chars
    const content = "x".repeat(19996);
    const flag = detectActionLogBloat(content, config, NOW);
    expect(flag).toBeNull();
  });

  test("returns null for empty action log", () => {
    const flag = detectActionLogBloat("", config, NOW);
    expect(flag).toBeNull();
  });

  test("reports correct excess in estimatedTokensWasted", () => {
    const content = "x".repeat(28000); // 7000 tokens
    const flag = detectActionLogBloat(content, config, NOW);
    expect(flag).not.toBeNull();
    expect(flag!.estimatedTokensWasted).toBe(7000 - 5000);
  });
});

// ── detectLearningMemoryStaleness ───────────────────────────────────────────

describe("detectLearningMemoryStaleness", () => {
  const config = makeConfig();
  const nowMs = Date.parse(NOW);
  const ONE_DAY_MS = 1000 * 60 * 60 * 24;

  test("flags when last modified 20 days ago", () => {
    const mtimeMs = nowMs - 20 * ONE_DAY_MS;
    const flag = detectLearningMemoryStaleness(mtimeMs, config, NOW);
    expect(flag).not.toBeNull();
    expect(flag!.pattern).toBe("learning-memory-staleness");
    expect(flag!.description).toContain("20 days");
  });

  test("does not flag at exactly 14 days (threshold)", () => {
    const mtimeMs = nowMs - 14 * ONE_DAY_MS;
    const flag = detectLearningMemoryStaleness(mtimeMs, config, NOW);
    expect(flag).toBeNull();
  });

  test("flags at 15 days (above threshold)", () => {
    const mtimeMs = nowMs - 15 * ONE_DAY_MS;
    const flag = detectLearningMemoryStaleness(mtimeMs, config, NOW);
    expect(flag).not.toBeNull();
  });

  test("does not flag at 13 days (below threshold)", () => {
    const mtimeMs = nowMs - 13 * ONE_DAY_MS;
    const flag = detectLearningMemoryStaleness(mtimeMs, config, NOW);
    expect(flag).toBeNull();
  });

  test("flags missing file (null mtime) as stale", () => {
    const flag = detectLearningMemoryStaleness(null, config, NOW);
    expect(flag).not.toBeNull();
    expect(flag!.pattern).toBe("learning-memory-staleness");
    expect(flag!.description).toContain("missing");
  });

  test("does not flag recently modified (now)", () => {
    const flag = detectLearningMemoryStaleness(nowMs, config, NOW);
    expect(flag).toBeNull();
  });

  test("respects custom threshold", () => {
    const customConfig = makeConfig({ learningMemoryStaleDays: 7 });
    const mtimeMs = nowMs - 10 * ONE_DAY_MS;
    const flag = detectLearningMemoryStaleness(mtimeMs, customConfig, NOW);
    expect(flag).not.toBeNull();
  });
});

// ── detectIndexMissRate ─────────────────────────────────────────────────────

describe("detectIndexMissRate", () => {
  const config = makeConfig();

  test("flags 25% miss rate (above 20% threshold)", () => {
    const flag = detectIndexMissRate(75, 25, config, NOW);
    expect(flag).not.toBeNull();
    expect(flag!.pattern).toBe("index-miss-rate");
    expect(flag!.description).toContain("25%");
    expect(flag!.description).toContain("25 misses");
    expect(flag!.description).toContain("100 lookups");
  });

  test("does not flag exactly 20% (at threshold)", () => {
    const flag = detectIndexMissRate(80, 20, config, NOW);
    expect(flag).toBeNull();
  });

  test("flags 21% (above threshold)", () => {
    const flag = detectIndexMissRate(79, 21, config, NOW);
    expect(flag).not.toBeNull();
  });

  test("does not flag 19% (below threshold)", () => {
    const flag = detectIndexMissRate(81, 19, config, NOW);
    expect(flag).toBeNull();
  });

  test("returns null for zero lookups", () => {
    const flag = detectIndexMissRate(0, 0, config, NOW);
    expect(flag).toBeNull();
  });

  test("flags 100% miss rate", () => {
    const flag = detectIndexMissRate(0, 10, config, NOW);
    expect(flag).not.toBeNull();
    expect(flag!.description).toContain("100%");
  });

  test("does not flag 0% miss rate", () => {
    const flag = detectIndexMissRate(10, 0, config, NOW);
    expect(flag).toBeNull();
  });

  test("respects custom threshold", () => {
    const customConfig = makeConfig({ indexMissRateThreshold: 0.10 });
    const flag = detectIndexMissRate(85, 15, customConfig, NOW);
    expect(flag).not.toBeNull();
  });
});

// ── runDetection (orchestrator) ─────────────────────────────────────────────

describe("runDetection", () => {
  const emptyHeader: FileIndexHeader = {
    lastScanTimestamp: "",
    totalFiles: 0,
    lifetimeHits: 0,
    lifetimeMisses: 0,
  };
  const nowDate = new Date(NOW);

  test("produces no flags when all patterns are within healthy thresholds", () => {
    const ledger = makeLedger([
      makeSession({
        reads: [{ filePath: "src/a.ts", estimatedTokens: 100, readCount: 1 }],
      }),
    ]);
    const header: FileIndexHeader = {
      lastScanTimestamp: NOW,
      totalFiles: 10,
      lifetimeHits: 90,
      lifetimeMisses: 10,
    };
    const recentMtime = Date.parse(NOW) - 1000 * 60 * 60 * 24 * 5; // 5 days ago

    const flags = runDetection(
      ledger,
      {},
      header,
      "short log",
      recentMtime,
      undefined,
      nowDate
    );
    expect(flags).toHaveLength(0);
  });

  test("produces flags from all detectors when all patterns triggered", () => {
    const session = makeSession({
      reads: [
        { filePath: "src/big.ts", estimatedTokens: 800, readCount: 3 },
      ],
    });
    const ledger = makeLedger([session]);
    const entries: Record<string, FileIndexEntry> = {
      "src/big.ts": makeIndexEntry("src/big.ts", "Big module", 800),
    };
    const header: FileIndexHeader = {
      lastScanTimestamp: NOW,
      totalFiles: 10,
      lifetimeHits: 50,
      lifetimeMisses: 50,
    };
    // action log bloat: 6000 tokens = 24000 chars (prose ratio 4.0)
    const bigLog = "x".repeat(24000);
    const staleMtime = Date.parse(NOW) - 1000 * 60 * 60 * 24 * 20; // 20 days ago

    const flags = runDetection(
      ledger,
      entries,
      header,
      bigLog,
      staleMtime,
      undefined,
      nowDate
    );

    const patterns = flags.map((f) => f.pattern);
    expect(patterns).toContain("repeated-reads");
    expect(patterns).toContain("missed-index-opportunity");
    expect(patterns).toContain("action-log-bloat");
    expect(patterns).toContain("learning-memory-staleness");
    expect(patterns).toContain("index-miss-rate");
  });

  test("applies default config when none provided", () => {
    const ledger = makeLedger([]);
    const flags = runDetection(ledger, {}, emptyHeader, "", null, undefined, nowDate);
    // Should produce learning-memory-staleness flag (null mtime)
    expect(flags.some((f) => f.pattern === "learning-memory-staleness")).toBe(true);
  });

  test("empty ledger produces zero flags for read-based patterns", () => {
    const ledger = makeLedger([]);
    const recentMtime = Date.parse(NOW) - 1000 * 60 * 60 * 24 * 5;
    const flags = runDetection(
      ledger,
      {},
      emptyHeader,
      "",
      recentMtime,
      undefined,
      nowDate
    );
    expect(flags).toHaveLength(0);
  });
});
