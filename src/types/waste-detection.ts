export type WastePattern =
  | "repeated-reads"
  | "missed-index-opportunity"
  | "action-log-bloat"
  | "learning-memory-staleness"
  | "index-miss-rate";

export interface WasteFlag {
  pattern: WastePattern;
  description: string;
  estimatedTokensWasted: number;
  suggestion: string;
  detectedAt: string;
}

export interface DetectionConfig {
  actionLogBloatThreshold: number;
  learningMemoryStaleDays: number;
  indexMissRateThreshold: number;
  missedIndexMinTokens: number;
}
