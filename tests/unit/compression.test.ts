import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  loadCompressionConfig,
  isEligible,
  meetsMinSavings,
  measuredSavings,
  selectHoldout,
} from "../../src/core/compression";

const ENV_KEYS = [
  "MINK_COMPRESSION_ENABLED",
  "MINK_COMPRESSION_THRESHOLD_TOKENS",
  "MINK_COMPRESSION_MIN_SAVINGS_RATIO",
  "MINK_COMPRESSION_HOLDOUT_FRACTION",
  "MINK_COMPRESSION_RETENTION_HOURS",
];

let tmpRoot: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-compression-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  delete process.env.MINK_ROOT_OVERRIDE;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("loadCompressionConfig", () => {
  test("returns enabled-by-default with conservative thresholds when nothing is configured", () => {
    const cfg = loadCompressionConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.thresholdTokens).toBe(800);
    expect(cfg.minSavingsRatio).toBe(0.25);
    expect(cfg.holdoutFraction).toBe(0.1);
    expect(cfg.retentionHours).toBe(168);
  });

  test("reads overrides from environment variables", () => {
    process.env.MINK_COMPRESSION_ENABLED = "true";
    process.env.MINK_COMPRESSION_THRESHOLD_TOKENS = "1500";
    process.env.MINK_COMPRESSION_HOLDOUT_FRACTION = "0.2";
    const cfg = loadCompressionConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.thresholdTokens).toBe(1500);
    expect(cfg.holdoutFraction).toBe(0.2);
  });

  test("clamps out-of-range and non-numeric values", () => {
    process.env.MINK_COMPRESSION_MIN_SAVINGS_RATIO = "5";   // clamp to 1
    process.env.MINK_COMPRESSION_HOLDOUT_FRACTION = "-1";   // clamp to 0
    process.env.MINK_COMPRESSION_THRESHOLD_TOKENS = "abc";  // fall back to 800
    const cfg = loadCompressionConfig();
    expect(cfg.minSavingsRatio).toBe(1);
    expect(cfg.holdoutFraction).toBe(0);
    expect(cfg.thresholdTokens).toBe(800);
  });
});

describe("isEligible", () => {
  const base = {
    enabled: true,
    thresholdTokens: 800,
    minSavingsRatio: 0.25,
    holdoutFraction: 0.1,
    retentionHours: 168,
  };

  test("below the threshold passes through", () => {
    expect(isEligible(799, base)).toBe(false);
  });

  test("at or above the threshold is eligible", () => {
    expect(isEligible(800, base)).toBe(true);
    expect(isEligible(5000, base)).toBe(true);
  });

  test("never eligible when compression is disabled", () => {
    expect(isEligible(5000, { ...base, enabled: false })).toBe(false);
  });
});

describe("meetsMinSavings", () => {
  const base = {
    enabled: true,
    thresholdTokens: 800,
    minSavingsRatio: 0.25,
    holdoutFraction: 0.1,
    retentionHours: 168,
  };

  test("keeps an attempt that saves enough", () => {
    expect(meetsMinSavings(1000, 700, base)).toBe(true); // 30% saved
  });

  test("discards an attempt that saves too little", () => {
    expect(meetsMinSavings(1000, 900, base)).toBe(false); // 10% saved
  });

  test("discards when the result is no smaller", () => {
    expect(meetsMinSavings(1000, 1000, base)).toBe(false);
  });
});

describe("measuredSavings", () => {
  test("is the positive difference", () => {
    expect(measuredSavings(1000, 300)).toBe(700);
  });

  test("never goes negative", () => {
    expect(measuredSavings(300, 1000)).toBe(0);
  });
});

describe("selectHoldout", () => {
  test("is stable for a given key", () => {
    const key = "abc123";
    expect(selectHoldout(key, 0.3)).toBe(selectHoldout(key, 0.3));
  });

  test("fraction 0 holds out nothing", () => {
    for (const k of ["a", "b", "c", "d"]) expect(selectHoldout(k, 0)).toBe(false);
  });

  test("fraction 1 holds out everything", () => {
    for (const k of ["a", "b", "c", "d"]) expect(selectHoldout(k, 1)).toBe(true);
  });

  test("selects roughly the configured fraction across many keys", () => {
    let held = 0;
    const n = 2000;
    for (let i = 0; i < n; i++) {
      if (selectHoldout(`event-${i}`, 0.1)) held++;
    }
    const frac = held / n;
    // Loose bound — deterministic hash, so this is fixed, just sanity-checking
    // the distribution lands near the target rather than 0 or everything.
    expect(frac).toBeGreaterThan(0.05);
    expect(frac).toBeLessThan(0.15);
  });
});
