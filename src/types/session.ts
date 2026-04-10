export interface FileRead {
  readCount: number;
  estimatedTokens: number;
  firstReadAt: string; // ISO 8601 UTC
}

export interface WriteEntry {
  filePath: string;
  action: "create" | "edit";
  estimatedTokens: number;
  timestamp: string; // ISO 8601 UTC
}

export interface SessionCounters {
  fileIndexHits: number;
  fileIndexMisses: number;
  repeatedReadWarnings: number;
  learnedRuleWarnings: number;
}

export interface SessionState {
  sessionId: string;
  startTimestamp: string; // ISO 8601 UTC
  stopCount: number;
  reads: Record<string, FileRead>;
  writes: WriteEntry[];
  counters: SessionCounters;
}

export interface SessionSummary {
  sessionId: string;
  startTimestamp: string;
  endTimestamp: string;
  reads: Array<{ filePath: string } & FileRead>;
  writes: WriteEntry[];
  totals: {
    readCount: number;
    writeCount: number;
    estimatedTokens: number;
    repeatedReads: number;
    fileIndexHits: number;
    fileIndexMisses: number;
  };
  estimatedSavings: number;
}

export interface SessionFinalizer {
  appendSession(summary: SessionSummary): void;
  updateSession(summary: SessionSummary): void;
}
