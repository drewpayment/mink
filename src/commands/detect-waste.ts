import { statSync } from "fs";
import { learningMemoryPath } from "../core/paths";
import { FileIndexRepo } from "../repositories/file-index-repo";
import { TokenLedgerRepo } from "../repositories/token-ledger-repo";
import {
  aggregateTokenLedger,
  aggregateActionLog,
} from "../core/state-aggregator";
import { loadCounters } from "../core/state-counters";
import { runDetection } from "../core/waste-detection";
import { getOrCreateDeviceId } from "../core/device";
import type { TokenLedger } from "../types/token-ledger";
import type { FileIndexEntry } from "../types/file-index";

export function detectWaste(cwd: string): void {
  const lmPath = learningMemoryPath(cwd);

  // Aggregated ledger (across all device shards + legacy). Aggregator returns
  // an empty ledger when no sources exist, so the empty-vs-corrupt distinction
  // collapses into "treat missing as empty" — corrupt files inside a shard are
  // already logged by loadLedger.
  const ledger: TokenLedger = aggregateTokenLedger(cwd);

  // Load file index — read every entry into the map shape the waste
  // detector expects. listAll() walks the table once; under 20k rows it
  // returns in single-digit ms.
  const repo = FileIndexRepo.for(cwd);
  const entries: Record<string, FileIndexEntry> = {};
  for (const e of repo.listAll()) entries[e.filePath] = e;
  const totalFiles = repo.totalFiles();
  const lastScanTimestamp = repo.getLastScanTimestamp();

  // Aggregated action log content (across all device shards + legacy)
  const actionLogContent = aggregateActionLog(cwd);

  // Get learning memory mtime
  let learningMemoryMtimeMs: number | null = null;
  try {
    learningMemoryMtimeMs = statSync(lmPath).mtimeMs;
  } catch {
    // File missing — will be flagged as stale
  }

  // Pull hit/miss telemetry from the SQLite counters table. We synthesize
  // the header shape the detector expects (lifetimeHits/Misses lived in
  // the JSON header pre-migration).
  const counters = loadCounters(cwd);
  const headerForDetection = {
    lastScanTimestamp,
    totalFiles,
    lifetimeHits: counters.fileIndexHits,
    lifetimeMisses: counters.fileIndexMisses,
  };

  // Run detection on the aggregated cross-device view
  const flags = runDetection(
    ledger,
    entries,
    headerForDetection,
    actionLogContent,
    learningMemoryMtimeMs
  );

  // Persist flags in THIS device's waste_flags rows. The merge driver
  // unions across devices on sync; replaceWasteFlagsForDevice clears
  // and rewrites this device's set on every detection run.
  TokenLedgerRepo.for(cwd).replaceWasteFlagsForDevice(getOrCreateDeviceId(), flags);

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
