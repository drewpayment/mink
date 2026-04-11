export interface LifetimeCounters {
  totalTokens: number;
  totalReads: number;
  totalWrites: number;
  totalSessions: number;
  totalFileIndexHits: number;
  totalFileIndexMisses: number;
  totalRepeatedReads: number;
  totalEstimatedSavings: number;
}

export interface LedgerSession {
  sessionId: string;
  startTimestamp: string;
  endTimestamp: string;
  reads: Array<{
    filePath: string;
    estimatedTokens: number;
    readCount: number;
  }>;
  writes: Array<{
    filePath: string;
    estimatedTokens: number;
    action: "create" | "edit";
  }>;
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

import type { WasteFlag } from "./waste-detection";

export interface TokenLedger {
  lifetime: LifetimeCounters;
  sessions: LedgerSession[];
  wasteFlags?: WasteFlag[];
}
