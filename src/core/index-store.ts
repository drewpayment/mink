import type {
  FileIndex,
  FileIndexEntry,
  StalenessReport,
} from "../types/file-index";

export function createEmptyIndex(): FileIndex {
  return {
    header: {
      lastScanTimestamp: "",
      totalFiles: 0,
      lifetimeHits: 0,
      lifetimeMisses: 0,
    },
    entries: {},
  };
}

export function isFileIndex(value: unknown): value is FileIndex {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.header === "object" &&
    obj.header !== null &&
    typeof obj.entries === "object" &&
    obj.entries !== null
  );
}

export function upsertEntry(index: FileIndex, entry: FileIndexEntry): void {
  index.entries[entry.filePath] = entry;
  index.header.totalFiles = Object.keys(index.entries).length;
}

export function removeEntry(index: FileIndex, filePath: string): void {
  delete index.entries[filePath];
  index.header.totalFiles = Object.keys(index.entries).length;
}

export function lookupEntry(
  index: FileIndex,
  filePath: string
): FileIndexEntry | null {
  return index.entries[filePath] ?? null;
}

export function recordHit(index: FileIndex): void {
  index.header.lifetimeHits++;
}

export function recordMiss(index: FileIndex): void {
  index.header.lifetimeMisses++;
}

export function checkStaleness(
  index: FileIndex,
  scannedFiles: string[]
): StalenessReport {
  const scannedSet = new Set(scannedFiles);
  const indexedSet = new Set(Object.keys(index.entries));

  const missingFromIndex = scannedFiles.filter((f) => !indexedSet.has(f));
  const orphanedEntries = Object.keys(index.entries).filter(
    (f) => !scannedSet.has(f)
  );

  return {
    missingFromIndex,
    orphanedEntries,
    isStale: missingFromIndex.length > 0 || orphanedEntries.length > 0,
  };
}
