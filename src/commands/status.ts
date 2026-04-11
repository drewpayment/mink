import { existsSync, readFileSync, statSync } from "fs";
import {
  sessionPath,
  fileIndexPath,
  configPath,
  learningMemoryPath,
  tokenLedgerPath,
  bugMemoryPath,
  actionLogPath,
} from "../core/paths";
import { safeReadJson } from "../core/fs-utils";
import { isFileIndex } from "../core/index-store";
import { loadLedger } from "../core/token-ledger";
import { parseLearningMemory, totalEntryCount } from "../core/learning-memory";
import { loadBugMemory } from "../core/bug-memory";
import { getDaemonStatus } from "../core/daemon";

interface FileCheck {
  name: string;
  path: string;
  status: "ok" | "missing" | "corrupt";
}

function checkJsonFile(name: string, filePath: string, validator?: (v: unknown) => boolean): FileCheck {
  if (!existsSync(filePath)) return { name, path: filePath, status: "missing" };
  const data = safeReadJson(filePath);
  if (data === null) return { name, path: filePath, status: "corrupt" };
  if (validator && !validator(data)) return { name, path: filePath, status: "corrupt" };
  return { name, path: filePath, status: "ok" };
}

function checkTextFile(name: string, filePath: string): FileCheck {
  if (!existsSync(filePath)) return { name, path: filePath, status: "missing" };
  try {
    readFileSync(filePath, "utf-8");
    return { name, path: filePath, status: "ok" };
  } catch {
    return { name, path: filePath, status: "corrupt" };
  }
}

export function status(cwd: string): void {
  console.log("[mink] project status");
  console.log();

  // Section 1: State directory integrity
  const checks: FileCheck[] = [
    checkJsonFile("session.json", sessionPath(cwd)),
    checkJsonFile("file-index.json", fileIndexPath(cwd), isFileIndex),
    checkJsonFile("config.json", configPath(cwd)),
    checkTextFile("learning-memory.md", learningMemoryPath(cwd)),
    checkJsonFile("token-ledger.json", tokenLedgerPath(cwd)),
    checkJsonFile("bug-memory.json", bugMemoryPath(cwd)),
    checkTextFile("action-log.md", actionLogPath(cwd)),
  ];

  console.log("  State files:");
  for (const check of checks) {
    const icon = check.status === "ok" ? "ok" : check.status === "missing" ? "missing" : "corrupt";
    console.log(`    ${check.name}: ${icon}`);
  }

  const corrupt = checks.filter((c) => c.status === "corrupt");
  if (corrupt.length > 0) {
    console.log();
    console.log("  Warning: corrupted files detected. Consider running: mink restore");
  }
  console.log();

  // Section 2: File index
  try {
    const raw = safeReadJson(fileIndexPath(cwd));
    if (raw && isFileIndex(raw)) {
      const h = raw.header;
      const total = h.lifetimeHits + h.lifetimeMisses;
      const ratio = total > 0 ? ((h.lifetimeHits / total) * 100).toFixed(1) : "N/A";
      console.log("  File index:");
      console.log(`    Files: ${h.totalFiles}`);
      console.log(`    Last scan: ${h.lastScanTimestamp || "never"}`);
      console.log(`    Hit/miss ratio: ${ratio}${total > 0 ? "%" : ""} (${h.lifetimeHits} hits, ${h.lifetimeMisses} misses)`);
    } else {
      console.log("  File index: not available");
    }
  } catch {
    console.log("  File index: error reading");
  }
  console.log();

  // Section 3: Token ledger
  try {
    const ledger = loadLedger(tokenLedgerPath(cwd));
    const lt = ledger.lifetime;
    console.log("  Token ledger:");
    console.log(`    Sessions: ${lt.totalSessions}`);
    console.log(`    Total tokens: ${lt.totalTokens.toLocaleString()}`);
    console.log(`    Reads: ${lt.totalReads}  Writes: ${lt.totalWrites}`);
    console.log(`    Estimated savings: ${lt.totalEstimatedSavings.toLocaleString()} tokens`);
  } catch {
    console.log("  Token ledger: error reading");
  }
  console.log();

  // Section 4: Learning memory
  try {
    const memPath = learningMemoryPath(cwd);
    if (existsSync(memPath)) {
      const content = readFileSync(memPath, "utf-8");
      const mem = parseLearningMemory(content);
      const total = totalEntryCount(mem);
      const mtime = statSync(memPath).mtime;
      console.log("  Learning memory:");
      console.log(`    User Preferences: ${mem.sections["User Preferences"].length}`);
      console.log(`    Key Learnings: ${mem.sections["Key Learnings"].length}`);
      console.log(`    Do-Not-Repeat: ${mem.sections["Do-Not-Repeat"].length}`);
      console.log(`    Decision Log: ${mem.sections["Decision Log"].length}`);
      console.log(`    Total entries: ${total}`);
      console.log(`    Last modified: ${mtime.toISOString()}`);
    } else {
      console.log("  Learning memory: not initialized");
    }
  } catch {
    console.log("  Learning memory: error reading");
  }
  console.log();

  // Section 5: Bug log
  try {
    const bugs = loadBugMemory(bugMemoryPath(cwd));
    console.log(`  Bug log: ${bugs.entries.length} entries`);
  } catch {
    console.log("  Bug log: error reading");
  }
  console.log();

  // Section 6: Daemon status
  try {
    const daemon = getDaemonStatus(cwd);
    if (daemon.running) {
      const uptimeMs = Date.now() - new Date(daemon.startedAt!).getTime();
      const uptimeMin = Math.floor(uptimeMs / 60_000);
      const uptimeHrs = Math.floor(uptimeMin / 60);
      const uptimeStr = uptimeHrs > 0
        ? `${uptimeHrs}h ${uptimeMin % 60}m`
        : `${uptimeMin}m`;
      console.log(`  Daemon: running (PID: ${daemon.pid}, uptime: ${uptimeStr})`);
    } else {
      console.log("  Daemon: stopped");
    }
  } catch {
    console.log("  Daemon: unknown");
  }
}
