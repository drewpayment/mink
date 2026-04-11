import type { WasteFlag, DetectionConfig } from "../types/waste-detection";
import type { LedgerSession, TokenLedger } from "../types/token-ledger";
import type { FileIndexEntry, FileIndexHeader } from "../types/file-index";
import { estimateTokens } from "./token-estimate";

// ── Default Config ──────────────────────────────────────────────────────────

export function defaultDetectionConfig(): DetectionConfig {
  return {
    actionLogBloatThreshold: 5000,
    learningMemoryStaleDays: 14,
    indexMissRateThreshold: 0.20,
    missedIndexMinTokens: 500,
  };
}

// ── Detector 1: Repeated Reads ──────────────────────────────────────────────

export function detectRepeatedReads(
  sessions: LedgerSession[],
  now: string
): WasteFlag[] {
  const flags: WasteFlag[] = [];

  for (const session of sessions) {
    for (const read of session.reads) {
      if (read.readCount > 1) {
        const wasted = (read.readCount - 1) * read.estimatedTokens;
        flags.push({
          pattern: "repeated-reads",
          description: `File "${read.filePath}" was read ${read.readCount} times in session ${session.sessionId}`,
          estimatedTokensWasted: wasted,
          suggestion:
            "Use the file index description instead of re-reading, or cache the content within the session.",
          detectedAt: now,
        });
      }
    }
  }

  return flags;
}

// ── Detector 2: Missed Index Opportunities ──────────────────────────────────

export function detectMissedIndexOpportunities(
  sessions: LedgerSession[],
  indexEntries: Record<string, FileIndexEntry>,
  config: DetectionConfig,
  now: string
): WasteFlag[] {
  const aggregated = new Map<string, number>();

  for (const session of sessions) {
    for (const read of session.reads) {
      if (read.estimatedTokens > config.missedIndexMinTokens) {
        const entry = indexEntries[read.filePath];
        if (entry && entry.description) {
          const prev = aggregated.get(read.filePath) ?? 0;
          aggregated.set(read.filePath, prev + read.estimatedTokens);
        }
      }
    }
  }

  const flags: WasteFlag[] = [];
  for (const [filePath, totalTokens] of aggregated) {
    const entry = indexEntries[filePath];
    flags.push({
      pattern: "missed-index-opportunity",
      description: `Read of "${filePath}" (~${totalTokens} tokens) could have used index description instead`,
      estimatedTokensWasted: totalTokens,
      suggestion: `Index description available: "${entry.description}". Consider using the index instead of full file reads.`,
      detectedAt: now,
    });
  }

  return flags;
}

// ── Detector 3: Action Log Bloat ────────────────────────────────────────────

export function detectActionLogBloat(
  actionLogContent: string,
  config: DetectionConfig,
  now: string
): WasteFlag | null {
  if (!actionLogContent) return null;

  const tokenCount = estimateTokens(actionLogContent, "action-log.md");
  if (tokenCount > config.actionLogBloatThreshold) {
    return {
      pattern: "action-log-bloat",
      description: `Action log is ~${tokenCount} tokens, exceeding the ${config.actionLogBloatThreshold} token threshold`,
      estimatedTokensWasted: tokenCount - config.actionLogBloatThreshold,
      suggestion: "Run action log consolidation to reduce size.",
      detectedAt: now,
    };
  }

  return null;
}

// ── Detector 4: Learning Memory Staleness ───────────────────────────────────

export function detectLearningMemoryStaleness(
  lastModifiedMs: number | null,
  config: DetectionConfig,
  now: string
): WasteFlag | null {
  if (lastModifiedMs === null) {
    return {
      pattern: "learning-memory-staleness",
      description: "Learning memory file is missing",
      estimatedTokensWasted: 0,
      suggestion:
        "Create a learning memory file by running mink init, or manually create learning-memory.md.",
      detectedAt: now,
    };
  }

  const nowMs = Date.parse(now);
  const ageMs = nowMs - lastModifiedMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays > config.learningMemoryStaleDays) {
    const lastUpdate = new Date(lastModifiedMs).toISOString().slice(0, 10);
    return {
      pattern: "learning-memory-staleness",
      description: `Learning memory hasn't been updated in ${Math.floor(ageDays)} days (threshold: ${config.learningMemoryStaleDays} days)`,
      estimatedTokensWasted: 0,
      suggestion: "Review and update the learning memory to keep it current.",
      detectedAt: now,
    };
  }

  return null;
}

// ── Detector 5: Index Miss Rate ─────────────────────────────────────────────

export function detectIndexMissRate(
  lifetimeHits: number,
  lifetimeMisses: number,
  config: DetectionConfig,
  now: string
): WasteFlag | null {
  const totalLookups = lifetimeHits + lifetimeMisses;
  if (totalLookups === 0) return null;

  const missRate = lifetimeMisses / totalLookups;
  if (missRate > config.indexMissRateThreshold) {
    const pct = Math.round(missRate * 100);
    return {
      pattern: "index-miss-rate",
      description: `File index miss rate is ${pct}% (${lifetimeMisses} misses out of ${totalLookups} lookups)`,
      estimatedTokensWasted: 0,
      suggestion: "Run a full rescan with mink scan to update the file index.",
      detectedAt: now,
    };
  }

  return null;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export function runDetection(
  ledger: TokenLedger,
  indexEntries: Record<string, FileIndexEntry>,
  indexHeader: FileIndexHeader,
  actionLogContent: string,
  learningMemoryMtimeMs: number | null,
  config?: Partial<DetectionConfig>,
  now?: Date
): WasteFlag[] {
  const fullConfig: DetectionConfig = {
    ...defaultDetectionConfig(),
    ...config,
  };
  const nowStr = (now ?? new Date()).toISOString();

  const flags: WasteFlag[] = [];

  flags.push(...detectRepeatedReads(ledger.sessions, nowStr));
  flags.push(
    ...detectMissedIndexOpportunities(
      ledger.sessions,
      indexEntries,
      fullConfig,
      nowStr
    )
  );

  const bloatFlag = detectActionLogBloat(actionLogContent, fullConfig, nowStr);
  if (bloatFlag) flags.push(bloatFlag);

  const stalenessFlag = detectLearningMemoryStaleness(
    learningMemoryMtimeMs,
    fullConfig,
    nowStr
  );
  if (stalenessFlag) flags.push(stalenessFlag);

  const missRateFlag = detectIndexMissRate(
    indexHeader.lifetimeHits,
    indexHeader.lifetimeMisses,
    fullConfig,
    nowStr
  );
  if (missRateFlag) flags.push(missRateFlag);

  return flags;
}
