// Tool-output compression — configuration and decision logic (spec 21).
//
// This module is pure: it reads config and makes the eligibility / holdout /
// min-savings decisions. It never touches the database or the tool payload, so
// it is trivially testable. Phase 2 wires the actual compressors and the
// reversible cache on top of these decisions; Phase 1 ships the measurement
// instrument and leaves `enabled` off by default.

import { resolveConfigValue } from "./global-config";
import type { ConfigKey } from "../types/config";

export interface CompressionConfig {
  enabled: boolean;
  thresholdTokens: number;
  minSavingsRatio: number;
  holdoutFraction: number;
  retentionHours: number;
}

function numberValue(key: ConfigKey, fallback: number, min: number, max: number): number {
  const raw = resolveConfigValue(key).value;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function loadCompressionConfig(): CompressionConfig {
  return {
    enabled: resolveConfigValue("compression.enabled").value === "true",
    thresholdTokens: numberValue("compression.threshold-tokens", 800, 0, Number.MAX_SAFE_INTEGER),
    minSavingsRatio: numberValue("compression.min-savings-ratio", 0.25, 0, 1),
    holdoutFraction: numberValue("compression.holdout-fraction", 0.1, 0, 1),
    retentionHours: numberValue("compression.retention-hours", 168, 0, Number.MAX_SAFE_INTEGER),
  };
}

// An output is eligible for compression only once it crosses the size threshold;
// small outputs are never touched (spec 21 §Eligibility).
export function isEligible(originalTokens: number, config: CompressionConfig): boolean {
  return config.enabled && originalTokens >= config.thresholdTokens;
}

// A compression attempt is kept only if it saves at least the configured
// fraction of tokens; otherwise the original is used (spec 21 §Thresholds).
export function meetsMinSavings(
  originalTokens: number,
  compressedTokens: number,
  config: CompressionConfig
): boolean {
  if (originalTokens <= 0) return false;
  const ratio = (originalTokens - compressedTokens) / originalTokens;
  return ratio >= config.minSavingsRatio;
}

export function measuredSavings(originalTokens: number, compressedTokens: number): number {
  return Math.max(0, originalTokens - compressedTokens);
}

// Deterministic FNV-1a hash → a stable fraction in [0, 1) for a given key. Used
// so holdout selection is stable per event: the same event always lands in the
// same arm, which keeps measurement from being double-counted (spec 21 edge
// case "Holdout selection must be stable for a given event").
function hashUnitInterval(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Map the 32-bit unsigned result into [0, 1).
  return (h >>> 0) / 0x100000000;
}

// Decide whether a given event is held out (left uncompressed as a control).
// Selection is deterministic in `eventKey`, so callers must pass a key that is
// stable for the event (e.g. a hash of the original output) and not, say, a
// timestamp.
export function selectHoldout(eventKey: string, fraction: number): boolean {
  if (fraction <= 0) return false;
  if (fraction >= 1) return true;
  return hashUnitInterval(eventKey) < fraction;
}
