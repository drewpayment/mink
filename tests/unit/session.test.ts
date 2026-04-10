import { describe, expect, test } from "bun:test";
import {
  createSessionState,
  recordRead,
  recordWrite,
  buildSummary,
  calculateSavings,
  isSessionState,
} from "../../src/core/session";
import type { SessionState } from "../../src/types/session";

describe("createSessionState", () => {
  test("generates a session ID with ISO timestamp and hex suffix", () => {
    const state = createSessionState();
    // Format: YYYY-MM-DDTHH:MM:SS.sssZ-<4 hex>
    expect(state.sessionId).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z-[a-f0-9]{4}$/
    );
  });

  test("starts with zeroed counters and empty collections", () => {
    const state = createSessionState();
    expect(state.stopCount).toBe(0);
    expect(state.reads).toEqual({});
    expect(state.writes).toEqual([]);
    expect(state.counters).toEqual({
      fileIndexHits: 0,
      fileIndexMisses: 0,
      repeatedReadWarnings: 0,
      learnedRuleWarnings: 0,
    });
  });

  test("generates unique IDs on successive calls", () => {
    const a = createSessionState();
    const b = createSessionState();
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe("recordRead", () => {
  test("creates new entry on first read", () => {
    const state = createSessionState();
    recordRead(state, "/src/app.ts", 150, true);
    expect(state.reads["/src/app.ts"]).toBeDefined();
    expect(state.reads["/src/app.ts"].readCount).toBe(1);
    expect(state.reads["/src/app.ts"].estimatedTokens).toBe(150);
    expect(state.counters.fileIndexHits).toBe(1);
  });

  test("increments readCount on repeated read", () => {
    const state = createSessionState();
    recordRead(state, "/src/app.ts", 150, true);
    recordRead(state, "/src/app.ts", 150, true);
    expect(state.reads["/src/app.ts"].readCount).toBe(2);
  });

  test("tracks index misses", () => {
    const state = createSessionState();
    recordRead(state, "/src/app.ts", 150, false);
    expect(state.counters.fileIndexHits).toBe(0);
    expect(state.counters.fileIndexMisses).toBe(1);
  });

  test("preserves firstReadAt on repeated reads", () => {
    const state = createSessionState();
    recordRead(state, "/src/app.ts", 150, true);
    const firstReadAt = state.reads["/src/app.ts"].firstReadAt;
    recordRead(state, "/src/app.ts", 150, true);
    expect(state.reads["/src/app.ts"].firstReadAt).toBe(firstReadAt);
  });
});

describe("recordWrite", () => {
  test("appends write entry", () => {
    const state = createSessionState();
    recordWrite(state, "/src/app.ts", "edit", 200);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].filePath).toBe("/src/app.ts");
    expect(state.writes[0].action).toBe("edit");
    expect(state.writes[0].estimatedTokens).toBe(200);
  });

  test("preserves insertion order", () => {
    const state = createSessionState();
    recordWrite(state, "/src/a.ts", "create", 100);
    recordWrite(state, "/src/b.ts", "edit", 200);
    recordWrite(state, "/src/c.ts", "edit", 300);
    expect(state.writes.map((w) => w.filePath)).toEqual([
      "/src/a.ts",
      "/src/b.ts",
      "/src/c.ts",
    ]);
  });
});

describe("calculateSavings", () => {
  test("returns 0 for empty session", () => {
    const state = createSessionState();
    expect(calculateSavings(state)).toBe(0);
  });

  test("counts 200 per file index hit", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, true);
    recordRead(state, "/src/c.ts", 300, false);
    // 2 hits × 200 = 400
    expect(calculateSavings(state)).toBe(400);
  });

  test("adds repeated read token costs", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/a.ts", 100, true); // repeated, 100 tokens saved
    recordRead(state, "/src/a.ts", 100, true); // repeated again, another 100
    // 1 hit × 200 + 2 repeated × 100 = 400
    // Note: index hit counted once per unique file, not per read
    // Wait — fileIndexHits increments per call (3 times), not per unique file
    // So: 3 hits × 200 + 2 repeated × 100 = 800
    expect(calculateSavings(state)).toBe(800);
  });
});

describe("buildSummary", () => {
  test("builds correct summary from session state", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, false);
    recordWrite(state, "/src/c.ts", "create", 300);

    const summary = buildSummary(state);
    expect(summary.sessionId).toBe(state.sessionId);
    expect(summary.reads).toHaveLength(2);
    expect(summary.writes).toHaveLength(1);
    expect(summary.totals.readCount).toBe(2);
    expect(summary.totals.writeCount).toBe(1);
    expect(summary.totals.estimatedTokens).toBe(600);
    expect(summary.totals.repeatedReads).toBe(0);
  });

  test("counts repeated reads in totals", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/a.ts", 100, true);
    const summary = buildSummary(state);
    expect(summary.totals.repeatedReads).toBe(1);
  });
});

describe("isSessionState", () => {
  test("returns true for valid session state", () => {
    const state = createSessionState();
    expect(isSessionState(state)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isSessionState(null)).toBe(false);
  });

  test("returns false for object with missing fields", () => {
    expect(isSessionState({ sessionId: "x" })).toBe(false);
  });
});
