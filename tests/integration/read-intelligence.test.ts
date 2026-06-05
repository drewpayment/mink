import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { createSessionState } from "../../src/core/session";
import { createEmptyIndex, upsertEntry, indexAsLookup } from "../../src/core/index-store";
import { analyzePreRead } from "../../src/commands/pre-read";
import { analyzePostRead } from "../../src/commands/post-read";
import { recordRead } from "../../src/core/session";
import { isSessionState } from "../../src/core/session";
import type { SessionState } from "../../src/types/session";
import type { FileIndex, FileIndexEntry } from "../../src/types/file-index";

function makeEntry(filePath: string, description: string, estimatedTokens: number): FileIndexEntry {
  return {
    filePath,
    description,
    estimatedTokens,
    lastModified: new Date().toISOString(),
    lastIndexed: new Date().toISOString(),
  };
}

describe("read intelligence integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-read-intel-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("pre-read → post-read full sequence updates session state", () => {
    const sessionFile = join(dir, "session.json");
    const indexFile = join(dir, "file-index.json");

    // Setup
    const state = createSessionState();
    atomicWriteJson(sessionFile, state);

    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));
    atomicWriteJson(indexFile, index);

    // Simulate pre-read
    const loadedState = safeReadJson(sessionFile) as SessionState;
    const loadedIndex = safeReadJson(indexFile) as FileIndex;
    const preResult = analyzePreRead("src/auth.ts", loadedState, indexAsLookup(loadedIndex));

    expect(preResult.indexHit).toBe(true);
    expect(preResult.repeatedRead).toBe(false);
    expect(preResult.entry!.description).toBe("Auth middleware");

    // Save pre-read state changes
    atomicWriteJson(sessionFile, loadedState);
    atomicWriteJson(indexFile, loadedIndex);

    // Simulate post-read with actual content (2000 chars of code)
    const content = "const x = 1;\n".repeat(154); // ~2000 chars
    const postState = safeReadJson(sessionFile) as SessionState;
    const postIndex = safeReadJson(indexFile) as FileIndex;
    const postResult = analyzePostRead("src/auth.ts", content, indexAsLookup(postIndex));

    recordRead(postState, "src/auth.ts", postResult.estimatedTokens, postResult.indexHit);
    atomicWriteJson(sessionFile, postState);

    // Verify final state
    const finalState = safeReadJson(sessionFile) as SessionState;
    expect(finalState.reads["src/auth.ts"]).toBeDefined();
    expect(finalState.reads["src/auth.ts"].readCount).toBe(1);
    expect(finalState.reads["src/auth.ts"].estimatedTokens).toBeGreaterThan(0);
    expect(finalState.counters.fileIndexHits).toBe(1);

    // Verify session-level read counter still records the hit. Index-level
    // hit/miss is now persisted to the per-device counter file, not the
    // shared file-index header.
    const finalIndex = safeReadJson(indexFile) as FileIndex;
    expect(finalIndex.header.lifetimeHits).toBe(0);
  });

  test("multiple reads of different files accumulate correctly", () => {
    const state = createSessionState();
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));
    upsertEntry(index, makeEntry("src/config.ts", "App config", 200));

    // First file: pre-read + post-read
    analyzePreRead("src/auth.ts", state, indexAsLookup(index));
    const postResult1 = analyzePostRead("src/auth.ts", "a".repeat(1400), indexAsLookup(index));
    recordRead(state, "src/auth.ts", postResult1.estimatedTokens, postResult1.indexHit);

    // Second file: pre-read + post-read
    analyzePreRead("src/config.ts", state, indexAsLookup(index));
    const postResult2 = analyzePostRead("src/config.ts", "b".repeat(800), indexAsLookup(index));
    recordRead(state, "src/config.ts", postResult2.estimatedTokens, postResult2.indexHit);

    // Verify accumulation. Session counters still increment for hit telemetry;
    // the shared index header no longer carries hit counts.
    expect(Object.keys(state.reads)).toHaveLength(2);
    expect(state.reads["src/auth.ts"].readCount).toBe(1);
    expect(state.reads["src/config.ts"].readCount).toBe(1);
    expect(state.counters.fileIndexHits).toBe(2);
    expect(index.header.lifetimeHits).toBe(0);
  });

  test("repeated read of same file: warning emitted, readCount incremented", () => {
    const state = createSessionState();
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));

    // First read
    analyzePreRead("src/auth.ts", state, indexAsLookup(index));
    const post1 = analyzePostRead("src/auth.ts", "a".repeat(1400), indexAsLookup(index));
    recordRead(state, "src/auth.ts", post1.estimatedTokens, post1.indexHit);

    // Second read (repeated)
    const preResult2 = analyzePreRead("src/auth.ts", state, indexAsLookup(index));
    expect(preResult2.repeatedRead).toBe(true);
    expect(state.counters.repeatedReadWarnings).toBe(1);
    expect(preResult2.warnings.some((w) => w.includes("already read"))).toBe(true);

    const post2 = analyzePostRead("src/auth.ts", "a".repeat(1400), indexAsLookup(index));
    recordRead(state, "src/auth.ts", post2.estimatedTokens, post2.indexHit);

    expect(state.reads["src/auth.ts"].readCount).toBe(2);
  });

  test("missing session state is handled gracefully", () => {
    const sessionFile = join(dir, "session.json");

    // No session.json exists — load returns null
    const rawState = safeReadJson(sessionFile);
    expect(rawState).toBeNull();

    // Create fresh state as the hooks would
    const state = isSessionState(rawState) ? rawState : createSessionState();
    expect(state.sessionId).toBeDefined();
    expect(state.reads).toEqual({});

    // Pre-read works on fresh state
    const result = analyzePreRead("src/auth.ts", state, null);
    expect(result.repeatedRead).toBe(false);

    // Save it
    atomicWriteJson(sessionFile, state);
    const saved = safeReadJson(sessionFile) as SessionState;
    expect(isSessionState(saved)).toBe(true);
  });

  test("missing file index does not crash", () => {
    const state = createSessionState();

    // Null index simulates missing/corrupt file-index.json
    const result = analyzePreRead("src/auth.ts", state, null);

    expect(result.indexHit).toBe(false);
    expect(result.entry).toBeNull();
    // No crash, no warnings about the missing index
    expect(result.warnings).toHaveLength(0);
  });

  test("post-read falls back to index estimate when content unavailable", () => {
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/auth.ts", "Auth middleware", 380));

    const result = analyzePostRead("src/auth.ts", null, indexAsLookup(index));

    expect(result.estimatedTokens).toBe(380);
    expect(result.source).toBe("index-fallback");
    expect(result.indexHit).toBe(true);
  });

  test("performance: pre-read completes quickly on 500+ entry index", () => {
    const state = createSessionState();
    const index = createEmptyIndex();

    // Create 600 entries
    for (let i = 0; i < 600; i++) {
      upsertEntry(index, makeEntry(`src/file-${i}.ts`, `File ${i}`, 100 + i));
    }

    const start = performance.now();
    const result = analyzePreRead("src/file-300.ts", state, indexAsLookup(index));
    const elapsed = performance.now() - start;

    expect(result.indexHit).toBe(true);
    expect(elapsed).toBeLessThan(5000); // Well under 5 seconds
  });
});
