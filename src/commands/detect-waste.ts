import { statSync } from "fs";
import {
  tokenLedgerShardPath,
  fileIndexPath,
  learningMemoryPath,
} from "../core/paths";
import { loadLedger, saveLedger } from "../core/token-ledger";
import { isFileIndex, createEmptyIndex } from "../core/index-store";
import {
  aggregateTokenLedger,
  aggregateActionLog,
} from "../core/state-aggregator";
import { loadCounters } from "../core/state-counters";
import { safeReadJson } from "../core/fs-utils";
import { runDetection } from "../core/waste-detection";
import { getOrCreateDeviceId } from "../core/device";
import type { TokenLedger } from "../types/token-ledger";
import type { FileIndex } from "../types/file-index";

export function detectWaste(cwd: string): void {
  const idxPath = fileIndexPath(cwd);
  const lmPath = learningMemoryPath(cwd);

  // Aggregated ledger (across all device shards + legacy). Aggregator returns
  // an empty ledger when no sources exist, so the empty-vs-corrupt distinction
  // collapses into "treat missing as empty" — corrupt files inside a shard are
  // already logged by loadLedger.
  const ledger: TokenLedger = aggregateTokenLedger(cwd);

  // Load file index
  const rawIndex = safeReadJson(idxPath);
  let fileIndex: FileIndex;
  if (rawIndex !== null && isFileIndex(rawIndex)) {
    fileIndex = rawIndex;
  } else {
    fileIndex = createEmptyIndex();
  }

  // Aggregated action log content (across all device shards + legacy)
  const actionLogContent = aggregateActionLog(cwd);

  // Get learning memory mtime
  let learningMemoryMtimeMs: number | null = null;
  try {
    learningMemoryMtimeMs = statSync(lmPath).mtimeMs;
  } catch {
    // File missing — will be flagged as stale
  }

  // Pull hit/miss telemetry from the per-device counter file, falling back to
  // the legacy header counters when unmigrated. We feed runDetection a synthetic
  // header so it works without knowing about the split.
  const counters = loadCounters(cwd);
  const headerForDetection = {
    ...fileIndex.header,
    lifetimeHits: counters.fileIndexHits || fileIndex.header.lifetimeHits,
    lifetimeMisses: counters.fileIndexMisses || fileIndex.header.lifetimeMisses,
  };

  // Run detection on the aggregated cross-device view
  const flags = runDetection(
    ledger,
    fileIndex.entries,
    headerForDetection,
    actionLogContent,
    learningMemoryMtimeMs
  );

  // Persist flags in THIS device's shard ledger so it's the only writer for
  // that file. The aggregator unions wasteFlags across shards on read, so
  // every device's view stays current without merge conflicts.
  const shardLedgerPath = tokenLedgerShardPath(cwd, getOrCreateDeviceId());
  const shardLedger = loadLedger(shardLedgerPath);
  shardLedger.wasteFlags = flags;
  saveLedger(shardLedgerPath, shardLedger);

  // Output summary
  if (flags.length === 0) {
    console.log("[mink] Waste detection: no issues found.");
  } else {
    console.log(`[mink] Waste detection: ${flags.length} issue(s) found.`);
    for (const flag of flags) {
      console.log(`  - [${flag.pattern}] ${flag.description}`);
      if (flag.estimatedTokensWasted > 0) {
        console.log(`    Estimated waste: ~${flag.estimatedTokensWasted} tokens`);
      }
      console.log(`    Suggestion: ${flag.suggestion}`);
    }
  }
}
