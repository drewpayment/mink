import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import {
  createSessionState,
  recordRead,
  recordWrite,
} from "../../src/core/session";
import { sessionStop } from "../../src/commands/session-stop";
import { getOrCreateDeviceId } from "../../src/core/device";
import type { SessionState, SessionSummary } from "../../src/types/session";
import type { TokenLedger } from "../../src/types/token-ledger";

// Helper: write session state to a temp dir and return paths
function setupSession(dir: string, state: SessionState) {
  const sessionFile = join(dir, "session.json");
  atomicWriteJson(sessionFile, state);
  return sessionFile;
}

// session-stop writes the ledger to this device's shard under projDir/state/<id>/.
function shardLedgerPath(dir: string): string {
  return join(dir, "state", getOrCreateDeviceId(), "token-ledger.json");
}

describe("sessionStop", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("increments stopCount on first stop", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    sessionStop(sessionFile);

    const updated = safeReadJson(sessionFile) as SessionState;
    expect(updated.stopCount).toBe(1);
  });

  test("calls finalizer on first stop with activity", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    let captured: SessionSummary | null = null;
    const finalizer = {
      appendSession(summary: SessionSummary) {
        captured = summary;
      },
      updateSession() {},
    };

    sessionStop(sessionFile, finalizer);

    expect(captured).not.toBeNull();
    expect(captured!.totals.readCount).toBe(1);
  });

  test("calls updateSession on second stop", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    state.stopCount = 1; // simulate first stop already happened
    const sessionFile = setupSession(dir, state);

    let updateCalled = false;
    const finalizer = {
      appendSession() {},
      updateSession() {
        updateCalled = true;
      },
    };

    sessionStop(sessionFile, finalizer);

    expect(updateCalled).toBe(true);
    const updated = safeReadJson(sessionFile) as SessionState;
    expect(updated.stopCount).toBe(2);
  });

  test("skips finalization on zero activity", () => {
    const state = createSessionState();
    const sessionFile = setupSession(dir, state);

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
    const updated = safeReadJson(sessionFile) as SessionState;
    expect(updated.stopCount).toBe(1);
  });

  test("handles missing session file gracefully", () => {
    const sessionFile = join(dir, "nope.json");
    // Should not throw
    expect(() => sessionStop(sessionFile)).not.toThrow();
  });

  test("handles corrupt session file gracefully", () => {
    const sessionFile = join(dir, "session.json");
    writeFileSync(sessionFile, "not json {{{");
    expect(() => sessionStop(sessionFile)).not.toThrow();
  });

  test("emits reminder for files edited 3+ times", () => {
    const state = createSessionState();
    recordWrite(state, "/src/a.ts", "edit", 100);
    recordWrite(state, "/src/a.ts", "edit", 100);
    recordWrite(state, "/src/a.ts", "edit", 100);
    const sessionFile = setupSession(dir, state);

    const reminders: string[] = [];
    sessionStop(sessionFile, undefined, (msg: string) => reminders.push(msg));

    expect(reminders.length).toBeGreaterThanOrEqual(1);
    expect(reminders[0]).toContain("/src/a.ts");
    expect(reminders[0]).toContain("3");
  });

  test("emits reminder when learning memory is stale", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    // Create a stale learning-memory.md (mtime > 24h ago)
    const memoryPath = join(dir, "learning-memory.md");
    writeFileSync(memoryPath, "# Learning Memory");
    const past = Date.now() - 25 * 60 * 60 * 1000;
    utimesSync(memoryPath, new Date(past), new Date(past));

    const reminders: string[] = [];
    sessionStop(sessionFile, undefined, (msg: string) => reminders.push(msg));

    expect(reminders.some((r) => r.includes("learning memory"))).toBe(true);
  });

  test("does not emit learning memory reminder when recently updated", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    // Create a fresh learning-memory.md
    const memoryPath = join(dir, "learning-memory.md");
    writeFileSync(memoryPath, "# Learning Memory");

    const reminders: string[] = [];
    sessionStop(sessionFile, undefined, (msg: string) => reminders.push(msg));

    expect(reminders.some((r) => r.includes("learning memory"))).toBe(false);
  });

  test("writes to token ledger by default", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, false);
    recordWrite(state, "/src/c.ts", "create", 300);
    const sessionFile = setupSession(dir, state);

    sessionStop(sessionFile);

    const ledger = safeReadJson(shardLedgerPath(dir)) as any;
    expect(ledger).not.toBeNull();
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.lifetime.totalSessions).toBe(1);
    expect(ledger.lifetime.totalReads).toBe(2);
    expect(ledger.lifetime.totalWrites).toBe(1);
  });

  test("updates ledger on second stop", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    sessionStop(sessionFile);

    // More activity and second stop
    const updated = safeReadJson(sessionFile) as SessionState;
    recordRead(updated, "/src/b.ts", 200, false);
    atomicWriteJson(sessionFile, updated);

    sessionStop(sessionFile);

    const ledger = safeReadJson(shardLedgerPath(dir)) as any;
    expect(ledger.sessions).toHaveLength(1); // same session, updated
    expect(ledger.lifetime.totalReads).toBe(2);
  });

  test("calls reflect on session stop", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    // Create a learning memory with duplicates
    const memPath = join(dir, "learning-memory.md");
    writeFileSync(
      memPath,
      [
        "# Learning Memory — test",
        "",
        "## User Preferences",
        "",
        "- Duplicate",
        "- Duplicate",
        "",
        "## Key Learnings",
        "",
        "## Do-Not-Repeat",
        "",
        "## Decision Log",
        "",
      ].join("\n")
    );

    sessionStop(sessionFile);

    // Verify duplicates were merged
    const saved = readFileSync(memPath, "utf-8");
    const occurrences = saved.split("- Duplicate").length - 1;
    expect(occurrences).toBe(1);
  });
});
