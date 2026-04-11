import { statSync } from "fs";
import {
  tokenLedgerPath,
  fileIndexPath,
  actionLogPath,
  learningMemoryPath,
} from "../core/paths";
import { createEmptyLedger, isTokenLedger, saveLedger } from "../core/token-ledger";
import { isFileIndex, createEmptyIndex } from "../core/index-store";
import { safeReadLog } from "../core/action-log";
import { safeReadJson } from "../core/fs-utils";
import { runDetection } from "../core/waste-detection";
import type { TokenLedger } from "../types/token-ledger";
import type { FileIndex } from "../types/file-index";

export function detectWaste(cwd: string): void {
  const ledgerPath = tokenLedgerPath(cwd);
  const idxPath = fileIndexPath(cwd);
  const logPath = actionLogPath(cwd);
  const lmPath = learningMemoryPath(cwd);

  // Load and validate ledger — distinguish empty vs corrupted
  const rawLedger = safeReadJson(ledgerPath);
  let ledger: TokenLedger;

  if (rawLedger === null) {
    ledger = createEmptyLedger();
  } else if (!isTokenLedger(rawLedger)) {
    console.warn("[mink] Warning: corrupt token ledger, skipping waste detection");
    return;
  } else {
    ledger = rawLedger;
  }

  // Load file index
  const rawIndex = safeReadJson(idxPath);
  let fileIndex: FileIndex;
  if (rawIndex !== null && isFileIndex(rawIndex)) {
    fileIndex = rawIndex;
  } else {
    fileIndex = createEmptyIndex();
  }

  // Load action log content
  const actionLogContent = safeReadLog(logPath);

  // Get learning memory mtime
  let learningMemoryMtimeMs: number | null = null;
  try {
    learningMemoryMtimeMs = statSync(lmPath).mtimeMs;
  } catch {
    // File missing — will be flagged as stale
  }

  // Run detection
  const flags = runDetection(
    ledger,
    fileIndex.entries,
    fileIndex.header,
    actionLogContent,
    learningMemoryMtimeMs
  );

  // Store flags in ledger (replaces previous)
  ledger.wasteFlags = flags;
  saveLedger(ledgerPath, ledger);

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
