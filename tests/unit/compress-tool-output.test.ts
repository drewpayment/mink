import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { compressToolOutput } from "../../src/core/compress-tool-output";
import { CompressionCacheRepo } from "../../src/repositories/compression-cache-repo";
import { TokenLedgerRepo } from "../../src/repositories/token-ledger-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../src/storage/db";
import { projectIdFor } from "../../src/core/project-id";

const ENV_KEYS = [
  "MINK_COMPRESSION_ENABLED",
  "MINK_COMPRESSION_THRESHOLD_TOKENS",
  "MINK_COMPRESSION_MIN_SAVINGS_RATIO",
  "MINK_COMPRESSION_HOLDOUT_FRACTION",
  "MINK_COMPRESSION_RETENTION_HOURS",
];

let tmpRoot: string;
let cwd: string;
let savedEnv: Record<string, string | undefined>;

// A large, highly compressible output (lots of lines) → eligible + good savings.
const BIG_LOG = Array.from({ length: 400 }, (_, i) => `log line ${i}`).join("\n");

function setCompressionEnv(overrides: Record<string, string> = {}): void {
  process.env.MINK_COMPRESSION_ENABLED = "true";
  process.env.MINK_COMPRESSION_THRESHOLD_TOKENS = "50";
  process.env.MINK_COMPRESSION_MIN_SAVINGS_RATIO = "0.25";
  process.env.MINK_COMPRESSION_HOLDOUT_FRACTION = "0";
  process.env.MINK_COMPRESSION_RETENTION_HOURS = "168";
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-cto-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-cto-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe("compressToolOutput", () => {
  test("is a no-op when compression is disabled", () => {
    // No env set → default enabled=false.
    expect(compressToolOutput(cwd, "Bash", BIG_LOG)).toBeNull();
  });

  test("passes small outputs through (below threshold)", () => {
    setCompressionEnv({ MINK_COMPRESSION_THRESHOLD_TOKENS: "100000" });
    expect(compressToolOutput(cwd, "Bash", BIG_LOG)).toBeNull();
  });

  test("compresses an eligible output and stores a retrievable original", () => {
    setCompressionEnv();
    const outcome = compressToolOutput(cwd, "Bash", BIG_LOG);
    expect(outcome).not.toBeNull();
    expect(outcome!.updatedToolOutput).toContain("mink retrieve");
    expect(outcome!.updatedToolOutput.length).toBeLessThan(BIG_LOG.length);

    // The original is retrievable byte-exact.
    const entry = CompressionCacheRepo.for(cwd).get(outcome!.token);
    expect(entry).not.toBeNull();
    expect(entry!.content).toBe(BIG_LOG);

    // A compressed arm is recorded with real measured savings.
    const lt = TokenLedgerRepo.for(cwd).compressionLifetime();
    expect(lt.totalEvents).toBe(1);
    expect(lt.totalHoldoutEvents).toBe(0);
    expect(lt.totalMeasuredSavings).toBeGreaterThan(0);
  });

  test("holdout arm passes the original through but is measured", () => {
    setCompressionEnv({ MINK_COMPRESSION_HOLDOUT_FRACTION: "1" });
    const outcome = compressToolOutput(cwd, "Bash", BIG_LOG);
    expect(outcome).toBeNull(); // original passes through

    const lt = TokenLedgerRepo.for(cwd).compressionLifetime();
    expect(lt.totalEvents).toBe(1);
    expect(lt.totalHoldoutEvents).toBe(1);
    expect(lt.totalMeasuredSavings).toBe(0);
    // Holdout stores nothing — there's no compressed result to reverse.
    expect(CompressionCacheRepo.for(cwd).count()).toBe(0);
  });

  test("discards a compression that fails the min-savings gate", () => {
    setCompressionEnv({ MINK_COMPRESSION_MIN_SAVINGS_RATIO: "0.99" });
    const outcome = compressToolOutput(cwd, "Bash", BIG_LOG);
    expect(outcome).toBeNull();
    // Nothing stored, nothing recorded — the original is used as-is.
    expect(CompressionCacheRepo.for(cwd).count()).toBe(0);
    expect(TokenLedgerRepo.for(cwd).compressionLifetime().totalEvents).toBe(0);
  });

  test("passes through output the engine can't shrink", () => {
    setCompressionEnv();
    // Few lines → no strategy produces a smaller result.
    expect(compressToolOutput(cwd, "Bash", "one\ntwo\nthree\n".repeat(1))).toBeNull();
  });
});
