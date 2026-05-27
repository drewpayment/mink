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
import {
  aggregateTokenLedger,
  aggregateBugMemory,
  aggregateLearningMemory,
  listDeviceShardsAt,
  listLearningMemorySidecarPathsAt,
  shardPath,
} from "../core/state-aggregator";
import { projectDir } from "../core/paths";
import { loadCounters } from "../core/state-counters";
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

// Reports "ok" when canonical OR any device shard / sidecar exists with content.
// action-log and learning-memory now live in per-device shards; checking only the
// canonical path made initialized projects look empty.
function checkShardedText(name: string, candidatePaths: string[]): FileCheck {
  const canonical = candidatePaths[0];
  for (const p of candidatePaths) {
    if (!existsSync(p)) continue;
    try {
      if (statSync(p).size === 0) continue;
      readFileSync(p, "utf-8");
      return { name, path: p, status: "ok" };
    } catch {
      return { name, path: p, status: "corrupt" };
    }
  }
  return { name, path: canonical, status: "missing" };
}

function actionLogCandidates(cwd: string): string[] {
  const dir = projectDir(cwd);
  return [
    actionLogPath(cwd),
    ...listDeviceShardsAt(dir).map((id) => shardPath(dir, id, "action-log.md")),
  ];
}

function learningMemoryCandidates(cwd: string): string[] {
  const dir = projectDir(cwd);
  return [learningMemoryPath(cwd), ...listLearningMemorySidecarPathsAt(dir)];
}

export function status(cwd: string): void {
  console.log("[mink] project status");
  console.log();

  // Section 1: State directory integrity
  const checks: FileCheck[] = [
    checkJsonFile("session.json", sessionPath(cwd)),
    checkJsonFile("file-index.json", fileIndexPath(cwd), isFileIndex),
    checkJsonFile("config.json", configPath(cwd)),
    checkShardedText("learning-memory.md", learningMemoryCandidates(cwd)),
    checkJsonFile("token-ledger.json", tokenLedgerPath(cwd)),
    checkJsonFile("bug-memory.json", bugMemoryPath(cwd)),
    checkShardedText("action-log.md", actionLogCandidates(cwd)),
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
      // Hit/miss counters live in the per-device counter file, fall back to
      // legacy header counters for unmigrated repos.
      const counters = loadCounters(cwd);
      const hits = counters.fileIndexHits || h.lifetimeHits;
      const misses = counters.fileIndexMisses || h.lifetimeMisses;
      const total = hits + misses;
      const ratio = total > 0 ? ((hits / total) * 100).toFixed(1) : "N/A";
      console.log("  File index:");
      console.log(`    Files: ${h.totalFiles}`);
      console.log(`    Last scan: ${h.lastScanTimestamp || "never"}`);
      console.log(`    Hit/miss ratio: ${ratio}${total > 0 ? "%" : ""} (${hits} hits, ${misses} misses)`);
    } else {
      console.log("  File index: not available");
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
