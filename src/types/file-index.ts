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
