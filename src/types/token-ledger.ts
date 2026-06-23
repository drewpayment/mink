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
  // Measured tool-output compression aggregates (spec 21). Optional because the
  // legacy JSON-fallback ledger path has no compression data; only the SQLite
  // snapshot() populates it.
  compression?: CompressionLifetime;
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

// Compression aggregates split by arm — the holdout A/B view. The lifetime row
// sums original/compressed across both arms, so an honest comparison must come
// from grouping ledger_compressions by the holdout flag.
export interface CompressionArms {
  compressed: { events: number; originalTokens: number; compressedTokens: number };
  holdout: { events: number; originalTokens: number };
}

// One row of a compression breakdown grouped by a dimension (content kind or
// tool). `savings` credits compressed arms only.
export interface CompressionBreakdownRow {
  key: string;
  events: number;
  originalTokens: number;
  compressedTokens: number;
  savings: number;
}
