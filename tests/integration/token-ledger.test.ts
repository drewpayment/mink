import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { createSessionState, recordRead, recordWrite, buildSummary } from "../../src/core/session";
import { sessionStop } from "../../src/commands/session-stop";
import {
  createLedgerFinalizer,
  loadLedger,
  loadArchive,
} from "../../src/core/token-ledger";
import { getOrCreateDeviceId } from "../../src/core/device";
import type { SessionState } from "../../src/types/session";

describe("token ledger integration", () => {
  let dir: string;

  // sessionStop now writes the ledger to projDir/state/<deviceId>/token-ledger.json.
  function ledgerPathFor(d: string): string {
    return join(d, "state", getOrCreateDeviceId(), "token-ledger.json");
  }

  function archivePathFor(d: string): string {
    return join(d, "state", getOrCreateDeviceId(), "token-ledger-archive.json");
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-ledger-integ-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("full lifecycle: session-start → activity → session-stop → ledger", () => {
    const sessionFile = join(dir, "session.json");
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, false);
    recordWrite(state, "/src/c.ts", "create", 300);
    atomicWriteJson(sessionFile, state);

    sessionStop(sessionFile);

    const ledgerPath = ledgerPathFor(dir);
    expect(existsSync(ledgerPath)).toBe(true);

    const ledger = loadLedger(ledgerPath);
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.sessions[0].totals.readCount).toBe(2);
    expect(ledger.sessions[0].totals.writeCount).toBe(1);
    expect(ledger.lifetime.totalSessions).toBe(1);
    expect(ledger.lifetime.totalReads).toBe(2);
    expect(ledger.lifetime.totalWrites).toBe(1);
  });

  test("multiple sessions produce sequential records", () => {
    const sessionFile1 = join(dir, "session1.json");
    const state1 = createSessionState();
    recordRead(state1, "/src/a.ts", 100, true);
    atomicWriteJson(sessionFile1, state1);
    sessionStop(sessionFile1);

    const sessionFile2 = join(dir, "session2.json");
    const state2 = createSessionState();
    recordRead(state2, "/src/x.ts", 50, false);
    recordWrite(state2, "/src/y.ts", "edit", 75);
    atomicWriteJson(sessionFile2, state2);
    sessionStop(sessionFile2);

    const ledgerPath = ledgerPathFor(dir);
    const ledger = loadLedger(ledgerPath);

    expect(ledger.sessions).toHaveLength(2);
    expect(ledger.lifetime.totalSessions).toBe(2);
    expect(ledger.lifetime.totalReads).toBe(2);
    expect(ledger.lifetime.totalWrites).toBe(1);
  });

  test("first-ever session creates ledger from scratch", () => {
    const ledgerPath = ledgerPathFor(dir);
    expect(existsSync(ledgerPath)).toBe(false);

    const sessionFile = join(dir, "session.json");
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    atomicWriteJson(sessionFile, state);

    sessionStop(sessionFile);

    expect(existsSync(ledgerPath)).toBe(true);
    const ledger = loadLedger(ledgerPath);
    expect(ledger.sessions).toHaveLength(1);
  });

  test("update session on second stop reflects new activity", () => {
    const sessionFile = join(dir, "session.json");
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    atomicWriteJson(sessionFile, state);

    // First stop
    sessionStop(sessionFile);

    // Add more activity to same session
    const updated = safeReadJson(sessionFile) as SessionState;
    recordRead(updated, "/src/b.ts", 200, false);
    recordWrite(updated, "/src/c.ts", "edit", 150);
    atomicWriteJson(sessionFile, updated);

    // Second stop
    sessionStop(sessionFile);

    const ledgerPath = ledgerPathFor(dir);
    const ledger = loadLedger(ledgerPath);

    // Same session ID, so only one record
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.lifetime.totalSessions).toBe(1);
    expect(ledger.lifetime.totalReads).toBe(2);
    expect(ledger.lifetime.totalWrites).toBe(1);
  });

  test("archive triggers at low threshold (legacy non-sharded path)", () => {
    // Pass `(dir, threshold)` (no deviceId) to exercise the legacy code path.
    const finalizer = createLedgerFinalizer(dir, 2);

    // Append 4 sessions via the finalizer directly
    for (let i = 0; i < 4; i++) {
      const state = createSessionState();
      recordRead(state, `/src/file-${i}.ts`, 100, true);
      state.stopCount = 1;
      const summary = buildSummary(state);
      // Override sessionId so each is unique
      (summary as any).sessionId = `archive-sess-${i}`;
      finalizer.appendSession(summary);
    }

    const ledgerPath = join(dir, "token-ledger.json");
    const archivePath = join(dir, "token-ledger-archive.json");

    const ledger = loadLedger(ledgerPath);
    expect(ledger.sessions).toHaveLength(2);

    expect(existsSync(archivePath)).toBe(true);
    const archived = loadArchive(archivePath);
    expect(archived.length).toBeGreaterThanOrEqual(2);
  });
});
