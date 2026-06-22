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

// Tool-output compression measurement (spec 21).

// What the caller supplies when recording a compression decision. `id` and
// `createdAt` are generated when omitted. For a holdout arm, pass the original
// output unchanged so `compressedTokens === originalTokens` and `holdout: true`.
export interface CompressionEventInput {
  toolName: string;
  contentKind: string;
  originalTokens: number;
  compressedTokens: number;
  holdout: boolean;
  id?: string;
  createdAt?: string;
}

export interface CompressionEvent {
  id: string;
  createdAt: string;
  toolName: string;
  contentKind: string;
  originalTokens: number;
  compressedTokens: number;
  holdout: boolean;
}

export interface CompressionLifetime {
  totalEvents: number;
  totalHoldoutEvents: number;
  totalOriginalTokens: number;
  totalCompressedTokens: number;
  totalMeasuredSavings: number;
}
