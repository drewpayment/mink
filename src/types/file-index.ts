export interface FileIndexHeader {
  lastScanTimestamp: string;
  totalFiles: number;
  lifetimeHits: number;
  lifetimeMisses: number;
}

export interface FileIndexEntry {
  filePath: string;
  description: string;
  estimatedTokens: number;
  lastModified: string;
  lastIndexed: string;
}

export interface FileIndex {
  header: FileIndexHeader;
  entries: Record<string, FileIndexEntry>;
}

export interface ProjectConfig {
  excludePatterns?: string[];
  maxFiles?: number;
  learningMemoryTokenBudget?: number;
  actionLogMaxEntries?: number;
  actionLogRetentionDays?: number;
}

export interface StalenessReport {
  missingFromIndex: string[];
  orphanedEntries: string[];
  isStale: boolean;
}

export interface ScannedFile {
  relativePath: string;
  mtimeMs: number;
}

// Minimal contract analyzers in the hook hot path depend on. Both the
// SQLite-backed FileIndexRepo and the in-memory adapter built from a
// FileIndex object implement this. Restricting the analyzer signatures to
// this surface keeps "load the whole index just to satisfy a type" off
// the critical path for projects with 20k+ files.
export interface IndexLookup {
  lookupEntry(filePath: string): FileIndexEntry | null;
}
