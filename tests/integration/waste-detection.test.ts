import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { createEmptyLedger, saveLedger, loadLedger } from "../../src/core/token-ledger";
import { createEmptyIndex, upsertEntry } from "../../src/core/index-store";
import { detectWaste } from "../../src/commands/detect-waste";
import type { TokenLedger, LedgerSession } from "../../src/types/token-ledger";
import type { FileIndex, FileIndexEntry } from "../../src/types/file-index";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(overrides: Partial<LedgerSession> = {}): LedgerSession {
  return {
    sessionId: "2024-01-01T00:00:00.000Z-abcd",
    startTimestamp: "2024-01-01T00:00:00.000Z",
    endTimestamp: "2024-01-01T01:00:00.000Z",
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

/**
 * Sets up a fake project directory structure that mimics what paths.ts produces.
 * Since detectWaste calls paths.ts functions (which derive projectDir from cwd),
 * we need to make the directory pretend to be a mink project dir.
 * The simplest approach: write files directly to a tmp dir and call detectWaste
 * via a workaround that places files where the path functions expect them.
 *
 * Actually, detectWaste(cwd) computes projectDir(cwd) which creates a deterministic
 * path under ~/.mink/projects/. For integration tests, we need to write files there.
 * Instead, we'll directly test the core functions + file I/O to avoid polluting ~/.mink.
 */

describe("waste detection integration", () => {
  let dir: string;
  let ledgerPath: string;
  let indexPath: string;
  let logPath: string;
  let lmPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-waste-integ-"));
    ledgerPath = join(dir, "token-ledger.json");
    indexPath = join(dir, "file-index.json");
    logPath = join(dir, "action-log.md");
    lmPath = join(dir, "learning-memory.md");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("full detection run with mixed waste patterns", async () => {
    // Set up ledger with repeated reads
    const ledger = createEmptyLedger();
    const session = makeSession({
      reads: [
        { filePath: "src/big.ts", estimatedTokens: 800, readCount: 3 },
        { filePath: "src/small.ts", estimatedTokens: 100, readCount: 1 },
      ],
      totals: {
        readCount: 2,
        writeCount: 0,
        estimatedTokens: 900,
        repeatedReads: 1,
        fileIndexHits: 50,
        fileIndexMisses: 50,
      },
    });
    ledger.sessions.push(session);
    saveLedger(ledgerPath, ledger);

    // Set up file index with high miss rate and descriptions
    const index = createEmptyIndex();
    upsertEntry(index, {
      filePath: "src/big.ts",
      description: "Big processing module",
      estimatedTokens: 800,
      lastModified: "2024-01-01T00:00:00.000Z",
      lastIndexed: "2024-01-01T00:00:00.000Z",
    });
    index.header.lifetimeHits = 50;
    index.header.lifetimeMisses = 50;
    atomicWriteJson(indexPath, index);

    // Set up bloated action log (>5000 tokens at 4.0 chars/token = >20000 chars)
    writeFileSync(logPath, "x".repeat(24000));

    // No learning memory file → will flag as stale

    // Run detection via core functions (avoiding path derivation)
    const { runDetection } = await import("../../src/core/waste-detection");
    const { safeReadLog } = await import("../../src/core/action-log");

    const rawIndex = safeReadJson(indexPath) as FileIndex;
    const actionLogContent = safeReadLog(logPath);

    const flags = runDetection(
      ledger,
      rawIndex.entries,
      rawIndex.header,
      actionLogContent,
      null // missing learning memory
    );

    // Store in ledger
    ledger.wasteFlags = flags;
    saveLedger(ledgerPath, ledger);

    // Verify
    const saved = loadLedger(ledgerPath);
    expect(saved.wasteFlags).toBeDefined();
    expect(saved.wasteFlags!.length).toBeGreaterThanOrEqual(4);

    const patterns = saved.wasteFlags!.map((f) => f.pattern);
    expect(patterns).toContain("repeated-reads");
    expect(patterns).toContain("missed-index-opportunity");
    expect(patterns).toContain("action-log-bloat");
    expect(patterns).toContain("learning-memory-staleness");
    expect(patterns).toContain("index-miss-rate");
  });

  test("empty ledger produces zero flags", async () => {
    const ledger = createEmptyLedger();
    saveLedger(ledgerPath, ledger);

    const index = createEmptyIndex();
    atomicWriteJson(indexPath, index);
    writeFileSync(logPath, "");
    writeFileSync(lmPath, "# Learning Memory\n");

    const { runDetection } = await import("../../src/core/waste-detection");

    const recentMtime = Date.now() - 1000 * 60 * 60; // 1 hour ago
    const flags = runDetection(
      ledger,
      index.entries,
      index.header,
      "",
      recentMtime
    );

    expect(flags).toHaveLength(0);
  });

  test("corrupted ledger is handled gracefully", () => {
    // Write invalid JSON
    writeFileSync(ledgerPath, "not valid json {{{");

    const raw = safeReadJson(ledgerPath);
    // safeReadJson returns null on parse error
    expect(raw).toBeNull();

    // The command would detect null and create empty ledger
    // (this matches the "file doesn't exist" path, but corrupt JSON also returns null)
    // For the true corruption case (valid JSON, wrong shape), test separately:
    atomicWriteJson(ledgerPath, { bad: "data" });

    const { isTokenLedger } = require("../../src/core/token-ledger");
    const raw2 = safeReadJson(ledgerPath);
    expect(raw2).not.toBeNull();
    expect(isTokenLedger(raw2)).toBe(false);
    // The command would log warning and skip detection
  });

  test("each detection run replaces previous flags", async () => {
    const { runDetection } = await import("../../src/core/waste-detection");

    const ledger = createEmptyLedger();
    const session = makeSession({
      reads: [
        { filePath: "src/a.ts", estimatedTokens: 500, readCount: 2 },
      ],
    });
    ledger.sessions.push(session);

    const index = createEmptyIndex();

    // First run
    const flags1 = runDetection(ledger, index.entries, index.header, "", Date.now());
    ledger.wasteFlags = flags1;
    saveLedger(ledgerPath, ledger);

    const saved1 = loadLedger(ledgerPath);
    const count1 = saved1.wasteFlags!.length;
    expect(count1).toBeGreaterThan(0);

    // Second run — clear the repeated read
    ledger.sessions = [
      makeSession({
        reads: [{ filePath: "src/a.ts", estimatedTokens: 500, readCount: 1 }],
      }),
    ];

    const flags2 = runDetection(ledger, index.entries, index.header, "", Date.now());
    ledger.wasteFlags = flags2;
    saveLedger(ledgerPath, ledger);

    const saved2 = loadLedger(ledgerPath);
    // Second run should have fewer flags (no repeated reads)
    expect(saved2.wasteFlags!.filter((f) => f.pattern === "repeated-reads")).toHaveLength(0);
  });

  test("missing learning memory file produces staleness flag", async () => {
    const { runDetection } = await import("../../src/core/waste-detection");

    const ledger = createEmptyLedger();
    const index = createEmptyIndex();

    // Don't create learning memory file
    const flags = runDetection(
      ledger,
      index.entries,
      index.header,
      "",
      null // missing
    );

    const stalenessFlags = flags.filter(
      (f) => f.pattern === "learning-memory-staleness"
    );
    expect(stalenessFlags).toHaveLength(1);
    expect(stalenessFlags[0].description).toContain("missing");
  });

  test("all healthy patterns produce no flags", async () => {
    const { runDetection } = await import("../../src/core/waste-detection");

    const ledger = createEmptyLedger();
    ledger.sessions.push(
      makeSession({
        reads: [{ filePath: "src/a.ts", estimatedTokens: 100, readCount: 1 }],
      })
    );

    const index = createEmptyIndex();
    index.header.lifetimeHits = 90;
    index.header.lifetimeMisses = 10;

    const recentMtime = Date.now() - 1000 * 60 * 60 * 24 * 5; // 5 days ago

    const flags = runDetection(
      ledger,
      index.entries,
      index.header,
      "short log content",
      recentMtime
    );

    expect(flags).toHaveLength(0);
  });
});
