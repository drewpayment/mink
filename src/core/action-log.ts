import { readFileSync } from "fs";
import { safeAppendText, atomicWriteText } from "./fs-utils";
import type { SessionSummary } from "../types/session";
import type {
  ActionLogEntry,
  ConsolidationConfig,
  ParsedSession,
} from "../types/action-log";

// ── Path Truncation ─────────────────────────────────────────────────────────

export function truncatePath(filePath: string, maxLen: number = 60): string {
  if (filePath.length <= maxLen) return filePath;
  return "..." + filePath.slice(-(maxLen - 3));
}

// ── Formatting (pure, no I/O) ───────────────────────────────────────────────

export function formatTime(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function formatRow(entry: ActionLogEntry): string {
  return `| ${entry.time} | ${entry.action} | ${escapeCell(entry.files)} | ${escapeCell(entry.outcome)} | ${entry.tokens} |\n`;
}

export function formatSessionHeader(isoTimestamp: string): string {
  const d = new Date(isoTimestamp);
  const date = d.toISOString().slice(0, 10);
  const time = formatTime(isoTimestamp);
  const startRow = formatRow({
    time,
    action: "Session start",
    files: "\u2014",
    outcome: "\u2014",
    tokens: "\u2014",
  });
  return (
    `\n### Session \u2014 ${date} ${time}\n\n` +
    `| Time | Action | File(s) | Outcome | ~Tokens |\n` +
    `| --- | --- | --- | --- | --- |\n` +
    startRow
  );
}

export function formatReadRow(
  isoTimestamp: string,
  filePath: string,
  indexHit: boolean,
  estimatedTokens: number
): string {
  return formatRow({
    time: formatTime(isoTimestamp),
    action: "Read",
    files: truncatePath(filePath),
    outcome: indexHit ? "index hit" : "index miss",
    tokens: `~${estimatedTokens}`,
  });
}

export function formatWriteRow(
  isoTimestamp: string,
  filePath: string,
  action: "create" | "edit",
  description: string,
  estimatedTokens: number
): string {
  return formatRow({
    time: formatTime(isoTimestamp),
    action: action === "create" ? "Create" : "Edit",
    files: truncatePath(filePath),
    outcome: description || "\u2014",
    tokens: `~${estimatedTokens}`,
  });
}

export function formatSessionEndRow(summary: SessionSummary): string {
  const filesSet = new Set<string>();
  for (const r of summary.reads) filesSet.add(r.filePath);
  for (const w of summary.writes) filesSet.add(w.filePath);

  return formatRow({
    time: formatTime(summary.endTimestamp),
    action: "Session end",
    files: "\u2014",
    outcome: `${summary.totals.writeCount} writes across ${filesSet.size} files | ~${summary.totals.estimatedTokens} tok total`,
    tokens: "\u2014",
  });
}

export function formatConsolidatedLine(
  date: string,
  readCount: number,
  writeCount: number,
  estimatedTokens: number,
  keyFiles: string[]
): string {
  const files = keyFiles.slice(0, 5).join(", ");
  return `> **${date}** \u2014 ${readCount} reads | ${writeCount} writes | ~${estimatedTokens} tokens | key files: ${files}\n`;
}

// ── I/O Operations ──────────────────────────────────────────────────────────

export function appendToLog(logPath: string, text: string): void {
  try {
    safeAppendText(logPath, text);
  } catch {
    // Retry once
    try {
      safeAppendText(logPath, text);
    } catch {
      console.warn(
        `[mink] Warning: failed to append to action log at ${logPath}`
      );
    }
  }
}

export function safeReadLog(logPath: string): string {
  try {
    return readFileSync(logPath, "utf-8");
  } catch {
    return "";
  }
}

// ── Consolidation ───────────────────────────────────────────────────────────

const SESSION_HEADER_RE = /^### Session \u2014 (\d{4}-\d{2}-\d{2}) \d{2}:\d{2}$/gm;

export function parseLogSessions(content: string): ParsedSession[] {
  const sessions: ParsedSession[] = [];
  const headerMatches: Array<{ index: number; date: string }> = [];

  let match: RegExpExecArray | null;
  SESSION_HEADER_RE.lastIndex = 0;
  while ((match = SESSION_HEADER_RE.exec(content)) !== null) {
    headerMatches.push({ index: match.index, date: match[1] });
  }

  for (let i = 0; i < headerMatches.length; i++) {
    const startIndex = headerMatches[i].index;
    const endIndex =
      i + 1 < headerMatches.length ? headerMatches[i + 1].index : content.length;
    const sessionContent = content.slice(startIndex, endIndex);

    // Count data rows: lines starting with "| " that are not header or separator
    const lines = sessionContent.split("\n");
    let entryCount = 0;
    for (const line of lines) {
      if (
        line.startsWith("| ") &&
        !line.startsWith("| Time") &&
        !line.startsWith("| ---")
      ) {
        entryCount++;
      }
    }

    sessions.push({
      startIndex,
      endIndex,
      date: headerMatches[i].date,
      entryCount,
      content: sessionContent,
    });
  }

  return sessions;
}

export function identifySessionsToConsolidate(
  sessions: ParsedSession[],
  config: ConsolidationConfig,
  now: Date = new Date()
): number[] {
  // Check total entry count
  let totalEntries = 0;
  for (const s of sessions) totalEntries += s.entryCount;

  if (totalEntries <= config.maxEntries) return [];

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - config.retentionDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const indices: number[] = [];
  for (let i = 0; i < sessions.length; i++) {
    if (sessions[i].date < cutoffStr) {
      indices.push(i);
    }
  }

  return indices;
}

function extractSessionStats(
  session: ParsedSession
): { readCount: number; writeCount: number; estimatedTokens: number; keyFiles: string[] } {
  let readCount = 0;
  let writeCount = 0;
  let estimatedTokens = 0;
  const fileSet = new Set<string>();

  const lines = session.content.split("\n");
  for (const line of lines) {
    if (
      !line.startsWith("| ") ||
      line.startsWith("| Time") ||
      line.startsWith("| ---")
    ) {
      continue;
    }

    // Parse table row: | time | action | file | outcome | ~tokens |
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 5) continue;

    const action = cells[1];
    const file = cells[2];
    const tokenStr = cells[4];

    if (action === "Read") {
      readCount++;
      if (file !== "\u2014") fileSet.add(file);
    } else if (action === "Create" || action === "Edit") {
      writeCount++;
      if (file !== "\u2014") fileSet.add(file);
    }

    if (tokenStr.startsWith("~")) {
      const n = parseInt(tokenStr.slice(1), 10);
      if (!isNaN(n)) estimatedTokens += n;
    }
  }

  return {
    readCount,
    writeCount,
    estimatedTokens,
    keyFiles: [...fileSet].slice(0, 5),
  };
}

