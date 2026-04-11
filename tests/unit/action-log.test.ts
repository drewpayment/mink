import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  truncatePath,
  formatTime,
  formatRow,
  formatSessionHeader,
  formatReadRow,
  formatWriteRow,
  formatSessionEndRow,
  formatConsolidatedLine,
  appendToLog,
  safeReadLog,
  parseLogSessions,
  identifySessionsToConsolidate,
  consolidateLog,
  createActionLogWriter,
} from "../../src/core/action-log";
import type { SessionSummary } from "../../src/types/session";
import type { ConsolidationConfig } from "../../src/types/action-log";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "2024-01-15T14:30:00.000Z-abcd",
    startTimestamp: "2024-01-15T14:30:00.000Z",
    endTimestamp: "2024-01-15T15:00:00.000Z",
    reads: [
      {
        filePath: "src/app.ts",
        estimatedTokens: 150,
        readCount: 1,
        firstReadAt: "2024-01-15T14:32:00.000Z",
      },
    ],
    writes: [
      {
        filePath: "src/server.ts",
        action: "edit" as const,
        estimatedTokens: 300,
        timestamp: "2024-01-15T14:35:00.000Z",
      },
    ],
    totals: {
      readCount: 1,
      writeCount: 1,
      estimatedTokens: 450,
      repeatedReads: 0,
      fileIndexHits: 1,
      fileIndexMisses: 0,
    },
    estimatedSavings: 200,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `mink-action-log-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── truncatePath ────────────────────────────────────────────────────────────

describe("truncatePath", () => {
  test("returns short paths unchanged", () => {
    expect(truncatePath("src/app.ts")).toBe("src/app.ts");
  });

  test("returns paths at exactly 60 chars unchanged", () => {
    const path = "a".repeat(60);
    expect(truncatePath(path)).toBe(path);
  });

  test("truncates paths over 60 chars with ... prefix", () => {
    const path = "very/long/path/that/exceeds/sixty/characters/in/total/when/combined/together.ts";
    const result = truncatePath(path);
    expect(result.length).toBe(60);
    expect(result.startsWith("...")).toBe(true);
    expect(result.endsWith("together.ts")).toBe(true);
  });

  test("returns empty string unchanged", () => {
    expect(truncatePath("")).toBe("");
  });

  test("respects custom maxLen", () => {
    const result = truncatePath("some/long/path/file.ts", 10);
    expect(result.length).toBe(10);
    expect(result.startsWith("...")).toBe(true);
  });
});

// ── formatTime ──────────────────────────────────────────────────────────────

describe("formatTime", () => {
  test("extracts HH:MM from ISO timestamp", () => {
    expect(formatTime("2024-01-15T14:30:00.000Z")).toBe("14:30");
  });

  test("handles midnight", () => {
    expect(formatTime("2024-01-15T00:00:00.000Z")).toBe("00:00");
  });

  test("handles end of day", () => {
    expect(formatTime("2024-01-15T23:59:00.000Z")).toBe("23:59");
  });

  test("pads single-digit hours", () => {
    expect(formatTime("2024-01-15T09:05:00.000Z")).toBe("09:05");
  });
});

// ── formatRow ───────────────────────────────────────────────────────────────

describe("formatRow", () => {
  test("formats a table row", () => {
    const result = formatRow({
      time: "14:30",
      action: "Read",
      files: "src/app.ts",
      outcome: "index hit",
      tokens: "~150",
    });
    expect(result).toBe("| 14:30 | Read | src/app.ts | index hit | ~150 |\n");
  });

  test("escapes pipe characters in outcome", () => {
    const result = formatRow({
      time: "15:00",
      action: "Session end",
      files: "\u2014",
      outcome: "2 writes | ~450 tok total",
      tokens: "\u2014",
    });
    expect(result).toContain("2 writes \\| ~450 tok total");
  });
});

// ── formatSessionHeader ─────────────────────────────────────────────────────

describe("formatSessionHeader", () => {
  test("produces header with date, table header, and session start row", () => {
    const result = formatSessionHeader("2024-01-15T14:30:00.000Z");
    expect(result).toContain("### Session \u2014 2024-01-15 14:30");
    expect(result).toContain("| Time | Action | File(s) | Outcome | ~Tokens |");
    expect(result).toContain("| --- | --- | --- | --- | --- |");
    expect(result).toContain("| 14:30 | Session start |");
  });

  test("starts with a blank line for spacing", () => {
    const result = formatSessionHeader("2024-01-15T14:30:00.000Z");
    expect(result.startsWith("\n")).toBe(true);
  });
});

// ── formatReadRow ───────────────────────────────────────────────────────────

describe("formatReadRow", () => {
  test("formats read with index hit", () => {
    const result = formatReadRow("2024-01-15T14:32:00.000Z", "src/config.ts", true, 150);
    expect(result).toBe("| 14:32 | Read | src/config.ts | index hit | ~150 |\n");
  });

  test("formats read with index miss", () => {
    const result = formatReadRow("2024-01-15T14:33:00.000Z", "src/app.ts", false, 420);
    expect(result).toBe("| 14:33 | Read | src/app.ts | index miss | ~420 |\n");
  });

  test("truncates long file paths", () => {
    const longPath = "src/components/deeply/nested/folder/structure/that/is/very/long/Button.tsx";
    const result = formatReadRow("2024-01-15T14:32:00.000Z", longPath, true, 100);
    expect(result).toContain("...");
    // The file path portion should be at most 60 chars
    const cells = result.split("|").map((c) => c.trim());
    expect(cells[3].length).toBeLessThanOrEqual(60);
  });
});

// ── formatWriteRow ──────────────────────────────────────────────────────────

describe("formatWriteRow", () => {
  test("formats edit row", () => {
    const result = formatWriteRow(
      "2024-01-15T14:35:00.000Z",
      "src/server.ts",
      "edit",
      "HTTP handler update",
      300
    );
    expect(result).toBe("| 14:35 | Edit | src/server.ts | HTTP handler update | ~300 |\n");
  });

  test("formats create row", () => {
    const result = formatWriteRow(
      "2024-01-15T14:36:00.000Z",
      "src/utils/format.ts",
      "create",
      "New formatting utility",
      180
    );
    expect(result).toBe("| 14:36 | Create | src/utils/format.ts | New formatting utility | ~180 |\n");
  });

  test("uses em dash for empty description", () => {
    const result = formatWriteRow(
      "2024-01-15T14:36:00.000Z",
      "src/data.bin",
      "create",
      "",
      0
    );
    expect(result).toContain("| \u2014 |");
  });
});

// ── formatSessionEndRow ─────────────────────────────────────────────────────

describe("formatSessionEndRow", () => {
  test("formats session end with summary", () => {
    const summary = makeSummary();
    const result = formatSessionEndRow(summary);
    expect(result).toContain("| 15:00 | Session end |");
    expect(result).toContain("1 writes across 2 files");
    expect(result).toContain("~450 tok total");
  });

  test("counts unique files across reads and writes", () => {
    const summary = makeSummary({
      reads: [
        { filePath: "a.ts", estimatedTokens: 100, readCount: 1, firstReadAt: "2024-01-15T14:32:00.000Z" },
        { filePath: "b.ts", estimatedTokens: 100, readCount: 1, firstReadAt: "2024-01-15T14:32:00.000Z" },
      ],
      writes: [
        { filePath: "a.ts", action: "edit", estimatedTokens: 200, timestamp: "2024-01-15T14:35:00.000Z" },
        { filePath: "c.ts", action: "create", estimatedTokens: 100, timestamp: "2024-01-15T14:36:00.000Z" },
      ],
      totals: {
        readCount: 2,
        writeCount: 2,
        estimatedTokens: 500,
        repeatedReads: 0,
        fileIndexHits: 2,
        fileIndexMisses: 0,
      },
    });
    const result = formatSessionEndRow(summary);
    // a.ts, b.ts, c.ts = 3 unique files
    expect(result).toContain("across 3 files");
  });

  test("escapes pipe in outcome", () => {
    const result = formatSessionEndRow(makeSummary());
    // The outcome contains "| ~450 tok total" which should be escaped
    expect(result).toContain("\\|");
  });
});

// ── formatConsolidatedLine ──────────────────────────────────────────────────

describe("formatConsolidatedLine", () => {
  test("formats a blockquote summary", () => {
    const result = formatConsolidatedLine("2024-01-08", 12, 4, 3200, [
      "src/app.ts",
      "src/config.ts",
      "tests/app.test.ts",
    ]);
    expect(result).toContain("> **2024-01-08**");
    expect(result).toContain("12 reads");
    expect(result).toContain("4 writes");
    expect(result).toContain("~3200 tokens");
    expect(result).toContain("key files: src/app.ts, src/config.ts, tests/app.test.ts");
  });

  test("limits key files to 5", () => {
    const files = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"];
    const result = formatConsolidatedLine("2024-01-08", 1, 1, 100, files);
    expect(result).not.toContain("f.ts");
    expect(result).toContain("e.ts");
  });
});

// ── appendToLog ─────────────────────────────────────────────────────────────

describe("appendToLog", () => {
  test("creates file and appends text", () => {
    const logPath = join(tmpDir, "action-log.md");
    appendToLog(logPath, "hello\n");
    expect(readFileSync(logPath, "utf-8")).toBe("hello\n");
  });

  test("appends to existing file", () => {
    const logPath = join(tmpDir, "action-log.md");
    appendToLog(logPath, "line1\n");
    appendToLog(logPath, "line2\n");
    expect(readFileSync(logPath, "utf-8")).toBe("line1\nline2\n");
  });

  test("creates parent directories", () => {
    const logPath = join(tmpDir, "nested", "dir", "action-log.md");
    appendToLog(logPath, "content\n");
    expect(readFileSync(logPath, "utf-8")).toBe("content\n");
  });
});

// ── safeReadLog ─────────────────────────────────────────────────────────────

describe("safeReadLog", () => {
  test("reads existing file", () => {
    const logPath = join(tmpDir, "action-log.md");
    appendToLog(logPath, "content");
    expect(safeReadLog(logPath)).toBe("content");
  });

  test("returns empty string for missing file", () => {
    expect(safeReadLog(join(tmpDir, "nonexistent.md"))).toBe("");
  });
});

// ── parseLogSessions ────────────────────────────────────────────────────────

describe("parseLogSessions", () => {
  test("returns empty array for empty string", () => {
    expect(parseLogSessions("")).toEqual([]);
  });

  test("parses single session", () => {
    const content =
      "\n### Session \u2014 2024-01-15 14:30\n\n" +
      "| Time | Action | File(s) | Outcome | ~Tokens |\n" +
      "| --- | --- | --- | --- | --- |\n" +
      "| 14:30 | Session start | \u2014 | \u2014 | \u2014 |\n" +
      "| 14:32 | Read | src/app.ts | index hit | ~150 |\n";

    const sessions = parseLogSessions(content);
    expect(sessions.length).toBe(1);
    expect(sessions[0].date).toBe("2024-01-15");
    expect(sessions[0].entryCount).toBe(2); // start row + read row
  });

  test("parses multiple sessions", () => {
    const content =
      "\n### Session \u2014 2024-01-15 14:30\n\n" +
      "| Time | Action | File(s) | Outcome | ~Tokens |\n" +
      "| --- | --- | --- | --- | --- |\n" +
      "| 14:30 | Session start | \u2014 | \u2014 | \u2014 |\n" +
      "\n### Session \u2014 2024-01-16 10:00\n\n" +
      "| Time | Action | File(s) | Outcome | ~Tokens |\n" +
      "| --- | --- | --- | --- | --- |\n" +
      "| 10:00 | Session start | \u2014 | \u2014 | \u2014 |\n" +
      "| 10:05 | Read | a.ts | index miss | ~200 |\n" +
      "| 10:10 | Edit | b.ts | updated | ~300 |\n";

    const sessions = parseLogSessions(content);
    expect(sessions.length).toBe(2);
    expect(sessions[0].date).toBe("2024-01-15");
    expect(sessions[0].entryCount).toBe(1);
    expect(sessions[1].date).toBe("2024-01-16");
    expect(sessions[1].entryCount).toBe(3);
  });
});

// ── identifySessionsToConsolidate ───────────────────────────────────────────

describe("identifySessionsToConsolidate", () => {
  const config: ConsolidationConfig = { maxEntries: 10, retentionDays: 7 };
  const now = new Date("2024-01-20T12:00:00.000Z");

  test("returns empty when total entries under threshold", () => {
    const sessions = [
      { startIndex: 0, endIndex: 100, date: "2024-01-10", entryCount: 3, content: "" },
      { startIndex: 100, endIndex: 200, date: "2024-01-19", entryCount: 3, content: "" },
    ];
    expect(identifySessionsToConsolidate(sessions, config, now)).toEqual([]);
  });

  test("identifies old sessions when over threshold", () => {
    const sessions = [
      { startIndex: 0, endIndex: 100, date: "2024-01-10", entryCount: 5, content: "" },
      { startIndex: 100, endIndex: 200, date: "2024-01-11", entryCount: 4, content: "" },
      { startIndex: 200, endIndex: 300, date: "2024-01-19", entryCount: 3, content: "" },
    ];
    const result = identifySessionsToConsolidate(sessions, config, now);
    // Sessions on 2024-01-10 and 2024-01-11 are older than 7 days before 2024-01-20
    expect(result).toEqual([0, 1]);
  });

  test("returns empty when all sessions recent even if over threshold", () => {
    const sessions = [
      { startIndex: 0, endIndex: 100, date: "2024-01-18", entryCount: 6, content: "" },
      { startIndex: 100, endIndex: 200, date: "2024-01-19", entryCount: 6, content: "" },
    ];
    const result = identifySessionsToConsolidate(sessions, config, now);
    expect(result).toEqual([]);
  });
});

// ── consolidateLog ──────────────────────────────────────────────────────────

describe("consolidateLog", () => {
  test("does nothing for empty file", () => {
    const logPath = join(tmpDir, "action-log.md");
    consolidateLog(logPath, { maxEntries: 5, retentionDays: 7 });
    // File should not exist
    expect(safeReadLog(logPath)).toBe("");
  });

  test("does nothing when under threshold", () => {
    const logPath = join(tmpDir, "action-log.md");
    const content =
      "\n### Session \u2014 2024-01-15 14:30\n\n" +
      "| Time | Action | File(s) | Outcome | ~Tokens |\n" +
      "| --- | --- | --- | --- | --- |\n" +
      "| 14:30 | Session start | \u2014 | \u2014 | \u2014 |\n";
    appendToLog(logPath, content);
    consolidateLog(logPath, { maxEntries: 200, retentionDays: 7 });
    expect(safeReadLog(logPath)).toBe(content);
  });

  test("consolidates old sessions and preserves recent ones", () => {
    const logPath = join(tmpDir, "action-log.md");

    // Old session (10+ days ago)
    const oldSession =
      "\n### Session \u2014 2024-01-05 09:00\n\n" +
      "| Time | Action | File(s) | Outcome | ~Tokens |\n" +
      "| --- | --- | --- | --- | --- |\n" +
      "| 09:00 | Session start | \u2014 | \u2014 | \u2014 |\n" +
      "| 09:05 | Read | src/app.ts | index hit | ~150 |\n" +
      "| 09:10 | Edit | src/server.ts | updated handler | ~300 |\n" +
      "| 09:15 | Session end | \u2014 | 1 writes across 2 files \\| ~450 tok total | \u2014 |\n";

    // Recent session (within retention)
    const recentSession =
      "\n### Session \u2014 2024-01-19 10:00\n\n" +
      "| Time | Action | File(s) | Outcome | ~Tokens |\n" +
      "| --- | --- | --- | --- | --- |\n" +
      "| 10:00 | Session start | \u2014 | \u2014 | \u2014 |\n" +
      "| 10:05 | Read | a.ts | index miss | ~200 |\n" +
      "| 10:10 | Edit | b.ts | fix bug | ~300 |\n" +
      "| 10:15 | Session end | \u2014 | 1 writes across 2 files \\| ~500 tok total | \u2014 |\n";

    appendToLog(logPath, oldSession + recentSession);

    consolidateLog(
      logPath,
      { maxEntries: 5, retentionDays: 7 },
      new Date("2024-01-20T12:00:00.000Z"),
    );

    const result = safeReadLog(logPath);
    // Old session should be consolidated to a summary line
    expect(result).toContain("> **2024-01-05**");
    expect(result).toContain("1 reads");
    expect(result).toContain("1 writes");
    // Recent session should be preserved in full
    expect(result).toContain("### Session \u2014 2024-01-19 10:00");
    expect(result).toContain("| 10:05 | Read | a.ts | index miss | ~200 |");
  });
});

// ── createActionLogWriter ───────────────────────────────────────────────────

describe("createActionLogWriter", () => {
  test("appendSessionHeader writes header to file", () => {
    const logPath = join(tmpDir, "action-log.md");
    const writer = createActionLogWriter(logPath);
    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("### Session \u2014 2024-01-15 14:30");
    expect(content).toContain("| 14:30 | Session start |");
  });

  test("appendReadEntry appends read row", () => {
    const logPath = join(tmpDir, "action-log.md");
    const writer = createActionLogWriter(logPath);
    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");
    writer.appendReadEntry("2024-01-15T14:32:00.000Z", "src/app.ts", true, 150);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("| 14:32 | Read | src/app.ts | index hit | ~150 |");
  });

  test("appendWriteEntry appends write row", () => {
    const logPath = join(tmpDir, "action-log.md");
    const writer = createActionLogWriter(logPath);
    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");
    writer.appendWriteEntry("2024-01-15T14:35:00.000Z", "src/server.ts", "edit", "Fix bug", 300);
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("| 14:35 | Edit | src/server.ts | Fix bug | ~300 |");
  });

  test("appendSessionEnd appends summary row", () => {
    const logPath = join(tmpDir, "action-log.md");
    const writer = createActionLogWriter(logPath);
    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");
    writer.appendSessionEnd(makeSummary());
    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("| 15:00 | Session end |");
  });

  test("full lifecycle produces valid log", () => {
    const logPath = join(tmpDir, "action-log.md");
    const writer = createActionLogWriter(logPath);

    writer.appendSessionHeader("2024-01-15T14:30:00.000Z");
    writer.appendReadEntry("2024-01-15T14:32:00.000Z", "src/app.ts", true, 150);
    writer.appendWriteEntry("2024-01-15T14:35:00.000Z", "src/server.ts", "edit", "Fix handler", 300);
    writer.appendSessionEnd(makeSummary());

    const content = readFileSync(logPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Time") && !l.startsWith("| ---"));
    expect(lines.length).toBe(4); // start, read, write, end
  });
});
