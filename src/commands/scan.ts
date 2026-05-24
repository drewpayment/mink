import { readFileSync } from "fs";
import { join, relative } from "path";
import { configPath } from "../core/paths";
import {
  scanProject,
  scanProjectWithStats,
  loadConfig,
  getExcludes,
} from "../core/scanner";
import { extractDescription } from "../core/description";
import { estimateTokens } from "../core/token-estimate";
import { FileIndexRepo } from "../repositories/file-index-repo";
import type { FileIndexEntry } from "../types/file-index";

function configRelativePath(cfgPath: string, cwd: string): string {
  const rel = relative(cwd, cfgPath);
  return rel.startsWith("..") ? cfgPath : rel;
}

export function scan(cwd: string, options: { check: boolean }): void {
  const cfgPath = configPath(cwd);
  const config = loadConfig(cfgPath);
  const excludes = getExcludes(config);
  // Default cap removed in Phase 5 of the SQLite migration — the per-row
  // write cost is now flat in index size. Users who still want a cap can
  // set `maxFiles` in config.json; otherwise scan indexes everything the
  // exclude rules pass.
  const maxFiles = config.maxFiles;
  const repo = FileIndexRepo.for(cwd);

  if (options.check) {
    if (repo.totalFiles() === 0) {
      console.error("[mink] no index found — run mink scan first");
      process.exit(1);
    }

    const scanned = scanProject(cwd, excludes, maxFiles);
    const scannedPaths = scanned.map((f) => f.relativePath);
    const report = repo.checkStaleness(scannedPaths);

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

  // Full scan — Phase 5 adds the mtime/content-hash-driven incremental
  // path on top of this loop. For now we still read every file's content;
  // the SQLite write side is already batched via repo.upsertMany().
  const start = Date.now();

  const stats = scanProjectWithStats(cwd, excludes, maxFiles);
  const scanned = stats.files;

  const batch: Array<{
    entry: FileIndexEntry;
    opts: { mtimeMs: number; sizeBytes: number };
  }> = [];
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
    batch.push({
      entry,
      opts: { mtimeMs: Math.floor(file.mtimeMs), sizeBytes: content.length },
    });
  }

  // Single transaction — ~50x faster than per-file commits at 20k files.
  repo.upsertMany(batch);

  // Prune orphans: every entry whose file is no longer on disk.
  repo.retainOnly(scanned.map((f) => f.relativePath));

  repo.setLastScanTimestamp(new Date().toISOString());

  const elapsed = Date.now() - start;
  const indexed = repo.totalFiles();
  if (stats.truncated > 0) {
    console.log(
      `[mink] scanned ${stats.totalScanned} files; indexed ${indexed} most recent in ${elapsed}ms`
    );
    console.log(
      `  ${stats.truncated} files past maxFiles=${maxFiles} were not indexed`
    );
    console.log(
      `  raise the cap by setting "maxFiles" in ${configRelativePath(cfgPath, cwd)}`
    );
  } else {
    console.log(`[mink] indexed ${indexed} files in ${elapsed}ms`);
  }
}
