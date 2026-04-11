import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { createSessionState, recordRead, recordWrite } from "../../src/core/session";
import { sessionStart } from "../../src/commands/session-start";
import { sessionStop } from "../../src/commands/session-stop";
import {
  createActionLogWriter,
  appendToLog,
  safeReadLog,
  consolidateLog,
  formatSessionHeader,
  formatReadRow,
  formatWriteRow,
} from "../../src/core/action-log";
import type { SessionState, SessionSummary } from "../../src/types/session";

describe("action log integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-action-log-int-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("full session lifecycle produces correct log entries in order", () => {
    const logPath = join(dir, "action-log.md");
    const writer = createActionLogWriter(logPath);

    const timestamp = "2024-01-15T14:30:00.000Z";

    // Session start
    writer.appendSessionHeader(timestamp);

    // Reads
    writer.appendReadEntry("2024-01-15T14:32:00.000Z", "src/app.ts", true, 150);
    writer.appendReadEntry("2024-01-15T14:33:00.000Z", "src/config.ts", false, 200);
    writer.appendReadEntry("2024-01-15T14:34:00.000Z", "src/utils.ts", true, 100);

    // Writes
    writer.appendWriteEntry("2024-01-15T14:35:00.000Z", "src/app.ts", "edit", "Fix handler", 300);
    writer.appendWriteEntry("2024-01-15T14:36:00.000Z", "src/new.ts", "create", "New module", 250);

    // Session end
    const summary: SessionSummary = {
      sessionId: "test-session-1",
      startTimestamp: timestamp,
      endTimestamp: "2024-01-15T15:00:00.000Z",
      reads: [
        { filePath: "src/app.ts", estimatedTokens: 150, readCount: 1, firstReadAt: "2024-01-15T14:32:00.000Z" },
        { filePath: "src/config.ts", estimatedTokens: 200, readCount: 1, firstReadAt: "2024-01-15T14:33:00.000Z" },
        { filePath: "src/utils.ts", estimatedTokens: 100, readCount: 1, firstReadAt: "2024-01-15T14:34:00.000Z" },
      ],
      writes: [
        { filePath: "src/app.ts", action: "edit", estimatedTokens: 300, timestamp: "2024-01-15T14:35:00.000Z" },
        { filePath: "src/new.ts", action: "create", estimatedTokens: 250, timestamp: "2024-01-15T14:36:00.000Z" },
      ],
      totals: {
        readCount: 3,
        writeCount: 2,
        estimatedTokens: 1000,
        repeatedReads: 0,
        fileIndexHits: 2,
        fileIndexMisses: 1,
      },
      estimatedSavings: 400,
    };
    writer.appendSessionEnd(summary);

    const content = readFileSync(logPath, "utf-8");

    // Check structure
    expect(content).toContain("### Session \u2014 2024-01-15 14:30");
    expect(content).toContain("| Time | Action | File(s) | Outcome | ~Tokens |");

    // Check row order by extracting data rows
    const dataRows = content
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| Time") && !l.startsWith("| ---"));

    expect(dataRows.length).toBe(7); // start + 3 reads + 2 writes + end
    expect(dataRows[0]).toContain("Session start");
    expect(dataRows[1]).toContain("Read");
    expect(dataRows[1]).toContain("src/app.ts");
    expect(dataRows[2]).toContain("Read");
    expect(dataRows[2]).toContain("src/config.ts");
    expect(dataRows[3]).toContain("Read");
    expect(dataRows[3]).toContain("src/utils.ts");
    expect(dataRows[4]).toContain("Edit");
    expect(dataRows[4]).toContain("src/app.ts");
    expect(dataRows[5]).toContain("Create");
    expect(dataRows[5]).toContain("src/new.ts");
    expect(dataRows[6]).toContain("Session end");
  });

  test("multiple sessions append correctly", () => {
    const logPath = join(dir, "action-log.md");
    const writer = createActionLogWriter(logPath);

    // Session 1
    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");
    writer.appendReadEntry("2024-01-15T14:32:00.000Z", "src/app.ts", true, 150);
    writer.appendSessionEnd({
      sessionId: "s1",
      startTimestamp: "2024-01-15T14:30:00.000Z",
      endTimestamp: "2024-01-15T15:00:00.000Z",
      reads: [{ filePath: "src/app.ts", estimatedTokens: 150, readCount: 1, firstReadAt: "2024-01-15T14:32:00.000Z" }],
      writes: [],
      totals: { readCount: 1, writeCount: 0, estimatedTokens: 150, repeatedReads: 0, fileIndexHits: 1, fileIndexMisses: 0 },
      estimatedSavings: 0,
    });

    // Session 2
    writer.appendSessionHeader("2024-01-16T10:00:00.000Z");
    writer.appendWriteEntry("2024-01-16T10:05:00.000Z", "src/new.ts", "create", "New file", 300);
    writer.appendSessionEnd({
      sessionId: "s2",
      startTimestamp: "2024-01-16T10:00:00.000Z",
      endTimestamp: "2024-01-16T10:30:00.000Z",
      reads: [],
      writes: [{ filePath: "src/new.ts", action: "create", estimatedTokens: 300, timestamp: "2024-01-16T10:05:00.000Z" }],
      totals: { readCount: 0, writeCount: 1, estimatedTokens: 300, repeatedReads: 0, fileIndexHits: 0, fileIndexMisses: 0 },
      estimatedSavings: 0,
    });

    const content = readFileSync(logPath, "utf-8");

    // Two session headers
    const headers = content.match(/### Session/g);
    expect(headers?.length).toBe(2);

    // Session 2 appears after session 1
    const idx1 = content.indexOf("2024-01-15 14:30");
    const idx2 = content.indexOf("2024-01-16 10:00");
    expect(idx2).toBeGreaterThan(idx1);
  });

  test("consolidation reduces a large log while preserving recent sessions", () => {
    const logPath = join(dir, "action-log.md");

    // Generate old sessions (>7 days ago from our reference date)
    for (let day = 1; day <= 8; day++) {
      const date = `2024-01-${String(day).padStart(2, "0")}`;
      const ts = `${date}T09:00:00.000Z`;
      let block = formatSessionHeader(ts);
      // Add many rows per session to exceed threshold
      for (let i = 0; i < 30; i++) {
        block += formatReadRow(`${date}T09:${String(i + 1).padStart(2, "0")}:00.000Z`, `src/file${i}.ts`, true, 100);
      }
      appendToLog(logPath, block);
    }

    // Generate recent sessions (within retention)
    for (let day = 18; day <= 20; day++) {
      const date = `2024-01-${String(day).padStart(2, "0")}`;
      const ts = `${date}T10:00:00.000Z`;
      let block = formatSessionHeader(ts);
      block += formatReadRow(`${date}T10:05:00.000Z`, "src/recent.ts", true, 200);
      appendToLog(logPath, block);
    }

    const beforeContent = safeReadLog(logPath);
    const beforeSessions = beforeContent.match(/### Session/g);
    expect(beforeSessions?.length).toBe(11); // 8 old + 3 recent

    // Run consolidation with reference date of 2024-01-20
    consolidateLog(
      logPath,
      { maxEntries: 50, retentionDays: 7 },
      new Date("2024-01-20T12:00:00.000Z")
    );

    const afterContent = safeReadLog(logPath);

    // Old sessions compressed to blockquote lines
    const consolidatedLines = afterContent.match(/^> \*\*/gm);
    expect(consolidatedLines?.length).toBeGreaterThan(0);

    // Recent sessions preserved in full
    expect(afterContent).toContain("### Session \u2014 2024-01-18 10:00");
    expect(afterContent).toContain("### Session \u2014 2024-01-19 10:00");
    expect(afterContent).toContain("### Session \u2014 2024-01-20 10:00");
    expect(afterContent).toContain("src/recent.ts");
  });

  test("concurrent appends from rapidly firing hooks produce valid output", () => {
    const logPath = join(dir, "action-log.md");
    const writer = createActionLogWriter(logPath);
    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");

    // Simulate rapid-fire appends
    for (let i = 0; i < 20; i++) {
      writer.appendReadEntry(
        `2024-01-15T14:3${Math.floor(i / 10)}:${String(i % 60).padStart(2, "0")}.000Z`,
        `src/file${i}.ts`,
        i % 2 === 0,
        100 + i * 10
      );
    }

    const content = readFileSync(logPath, "utf-8");
    const dataRows = content
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| Time") && !l.startsWith("| ---"));

    // 1 start row + 20 read rows = 21
    expect(dataRows.length).toBe(21);

    // Each row should be a complete table row (starts and ends with |)
    for (const row of dataRows) {
      expect(row.startsWith("|")).toBe(true);
      expect(row.endsWith("|")).toBe(true);
    }
  });

  test("missing log file is created on first append", () => {
    const logPath = join(dir, "new-subdir", "action-log.md");
    const writer = createActionLogWriter(logPath);
    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("### Session");
  });

  test("session with zero activity produces only header and summary", () => {
    const logPath = join(dir, "action-log.md");
    const writer = createActionLogWriter(logPath);

    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");
    writer.appendSessionEnd({
      sessionId: "empty-session",
      startTimestamp: "2024-01-15T14:30:00.000Z",
      endTimestamp: "2024-01-15T14:30:05.000Z",
      reads: [],
      writes: [],
      totals: { readCount: 0, writeCount: 0, estimatedTokens: 0, repeatedReads: 0, fileIndexHits: 0, fileIndexMisses: 0 },
      estimatedSavings: 0,
    });

    const content = readFileSync(logPath, "utf-8");
    const dataRows = content
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| Time") && !l.startsWith("| ---"));

    // Only session start + session end
    expect(dataRows.length).toBe(2);
    expect(dataRows[0]).toContain("Session start");
    expect(dataRows[1]).toContain("Session end");
  });

  test("log entries are strictly chronological", () => {
    const logPath = join(dir, "action-log.md");
    const writer = createActionLogWriter(logPath);

    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");
    writer.appendReadEntry("2024-01-15T14:31:00.000Z", "a.ts", true, 100);
    writer.appendReadEntry("2024-01-15T14:32:00.000Z", "b.ts", false, 200);
    writer.appendWriteEntry("2024-01-15T14:33:00.000Z", "c.ts", "edit", "fix", 300);
    writer.appendWriteEntry("2024-01-15T14:34:00.000Z", "d.ts", "create", "new", 400);

    const content = readFileSync(logPath, "utf-8");
    const dataRows = content
      .split("\n")
      .filter((l) => l.startsWith("| ") && !l.startsWith("| Time") && !l.startsWith("| ---"));

    // Extract times from rows
    const times = dataRows.map((row) => {
      const cells = row.split("|").map((c) => c.trim());
      return cells[1]; // time column
    });

    // Verify chronological order
    for (let i = 1; i < times.length; i++) {
      expect(times[i] >= times[i - 1]).toBe(true);
    }
  });
});
