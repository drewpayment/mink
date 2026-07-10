// Tool-output compression types (spec 22). The decision/config types live in
// src/core/compression.ts; these describe the reversible cache and the engine's
// content-aware output.

// What kind of tool output we detected, which selects the compressor and is
// recorded on the ledger event for later analysis.
export type ContentKind = "search" | "log" | "file" | "json" | "text";

// One stored original, retrievable byte-exact via `mink retrieve <token>` until
// it expires.
export interface CompressionCacheEntry {
  token: string;
  createdAt: string;
  expiresAt: string;
  toolName: string;
  contentKind: ContentKind;
  content: string;
  sizeBytes: number;
}

// The result of compressing one output. `compressed` is the body the model will
// see (sans retrieval affordance, which the pipeline appends); `omittedNote`
// summarises what was dropped. A compressor returns null when it has nothing
// worth substituting.
export interface CompressionResult {
  kind: ContentKind;
  compressed: string;
  omittedNote: string;
}
