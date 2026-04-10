import { describe, expect, test } from "bun:test";
import { analyzePreRead } from "../../src/commands/pre-read";
import { createSessionState, recordRead } from "../../src/core/session";
import { createEmptyIndex, upsertEntry } from "../../src/core/index-store";
import type { FileIndexEntry } from "../../src/types/file-index";

function makeEntry(filePath: string, description: string, estimatedTokens: number): FileIndexEntry {
  return {
    filePath,
    description,
    estimatedTokens,
    lastModified: new Date().toISOString(),
    lastIndexed: new Date().toISOString(),
  };
}

describe("analyzePreRead", () => {
  test("first read of a file is not flagged as repeated", () => {
    const state = createSessionState();
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));

    const result = analyzePreRead("src/auth.ts", state, index);

    expect(result.repeatedRead).toBe(false);
    expect(state.counters.repeatedReadWarnings).toBe(0);
  });

  test("second read is flagged with correct token count", () => {
    const state = createSessionState();
    // Simulate a prior read recorded by post-read
    recordRead(state, "src/auth.ts", 380, true);

    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));

    const result = analyzePreRead("src/auth.ts", state, index);

    expect(result.repeatedRead).toBe(true);
    expect(state.counters.repeatedReadWarnings).toBe(1);
    expect(result.warnings.some((w) => w.includes("already read") && w.includes("380"))).toBe(true);
  });

  test("repeated read warning increments on each subsequent read", () => {
    const state = createSessionState();
    recordRead(state, "src/auth.ts", 380, true);

    analyzePreRead("src/auth.ts", state, null);
    expect(state.counters.repeatedReadWarnings).toBe(1);

    analyzePreRead("src/auth.ts", state, null);
    expect(state.counters.repeatedReadWarnings).toBe(2);
  });

  test("file found in index returns description and tokens", () => {
    const state = createSessionState();
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));

    const result = analyzePreRead("src/auth.ts", state, index);

    expect(result.indexHit).toBe(true);
    expect(result.entry).not.toBeNull();
    expect(result.entry!.description).toBe("Auth middleware");
    expect(result.entry!.estimatedTokens).toBe(380);
    expect(result.warnings.some((w) => w.includes("Auth middleware") && w.includes("380"))).toBe(true);
  });

  test("file not found in index records miss", () => {
    const state = createSessionState();
    const index = createEmptyIndex();

    const result = analyzePreRead("src/new-feature.ts", state, index);

    expect(result.indexHit).toBe(false);
    expect(result.entry).toBeNull();
    expect(index.header.lifetimeMisses).toBe(1);
  });

  test("file index hit increments lifetimeHits", () => {
    const state = createSessionState();
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));

    analyzePreRead("src/auth.ts", state, index);

    expect(index.header.lifetimeHits).toBe(1);
  });

  test("null index is treated as miss without crash", () => {
    const state = createSessionState();

    const result = analyzePreRead("src/auth.ts", state, null);

    expect(result.indexHit).toBe(false);
    expect(result.entry).toBeNull();
    expect(result.warnings).toHaveLength(0);
  });

  test("repeated read + index hit emits both warnings", () => {
    const state = createSessionState();
    recordRead(state, "src/auth.ts", 380, true);

    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));

    const result = analyzePreRead("src/auth.ts", state, index);

    expect(result.repeatedRead).toBe(true);
    expect(result.indexHit).toBe(true);
    expect(result.warnings).toHaveLength(2);
  });

  test("different files do not trigger repeated read", () => {
    const state = createSessionState();
    recordRead(state, "src/auth.ts", 380, true);

    const result = analyzePreRead("src/config.ts", state, null);

    expect(result.repeatedRead).toBe(false);
    expect(state.counters.repeatedReadWarnings).toBe(0);
  });
});
