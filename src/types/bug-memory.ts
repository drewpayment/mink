export interface BugEntry {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  errorMessage: string;
  filePath: string;
  lineNumber?: number;
  rootCause: string;
  fixDescription: string;
  tags: string[];
  occurrenceCount: number;
  relatedBugIds: string[];
}

export interface BugMemory {
  entries: BugEntry[];
  nextId: number;
}

export interface SimilarityMatch {
  entry: BugEntry;
  score: number;
  matchReasons: string[];
}
