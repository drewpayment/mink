import { readFileSync } from "fs";
import { createHash } from "crypto";
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

// Truncated SHA-1 — 16 hex chars is plenty to distinguish content
// versions of the same file. Cheaper than cryptographic strength;
// we only use it for change detection, never as a security boundary.
function contentHashOf(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

export function scan(cwd: string, options: { check: boolean }): void {
  const cfgPath = configPath(cwd);
  const config = loadConfig(cfgPath);
  const excludes = getExcludes(config);
  // No default cap as of Phase 5 — per-row write cost is flat in SQLite.
  // Users who still want a cap set `maxFiles` in config.json.
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

  // Incremental scan — the actual 20k-file win.
  //   1. Walk the tree (cheap; just stat + readdir).
  //   2. Repo.staleSet(scanned) returns only paths whose mtime differs
  //      from what's stored (or never indexed at all). Everything else
  //      gets skipped — no readFileSync, no description extract, no
  //      token estimate.
  //   3. For stale paths, read content + compute a content hash. If the
  //      stored content_hash matches, the file was just touched
  //      without an edit — skip the description/tokens re-extract and
  //      only refresh mtime/last_indexed. Otherwise do the full
  //      re-extract.
  //   4. Bulk upsert in a single transaction, then prune orphans.
  const start = Date.now();

  const stats = scanProjectWithStats(cwd, excludes, maxFiles);
  const scanned = stats.files;

  const stalePaths = new Set(repo.staleSet(scanned));
  const batch: Array<{
    entry: FileIndexEntry;
    opts: { mtimeMs: number; contentHash: string | null; sizeBytes: number };
  }> = [];
  let touchOnlyCount = 0;
  let extractedCount = 0;

  for (const file of scanned) {
    if (!stalePaths.has(file.relativePath)) {
      // mtime matches what we have — nothing to do for this file.
      continue;
    }

    const fullPath = join(cwd, file.relativePath);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue; // Skip unreadable files (permissions, race condition)
    }

    const hash = contentHashOf(content);
    const existing = repo.lookupEntry(file.relativePath);
    const existingHash = existing ? repo.contentHashFor(file.relativePath) : null;

    if (existing && existingHash === hash) {
      // Touched but unchanged — bump mtime/last_indexed only, keep the
      // stored description + token estimate.
      batch.push({
        entry: {
          filePath: file.relativePath,
          description: existing.description,
          estimatedTokens: existing.estimatedTokens,
          lastModified: new Date(file.mtimeMs).toISOString(),
          lastIndexed: new Date().toISOString(),
        },
        opts: {
          mtimeMs: Math.floor(file.mtimeMs),
          contentHash: hash,
          sizeBytes: content.length,
        },
      });
      touchOnlyCount++;
      continue;
    }

    // Full re-extract.
    batch.push({
      entry: {
        filePath: file.relativePath,
        description: extractDescription(file.relativePath, content),
        estimatedTokens: estimateTokens(content, file.relativePath),
        lastModified: new Date(file.mtimeMs).toISOString(),
        lastIndexed: new Date().toISOString(),
      },
      opts: {
        mtimeMs: Math.floor(file.mtimeMs),
        contentHash: hash,
        sizeBytes: content.length,
      },
    });
    extractedCount++;
  }

  // Single transaction — ~50x faster than per-file commits at 20k files.
  if (batch.length > 0) repo.upsertMany(batch);

  // Prune orphans: every entry whose file is no longer on disk.
  const removed = repo.retainOnly(scanned.map((f) => f.relativePath));

  repo.setLastScanTimestamp(new Date().toISOString());

  const elapsed = Date.now() - start;
  const indexed = repo.totalFiles();
  const skipped = scanned.length - stalePaths.size;

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
    return;
  }

  if (skipped === scanned.length && extractedCount === 0 && touchOnlyCount === 0 && removed === 0) {
    console.log(`[mink] indexed ${indexed} files in ${elapsed}ms (no changes)`);
  } else {
    const parts: string[] = [];
    if (extractedCount > 0) parts.push(`${extractedCount} re-indexed`);
    if (touchOnlyCount > 0) parts.push(`${touchOnlyCount} touch-only`);
    if (removed > 0) parts.push(`${removed} pruned`);
    if (skipped > 0)  parts.push(`${skipped} unchanged`);
    console.log(
      `[mink] indexed ${indexed} files in ${elapsed}ms (${parts.join(", ")})`
    );
  }
}

