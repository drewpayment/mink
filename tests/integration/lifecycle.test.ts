import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { createSessionState, recordRead, recordWrite } from "../../src/core/session";
import { sessionStop } from "../../src/commands/session-stop";
import type { SessionState, SessionSummary } from "../../src/types/session";

describe("full session lifecycle", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-lifecycle-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("start → reads → writes → stop produces correct summary", () => {
    const sessionFile = join(dir, "session.json");

    // Simulate session start
    const state = createSessionState();
    atomicWriteJson(sessionFile, state);

    // Simulate hook calls mid-session
    const loaded = safeReadJson(sessionFile) as SessionState;
    recordRead(loaded, "/src/app.ts", 150, true);
    recordRead(loaded, "/src/config.ts", 200, false);
    recordRead(loaded, "/src/app.ts", 150, true); // repeated read
    recordWrite(loaded, "/src/app.ts", "edit", 300);
    recordWrite(loaded, "/src/utils.ts", "create", 100);
    atomicWriteJson(sessionFile, loaded);

    // Simulate session stop
    let captured: SessionSummary | null = null;
    const finalizer = {
      appendSession(summary: SessionSummary) {
        captured = summary;
      },
      updateSession() {},
    };

    sessionStop(sessionFile, finalizer);

    // Verify summary
    expect(captured).not.toBeNull();
    expect(captured!.totals.readCount).toBe(2); // 2 unique files
    expect(captured!.totals.writeCount).toBe(2);
    expect(captured!.totals.repeatedReads).toBe(1); // app.ts read twice
    expect(captured!.totals.estimatedTokens).toBe(750); // 150+200+300+100
    // Savings: 2 index hits × 200 + 1 repeated read × 150 = 550
    // fileIndexHits counts each call where indexHit=true, not per unique file
    expect(captured!.estimatedSavings).toBe(550);

    // Verify session.json updated
    const final = safeReadJson(sessionFile) as SessionState;
    expect(final.stopCount).toBe(1);
  });

  test("multiple stops do not duplicate finalization", () => {
    const sessionFile = join(dir, "session.json");
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    atomicWriteJson(sessionFile, state);

    let appendCount = 0;
    let updateCount = 0;
    const finalizer = {
      appendSession() {
        appendCount++;
      },
      updateSession() {
        updateCount++;
      },
    };

    sessionStop(sessionFile, finalizer);
    sessionStop(sessionFile, finalizer);
    sessionStop(sessionFile, finalizer);

    expect(appendCount).toBe(1);
    expect(updateCount).toBe(2);

    const final = safeReadJson(sessionFile) as SessionState;
    expect(final.stopCount).toBe(3);
  });

  test("zero-activity session skips finalization", () => {
    const sessionFile = join(dir, "session.json");
    const state = createSessionState();
    atomicWriteJson(sessionFile, state);

    let finalizerCalled = false;
    const finalizer = {
      appendSession() {
        finalizerCalled = true;
      },
      updateSession() {
        finalizerCalled = true;
      },
    };

    sessionStop(sessionFile, finalizer);
    expect(finalizerCalled).toBe(false);
  });

  test("session start overwrites stale state", () => {
    const sessionFile = join(dir, "session.json");

    // Write stale state
    const stale = createSessionState();
    recordRead(stale, "/old/file.ts", 500, true);
    stale.stopCount = 5;
    atomicWriteJson(sessionFile, stale);

    // Overwrite with fresh state
    const fresh = createSessionState();
    atomicWriteJson(sessionFile, fresh);

    const loaded = safeReadJson(sessionFile) as SessionState;
    expect(loaded.stopCount).toBe(0);
    expect(Object.keys(loaded.reads)).toHaveLength(0);
    expect(loaded.writes).toHaveLength(0);
  });
});
