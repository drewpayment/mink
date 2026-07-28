import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { buildRoiReport, formatRoiReport } from "../../src/core/roi-report";
import { TokenLedgerRepo } from "../../src/repositories/token-ledger-repo";
import { _resetDbCacheForTests } from "../../src/storage/db";
import { projectIdFor } from "../../src/core/project-id";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-roi-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-roi-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  delete process.env.MINK_REPORT_MODEL;
  delete process.env.MINK_REPORT_INPUT_PRICE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function seed() {
  const repo = TokenLedgerRepo.for(cwd);
  // Compressed arm: 1M → 200K = 800K measured savings.
  repo.recordCompression({
    toolName: "Grep",
    contentKind: "search",
    originalTokens: 1_000_000,
    compressedTokens: 200_000,
    holdout: false,
  });
  // Holdout arm: passed through, saves nothing but is measured.
  repo.recordCompression({
    toolName: "Bash",
    contentKind: "log",
    originalTokens: 1_000_000,
    compressedTokens: 1_000_000,
    holdout: true,
  });
}

describe("buildRoiReport", () => {
  test("dollarizes measured savings at the default (sonnet) price", () => {
    seed();
    const r = buildRoiReport(cwd);
    expect(r.measuredSavingsTokens).toBe(800_000);
    expect(r.measuredDollars).toBeCloseTo(2.4, 6); // 800K / 1M * $3
    expect(r.compressionEvents).toBe(1);
    expect(r.holdoutEvents).toBe(1);
    expect(r.holdoutFraction).toBeCloseTo(0.5, 6);
    expect(r.compressionRatio).toBeCloseTo(0.4, 6); // 1 - 1.2M/2M
    expect(r.model).toBe("claude-sonnet");
  });

  test("empty ledger yields zero measured savings", () => {
    const r = buildRoiReport(cwd);
    expect(r.measuredSavingsTokens).toBe(0);
    expect(r.measuredDollars).toBe(0);
    expect(r.compressionEvents).toBe(0);
  });
});

describe("formatRoiReport", () => {
  test("cites the dollar figure, model, and holdout basis", () => {
    seed();
    const text = formatRoiReport(buildRoiReport(cwd));
    expect(text).toContain("$2.40");
    expect(text).toContain("claude-sonnet");
    expect(text).toContain("holdout");
    expect(text).toContain("not measured"); // the heuristic estimate is labeled
  });

  test("states plainly when nothing has been measured", () => {
    const text = formatRoiReport(buildRoiReport(cwd));
    expect(text).toContain("No compression measured yet");
  });
});
