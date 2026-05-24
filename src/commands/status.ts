import { existsSync, readFileSync, statSync } from "fs";
import {
  sessionPath,
  projectDbPath,
  configPath,
  learningMemoryPath,
  tokenLedgerPath,
  actionLogPath,
} from "../core/paths";
import { safeReadJson } from "../core/fs-utils";
import { FileIndexRepo } from "../repositories/file-index-repo";
import { openProjectDb } from "../storage/db";
import {
  aggregateTokenLedger,
  aggregateBugMemory,
  aggregateLearningMemory,
} from "../core/state-aggregator";
import { loadCounters } from "../core/state-counters";
import { getDaemonStatus } from "../core/daemon";
import { totalEntryCount } from "../core/learning-memory";

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

function checkDbFile(name: string, filePath: string): FileCheck {
  if (!existsSync(filePath)) return { name, path: filePath, status: "missing" };
  try {
    const header = readFileSync(filePath).slice(0, 16).toString("utf-8");
    if (!header.startsWith("SQLite format 3")) {
      return { name, path: filePath, status: "corrupt" };
    }
    return { name, path: filePath, status: "ok" };
  } catch {
    return { name, path: filePath, status: "corrupt" };
  }
}

export function status(cwd: string): void {
  console.log("[mink] project status");
  console.log();

  // Open the project DB up-front so the lazy JSON → SQLite migration
  // runs before checkDbFile inspects mink.db. Otherwise the integrity
  // section would always report "missing" on a project that has only
  // legacy JSON state.
  try {
    openProjectDb(cwd);
  } catch {
    // Migration failures are non-fatal — report the DB as corrupt below.
  }

  // Section 1: State directory integrity. file-index and bug-memory now
  // live inside mink.db; the token-ledger JSON check remains until
  // Phase 4 takes ownership.
  const checks: FileCheck[] = [
    checkJsonFile("session.json", sessionPath(cwd)),
    checkDbFile("mink.db", projectDbPath(cwd)),
    checkJsonFile("config.json", configPath(cwd)),
    checkTextFile("learning-memory.md", learningMemoryPath(cwd)),
    checkJsonFile("token-ledger.json", tokenLedgerPath(cwd)),
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

  // Section 2: File index — sourced from mink.db.
  try {
    const repo = FileIndexRepo.for(cwd);
    const total = repo.totalFiles();
    if (total === 0) {
      console.log("  File index: not available");
    } else {
      const counters = loadCounters(cwd);
      const hits = counters.fileIndexHits;
      const misses = counters.fileIndexMisses;
      const totalLookups = hits + misses;
      const ratio = totalLookups > 0 ? ((hits / totalLookups) * 100).toFixed(1) : "N/A";
      console.log("  File index:");
      console.log(`    Files: ${total}`);
      console.log(`    Last scan: ${repo.getLastScanTimestamp() || "never"}`);
      console.log(`    Hit/miss ratio: ${ratio}${totalLookups > 0 ? "%" : ""} (${hits} hits, ${misses} misses)`);
    }
  } catch {
    console.log("  File index: error reading");
  }
  console.log();

  // Section 3: Token ledger (aggregated across all device shards + legacy)
  try {
    const ledger = aggregateTokenLedger(cwd);
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

  // Section 4: Learning memory (canonical + sidecars)
  try {
    const mem = aggregateLearningMemory(cwd);
    const total = totalEntryCount(mem);
    if (total === 0 && mem.projectName === "unknown") {
      console.log("  Learning memory: not initialized");
    } else {
      console.log("  Learning memory:");
      console.log(`    User Preferences: ${mem.sections["User Preferences"].length}`);
      console.log(`    Key Learnings: ${mem.sections["Key Learnings"].length}`);
      console.log(`    Do-Not-Repeat: ${mem.sections["Do-Not-Repeat"].length}`);
      console.log(`    Decision Log: ${mem.sections["Decision Log"].length}`);
      console.log(`    Total entries: ${total}`);
      const memPath = learningMemoryPath(cwd);
      if (existsSync(memPath)) {
        const mtime = statSync(memPath).mtime;
        console.log(`    Canonical last modified: ${mtime.toISOString()}`);
      }
    }
  } catch {
    console.log("  Learning memory: error reading");
  }
  console.log();

  // Section 5: Bug log (aggregated across shards)
  try {
    const bugs = aggregateBugMemory(cwd);
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
