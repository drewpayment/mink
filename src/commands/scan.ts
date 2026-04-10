import { readFileSync } from "fs";
import { join } from "path";
import { fileIndexPath, configPath } from "../core/paths";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";
import { scanProject, loadConfig, getExcludes } from "../core/scanner";
import { extractDescription } from "../core/description";
import { estimateTokens } from "../core/token-estimate";
import {
  createEmptyIndex,
  isFileIndex,
  upsertEntry,
  checkStaleness,
} from "../core/index-store";
import type { FileIndex, FileIndexEntry } from "../types/file-index";

function loadExistingIndex(indexPath: string): FileIndex {
  const raw = safeReadJson(indexPath);
  if (isFileIndex(raw)) return raw;
  if (raw !== null) {
    console.error("[mink] file-index.json is corrupt — starting fresh");
  }
  return createEmptyIndex();
}

export function scan(cwd: string, options: { check: boolean }): void {
  const idxPath = fileIndexPath(cwd);
  const cfgPath = configPath(cwd);
  const config = loadConfig(cfgPath);
  const excludes = getExcludes(config);
  const maxFiles = config.maxFiles ?? 500;

  if (options.check) {
    const existing = safeReadJson(idxPath);
    if (!isFileIndex(existing)) {
      console.error("[mink] no index found — run mink scan first");
      process.exit(1);
    }

    const scanned = scanProject(cwd, excludes, maxFiles);
    const scannedPaths = scanned.map((f) => f.relativePath);
    const report = checkStaleness(existing, scannedPaths);

    if (!report.isStale) {
      console.log("[mink] index is up to date");
      return;
    }

    if (report.missingFromIndex.length > 0) {
      console.log(`Missing from index (${report.missingFromIndex.length}):`);
      for (const f of report.missingFromIndex) {
        console.log(`  + ${f}`);
      }
    }
    if (report.orphanedEntries.length > 0) {
      console.log(`Orphaned entries (${report.orphanedEntries.length}):`);
      for (const f of report.orphanedEntries) {
        console.log(`  - ${f}`);
      }
    }
    process.exit(1);
  }

  // Full scan
  const start = Date.now();
  const index = loadExistingIndex(idxPath);

  const scanned = scanProject(cwd, excludes, maxFiles);

  // Build new entries, preserving lifetime counters
  const newIndex = createEmptyIndex();
  newIndex.header.lifetimeHits = index.header.lifetimeHits;
  newIndex.header.lifetimeMisses = index.header.lifetimeMisses;

  for (const file of scanned) {
    const fullPath = join(cwd, file.relativePath);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue; // Skip unreadable files
    }

    const entry: FileIndexEntry = {
      filePath: file.relativePath,
      description: extractDescription(file.relativePath, content),
      estimatedTokens: estimateTokens(content, file.relativePath),
      lastModified: new Date(file.mtimeMs).toISOString(),
      lastIndexed: new Date().toISOString(),
    };
    upsertEntry(newIndex, entry);
  }

  newIndex.header.lastScanTimestamp = new Date().toISOString();

  atomicWriteJson(idxPath, newIndex);

  const elapsed = Date.now() - start;
  console.log(
    `[mink] indexed ${newIndex.header.totalFiles} files in ${elapsed}ms`
  );
}