export function consolidateLog(
  logPath: string,
  config: ConsolidationConfig = { maxEntries: 200, retentionDays: 7 },
  now?: Date
): void {
  const content = safeReadLog(logPath);
  if (!content) return;

  const sessions = parseLogSessions(content);
  if (sessions.length === 0) return;

  const toConsolidate = identifySessionsToConsolidate(sessions, config, now);
  if (toConsolidate.length === 0) return;

  const consolidateSet = new Set(toConsolidate);
  const parts: string[] = [];

  for (let i = 0; i < sessions.length; i++) {
    if (consolidateSet.has(i)) {
      const stats = extractSessionStats(sessions[i]);
      parts.push(
        formatConsolidatedLine(
          sessions[i].date,
          stats.readCount,
          stats.writeCount,
          stats.estimatedTokens,
          stats.keyFiles
        )
      );
    } else {
      parts.push(sessions[i].content);
    }
  }

  atomicWriteText(logPath, parts.join(""));
}

// ── Factory ─────────────────────────────────────────────────────────────────

export interface ActionLogWriter {
  appendSessionHeader(isoTimestamp: string): void;
  appendReadEntry(
    isoTimestamp: string,
    filePath: string,
    indexHit: boolean,
    estimatedTokens: number
  ): void;
  appendWriteEntry(
    isoTimestamp: string,
    filePath: string,
    action: "create" | "edit",
    description: string,
    estimatedTokens: number
  ): void;
  appendSessionEnd(summary: SessionSummary): void;
}

export function createActionLogWriter(logPath: string): ActionLogWriter {
  return {
    appendSessionHeader(isoTimestamp: string): void {
      appendToLog(logPath, formatSessionHeader(isoTimestamp));
    },

    appendReadEntry(
      isoTimestamp: string,
      filePath: string,
      indexHit: boolean,
      estimatedTokens: number
    ): void {
      appendToLog(logPath, formatReadRow(isoTimestamp, filePath, indexHit, estimatedTokens));
    },

    appendWriteEntry(
      isoTimestamp: string,
      filePath: string,
      action: "create" | "edit",
      description: string,
      estimatedTokens: number
    ): void {
      appendToLog(logPath, formatWriteRow(isoTimestamp, filePath, action, description, estimatedTokens));
    },

    appendSessionEnd(summary: SessionSummary): void {
      appendToLog(logPath, formatSessionEndRow(summary));
    },
  };
}
