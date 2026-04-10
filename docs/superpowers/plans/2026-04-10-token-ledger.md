# Token Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent token usage ledger that records lifetime counters and per-session details, implements the `SessionFinalizer` interface to replace the no-op stub, and archives old sessions beyond a configurable threshold.

**Architecture:** Single JSON file (`token-ledger.json`) with lifetime counters and a sessions array. A `createLedgerFinalizer(projectDir)` factory returns a `SessionFinalizer` that loads/saves the ledger atomically. Session-stop's default finalizer changes from no-op to the real ledger. Archiving moves oldest sessions to `token-ledger-archive.json` when the array exceeds a threshold.

**Tech Stack:** TypeScript, Bun (test runner + runtime), no external dependencies

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `src/types/token-ledger.ts` | Interfaces: LifetimeCounters, LedgerSession, TokenLedger |
| **Create:** `src/core/token-ledger.ts` | CRUD, append/update, archive, createLedgerFinalizer factory |
| **Modify:** `src/types/session.ts` | Add fileIndexHits/fileIndexMisses to SessionSummary.totals |
| **Modify:** `src/core/session.ts` | Update buildSummary to include fileIndexHits/fileIndexMisses |
| **Modify:** `src/core/paths.ts` | Add tokenLedgerPath, tokenLedgerArchivePath |
| **Modify:** `src/commands/session-stop.ts` | Replace noopFinalizer with createLedgerFinalizer |
| **Create:** `tests/unit/token-ledger.test.ts` | Unit tests for all ledger operations |
| **Modify:** `tests/unit/session.test.ts` | Update buildSummary tests for new totals fields |
| **Modify:** `tests/unit/session-stop.test.ts` | Tests for ledger integration |
| **Create:** `tests/integration/token-ledger.test.ts` | End-to-end lifecycle tests |

---

### Task 1: Types and SessionSummary Enhancement

**Files:**
- Create: `src/types/token-ledger.ts`
- Modify: `src/types/session.ts`
- Modify: `src/core/session.ts`
- Modify: `tests/unit/session.test.ts`

- [ ] **Step 1: Create the token ledger types file**

```typescript
// src/types/token-ledger.ts

export interface LifetimeCounters {
  totalTokens: number;
  totalReads: number;
  totalWrites: number;
  totalSessions: number;
  totalFileIndexHits: number;
  totalFileIndexMisses: number;
  totalRepeatedReads: number;
  totalEstimatedSavings: number;
}

export interface LedgerSession {
  sessionId: string;
  startTimestamp: string;
  endTimestamp: string;
  reads: Array<{
    filePath: string;
    estimatedTokens: number;
    readCount: number;
  }>;
  writes: Array<{
    filePath: string;
    estimatedTokens: number;
    action: "create" | "edit";
  }>;
  totals: {
    readCount: number;
    writeCount: number;
    estimatedTokens: number;
    repeatedReads: number;
    fileIndexHits: number;
    fileIndexMisses: number;
  };
  estimatedSavings: number;
}

export interface TokenLedger {
  lifetime: LifetimeCounters;
  sessions: LedgerSession[];
}
```

- [ ] **Step 2: Add `fileIndexHits` and `fileIndexMisses` to `SessionSummary.totals`**

In `src/types/session.ts`, update the `SessionSummary` interface's `totals` field:

```typescript
export interface SessionSummary {
  sessionId: string;
  startTimestamp: string;
  endTimestamp: string;
  reads: Array<{ filePath: string } & FileRead>;
  writes: WriteEntry[];
  totals: {
    readCount: number;
    writeCount: number;
    estimatedTokens: number;
    repeatedReads: number;
    fileIndexHits: number;
    fileIndexMisses: number;
  };
  estimatedSavings: number;
}
```

- [ ] **Step 3: Update `buildSummary` in `src/core/session.ts` to include the new fields**

In the `buildSummary` function, add the two new fields to the returned `totals` object:

```typescript
  return {
    sessionId: state.sessionId,
    startTimestamp: state.startTimestamp,
    endTimestamp: new Date().toISOString(),
    reads,
    writes: state.writes,
    totals: {
      readCount: Object.keys(state.reads).length,
      writeCount: state.writes.length,
      estimatedTokens: totalTokens,
      repeatedReads,
      fileIndexHits: state.counters.fileIndexHits,
      fileIndexMisses: state.counters.fileIndexMisses,
    },
    estimatedSavings: calculateSavings(state),
  };
```

- [ ] **Step 4: Update buildSummary tests**

In `tests/unit/session.test.ts`, update the existing `"builds correct summary from session state"` test to verify the new fields:

```typescript
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
    expect(summary.totals.fileIndexHits).toBe(1);
    expect(summary.totals.fileIndexMisses).toBe(1);
  });
```

Add a new test for the file index counter propagation:

```typescript
  test("includes file index counters in totals", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, true);
    recordRead(state, "/src/c.ts", 300, false);
    recordRead(state, "/src/d.ts", 400, false);
    recordRead(state, "/src/e.ts", 500, false);

    const summary = buildSummary(state);
    expect(summary.totals.fileIndexHits).toBe(2);
    expect(summary.totals.fileIndexMisses).toBe(3);
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/session.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/types/token-ledger.ts src/types/session.ts src/core/session.ts tests/unit/session.test.ts
git commit -m "feat(token-ledger): add types and enhance SessionSummary with index counters"
```

---

### Task 2: Token Ledger Core — Create, Load, Save, Type Guard

**Files:**
- Create: `src/core/token-ledger.ts`
- Create: `tests/unit/token-ledger.test.ts`
- Modify: `src/core/paths.ts`

- [ ] **Step 1: Add path helpers**

Add to `src/core/paths.ts`:

```typescript
export function tokenLedgerPath(cwd: string): string {
  return join(projectDir(cwd), "token-ledger.json");
}

export function tokenLedgerArchivePath(cwd: string): string {
  return join(projectDir(cwd), "token-ledger-archive.json");
}
```

- [ ] **Step 2: Write failing tests for create, load, save, type guard**

```typescript
// tests/unit/token-ledger.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import {
  createEmptyLedger,
  isTokenLedger,
  loadLedger,
  saveLedger,
} from "../../src/core/token-ledger";
import type { TokenLedger } from "../../src/types/token-ledger";

describe("token-ledger", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-ledger-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("createEmptyLedger", () => {
    test("returns ledger with zeroed lifetime counters", () => {
      const ledger = createEmptyLedger();
      expect(ledger.lifetime.totalTokens).toBe(0);
      expect(ledger.lifetime.totalReads).toBe(0);
      expect(ledger.lifetime.totalWrites).toBe(0);
      expect(ledger.lifetime.totalSessions).toBe(0);
      expect(ledger.lifetime.totalFileIndexHits).toBe(0);
      expect(ledger.lifetime.totalFileIndexMisses).toBe(0);
      expect(ledger.lifetime.totalRepeatedReads).toBe(0);
      expect(ledger.lifetime.totalEstimatedSavings).toBe(0);
    });

    test("returns empty sessions array", () => {
      const ledger = createEmptyLedger();
      expect(ledger.sessions).toEqual([]);
    });
  });

  describe("isTokenLedger", () => {
    test("returns true for valid ledger", () => {
      expect(isTokenLedger(createEmptyLedger())).toBe(true);
    });

    test("returns false for null", () => {
      expect(isTokenLedger(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isTokenLedger(undefined)).toBe(false);
    });

    test("returns false for object without lifetime", () => {
      expect(isTokenLedger({ sessions: [] })).toBe(false);
    });

    test("returns false for object without sessions array", () => {
      expect(isTokenLedger({ lifetime: {} })).toBe(false);
    });

    test("returns false for string", () => {
      expect(isTokenLedger("not a ledger")).toBe(false);
    });
  });

  describe("loadLedger", () => {
    test("returns empty ledger when file does not exist", () => {
      const ledger = loadLedger(join(dir, "nope.json"));
      expect(ledger.sessions).toEqual([]);
      expect(ledger.lifetime.totalSessions).toBe(0);
    });

    test("returns empty ledger when file is corrupt", () => {
      const filePath = join(dir, "token-ledger.json");
      writeFileSync(filePath, "not json {{{");
      const ledger = loadLedger(filePath);
      expect(ledger.sessions).toEqual([]);
    });

    test("loads valid ledger from file", () => {
      const filePath = join(dir, "token-ledger.json");
      const original = createEmptyLedger();
      original.lifetime.totalSessions = 5;
      atomicWriteJson(filePath, original);

      const loaded = loadLedger(filePath);
      expect(loaded.lifetime.totalSessions).toBe(5);
    });
  });

  describe("saveLedger", () => {
    test("writes ledger to file atomically", () => {
      const filePath = join(dir, "token-ledger.json");
      const ledger = createEmptyLedger();
      ledger.lifetime.totalSessions = 3;
      saveLedger(filePath, ledger);

      const loaded = safeReadJson(filePath) as TokenLedger;
      expect(loaded.lifetime.totalSessions).toBe(3);
    });

    test("creates parent directories", () => {
      const filePath = join(dir, "nested", "deep", "token-ledger.json");
      saveLedger(filePath, createEmptyLedger());
      const loaded = safeReadJson(filePath) as TokenLedger;
      expect(loaded.sessions).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement create, load, save, type guard**

```typescript
// src/core/token-ledger.ts
import { join } from "path";
import { atomicWriteJson, safeReadJson } from "./fs-utils";
import type {
  TokenLedger,
  LedgerSession,
  LifetimeCounters,
} from "../types/token-ledger";
import type { SessionSummary, SessionFinalizer } from "../types/session";

export function createEmptyLedger(): TokenLedger {
  return {
    lifetime: {
      totalTokens: 0,
      totalReads: 0,
      totalWrites: 0,
      totalSessions: 0,
      totalFileIndexHits: 0,
      totalFileIndexMisses: 0,
      totalRepeatedReads: 0,
      totalEstimatedSavings: 0,
    },
    sessions: [],
  };
}

export function isTokenLedger(value: unknown): value is TokenLedger {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.lifetime === "object" &&
    obj.lifetime !== null &&
    Array.isArray(obj.sessions)
  );
}

export function loadLedger(ledgerPath: string): TokenLedger {
  const raw = safeReadJson(ledgerPath);
  if (isTokenLedger(raw)) return raw;
  if (raw !== null) {
    console.error("[mink] token-ledger.json is corrupt — starting fresh");
  }
  return createEmptyLedger();
}

export function saveLedger(ledgerPath: string, ledger: TokenLedger): void {
  atomicWriteJson(ledgerPath, ledger);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/core/token-ledger.ts tests/unit/token-ledger.test.ts src/core/paths.ts
git commit -m "feat(token-ledger): add create, load, save, type guard, and path helpers"
```

---

### Task 3: Append Session

**Files:**
- Modify: `src/core/token-ledger.ts`
- Modify: `tests/unit/token-ledger.test.ts`

- [ ] **Step 1: Write failing tests for appendSession**

Add to `tests/unit/token-ledger.test.ts`:

```typescript
import {
  createEmptyLedger,
  isTokenLedger,
  loadLedger,
  saveLedger,
  appendSession,
  summaryToLedgerSession,
} from "../../src/core/token-ledger";
import type { SessionSummary } from "../../src/types/session";

function makeSummary(overrides?: Partial<SessionSummary>): SessionSummary {
  return {
    sessionId: "2026-04-10T12:00:00.000Z-ab12",
    startTimestamp: "2026-04-10T12:00:00.000Z",
    endTimestamp: "2026-04-10T13:00:00.000Z",
    reads: [
      { filePath: "/src/a.ts", readCount: 1, estimatedTokens: 100, firstReadAt: "2026-04-10T12:00:00.000Z" },
      { filePath: "/src/b.ts", readCount: 2, estimatedTokens: 200, firstReadAt: "2026-04-10T12:01:00.000Z" },
    ],
    writes: [
      { filePath: "/src/c.ts", action: "create" as const, estimatedTokens: 300, timestamp: "2026-04-10T12:02:00.000Z" },
    ],
    totals: {
      readCount: 2,
      writeCount: 1,
      estimatedTokens: 600,
      repeatedReads: 1,
      fileIndexHits: 1,
      fileIndexMisses: 1,
    },
    estimatedSavings: 400,
    ...overrides,
  };
}

// Add inside the describe("token-ledger") block:

  describe("summaryToLedgerSession", () => {
    test("transforms SessionSummary to LedgerSession", () => {
      const summary = makeSummary();
      const session = summaryToLedgerSession(summary);

      expect(session.sessionId).toBe(summary.sessionId);
      expect(session.startTimestamp).toBe(summary.startTimestamp);
      expect(session.endTimestamp).toBe(summary.endTimestamp);
      expect(session.reads).toHaveLength(2);
      expect(session.reads[0]).toEqual({
        filePath: "/src/a.ts",
        estimatedTokens: 100,
        readCount: 1,
      });
      expect(session.writes).toHaveLength(1);
      expect(session.writes[0]).toEqual({
        filePath: "/src/c.ts",
        estimatedTokens: 300,
        action: "create",
      });
      expect(session.totals).toEqual(summary.totals);
      expect(session.estimatedSavings).toBe(400);
    });
  });

  describe("appendSession", () => {
    test("appends session to empty ledger", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary());

      expect(ledger.sessions).toHaveLength(1);
      expect(ledger.sessions[0].sessionId).toBe("2026-04-10T12:00:00.000Z-ab12");
    });

    test("increments lifetime counters correctly", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary());

      expect(ledger.lifetime.totalSessions).toBe(1);
      expect(ledger.lifetime.totalTokens).toBe(600);
      expect(ledger.lifetime.totalReads).toBe(2);
      expect(ledger.lifetime.totalWrites).toBe(1);
      expect(ledger.lifetime.totalFileIndexHits).toBe(1);
      expect(ledger.lifetime.totalFileIndexMisses).toBe(1);
      expect(ledger.lifetime.totalRepeatedReads).toBe(1);
      expect(ledger.lifetime.totalEstimatedSavings).toBe(400);
    });

    test("accumulates across multiple appends", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "session-1" }));
      appendSession(ledger, makeSummary({ sessionId: "session-2" }));

      expect(ledger.sessions).toHaveLength(2);
      expect(ledger.lifetime.totalSessions).toBe(2);
      expect(ledger.lifetime.totalTokens).toBe(1200);
      expect(ledger.lifetime.totalReads).toBe(4);
    });

    test("does not modify existing sessions (append-only)", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "session-1", estimatedSavings: 100 }));
      const firstSession = { ...ledger.sessions[0] };

      appendSession(ledger, makeSummary({ sessionId: "session-2", estimatedSavings: 200 }));

      expect(ledger.sessions[0].sessionId).toBe(firstSession.sessionId);
      expect(ledger.sessions[0].estimatedSavings).toBe(firstSession.estimatedSavings);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: FAIL — `appendSession` not found

- [ ] **Step 3: Implement summaryToLedgerSession and appendSession**

Add to `src/core/token-ledger.ts`:

```typescript
export function summaryToLedgerSession(summary: SessionSummary): LedgerSession {
  return {
    sessionId: summary.sessionId,
    startTimestamp: summary.startTimestamp,
    endTimestamp: summary.endTimestamp,
    reads: summary.reads.map((r) => ({
      filePath: r.filePath,
      estimatedTokens: r.estimatedTokens,
      readCount: r.readCount,
    })),
    writes: summary.writes.map((w) => ({
      filePath: w.filePath,
      estimatedTokens: w.estimatedTokens,
      action: w.action,
    })),
    totals: { ...summary.totals },
    estimatedSavings: summary.estimatedSavings,
  };
}

function addToLifetime(lifetime: LifetimeCounters, session: LedgerSession): void {
  lifetime.totalTokens += session.totals.estimatedTokens;
  lifetime.totalReads += session.totals.readCount;
  lifetime.totalWrites += session.totals.writeCount;
  lifetime.totalFileIndexHits += session.totals.fileIndexHits;
  lifetime.totalFileIndexMisses += session.totals.fileIndexMisses;
  lifetime.totalRepeatedReads += session.totals.repeatedReads;
  lifetime.totalEstimatedSavings += session.estimatedSavings;
}

export function appendSession(ledger: TokenLedger, summary: SessionSummary): void {
  const session = summaryToLedgerSession(summary);
  ledger.sessions.push(session);
  ledger.lifetime.totalSessions++;
  addToLifetime(ledger.lifetime, session);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/token-ledger.ts tests/unit/token-ledger.test.ts
git commit -m "feat(token-ledger): add appendSession with lifetime counter accumulation"
```

---

### Task 4: Update Session

**Files:**
- Modify: `src/core/token-ledger.ts`
- Modify: `tests/unit/token-ledger.test.ts`

- [ ] **Step 1: Write failing tests for updateSession**

Add to `tests/unit/token-ledger.test.ts` (import `updateSession`):

```typescript
  describe("updateSession", () => {
    test("replaces existing session record", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "s1", estimatedSavings: 100 }));

      const updated = makeSummary({
        sessionId: "s1",
        estimatedSavings: 300,
        totals: {
          readCount: 5,
          writeCount: 3,
          estimatedTokens: 1000,
          repeatedReads: 2,
          fileIndexHits: 3,
          fileIndexMisses: 2,
        },
      });
      updateSession(ledger, updated);

      expect(ledger.sessions).toHaveLength(1);
      expect(ledger.sessions[0].estimatedSavings).toBe(300);
    });

    test("adjusts lifetime counters by delta", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({
        sessionId: "s1",
        totals: {
          readCount: 2, writeCount: 1, estimatedTokens: 600,
          repeatedReads: 1, fileIndexHits: 1, fileIndexMisses: 1,
        },
        estimatedSavings: 400,
      }));

      // Update with more activity
      updateSession(ledger, makeSummary({
        sessionId: "s1",
        totals: {
          readCount: 5, writeCount: 3, estimatedTokens: 1200,
          repeatedReads: 3, fileIndexHits: 4, fileIndexMisses: 1,
        },
        estimatedSavings: 800,
      }));

      // Lifetime should reflect the delta: original values + (new - old)
      expect(ledger.lifetime.totalReads).toBe(5);
      expect(ledger.lifetime.totalWrites).toBe(3);
      expect(ledger.lifetime.totalTokens).toBe(1200);
      expect(ledger.lifetime.totalRepeatedReads).toBe(3);
      expect(ledger.lifetime.totalFileIndexHits).toBe(4);
      expect(ledger.lifetime.totalEstimatedSavings).toBe(800);
    });

    test("falls back to appendSession when session not found", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "s1" }));

      updateSession(ledger, makeSummary({ sessionId: "unknown-session" }));

      expect(ledger.sessions).toHaveLength(2);
      expect(ledger.lifetime.totalSessions).toBe(2);
    });

    test("preserves other sessions when updating one", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "s1", estimatedSavings: 100 }));
      appendSession(ledger, makeSummary({ sessionId: "s2", estimatedSavings: 200 }));

      updateSession(ledger, makeSummary({ sessionId: "s2", estimatedSavings: 500 }));

      expect(ledger.sessions[0].sessionId).toBe("s1");
      expect(ledger.sessions[0].estimatedSavings).toBe(100);
      expect(ledger.sessions[1].estimatedSavings).toBe(500);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: FAIL — `updateSession` not found

- [ ] **Step 3: Implement updateSession**

Add to `src/core/token-ledger.ts`:

```typescript
function subtractFromLifetime(lifetime: LifetimeCounters, session: LedgerSession): void {
  lifetime.totalTokens -= session.totals.estimatedTokens;
  lifetime.totalReads -= session.totals.readCount;
  lifetime.totalWrites -= session.totals.writeCount;
  lifetime.totalFileIndexHits -= session.totals.fileIndexHits;
  lifetime.totalFileIndexMisses -= session.totals.fileIndexMisses;
  lifetime.totalRepeatedReads -= session.totals.repeatedReads;
  lifetime.totalEstimatedSavings -= session.estimatedSavings;
}

export function updateSession(ledger: TokenLedger, summary: SessionSummary): void {
  const index = ledger.sessions.findIndex((s) => s.sessionId === summary.sessionId);
  if (index === -1) {
    // Session not found — fall back to append
    appendSession(ledger, summary);
    return;
  }

  const oldSession = ledger.sessions[index];
  const newSession = summaryToLedgerSession(summary);

  // Adjust lifetime: subtract old, add new
  subtractFromLifetime(ledger.lifetime, oldSession);
  addToLifetime(ledger.lifetime, newSession);

  // Replace the session record
  ledger.sessions[index] = newSession;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/token-ledger.ts tests/unit/token-ledger.test.ts
git commit -m "feat(token-ledger): add updateSession with delta-based lifetime adjustment"
```

---

### Task 5: Archive

**Files:**
- Modify: `src/core/token-ledger.ts`
- Modify: `tests/unit/token-ledger.test.ts`

- [ ] **Step 1: Write failing tests for archiveIfNeeded and saveArchive**

Add to `tests/unit/token-ledger.test.ts` (import `archiveIfNeeded`, `loadArchive`, `saveArchive`):

```typescript
  describe("archiveIfNeeded", () => {
    test("no-ops when sessions under threshold", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "s1" }));
      appendSession(ledger, makeSummary({ sessionId: "s2" }));

      const { archived } = archiveIfNeeded(ledger, 5);
      expect(archived).toHaveLength(0);
      expect(ledger.sessions).toHaveLength(2);
    });

    test("archives oldest sessions when over threshold", () => {
      const ledger = createEmptyLedger();
      for (let i = 0; i < 5; i++) {
        appendSession(ledger, makeSummary({ sessionId: `s${i}` }));
      }

      const { archived } = archiveIfNeeded(ledger, 3);
      expect(archived).toHaveLength(2);
      expect(archived[0].sessionId).toBe("s0");
      expect(archived[1].sessionId).toBe("s1");
      expect(ledger.sessions).toHaveLength(3);
      expect(ledger.sessions[0].sessionId).toBe("s2");
    });

    test("does not adjust lifetime counters", () => {
      const ledger = createEmptyLedger();
      for (let i = 0; i < 5; i++) {
        appendSession(ledger, makeSummary({ sessionId: `s${i}` }));
      }
      const lifetimeBefore = { ...ledger.lifetime };

      archiveIfNeeded(ledger, 3);

      expect(ledger.lifetime.totalSessions).toBe(lifetimeBefore.totalSessions);
      expect(ledger.lifetime.totalTokens).toBe(lifetimeBefore.totalTokens);
    });

    test("no-ops when threshold is 0", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "s1" }));

      const { archived } = archiveIfNeeded(ledger, 0);
      expect(archived).toHaveLength(0);
      expect(ledger.sessions).toHaveLength(1);
    });

    test("no-ops when threshold is negative", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "s1" }));

      const { archived } = archiveIfNeeded(ledger, -1);
      expect(archived).toHaveLength(0);
    });

    test("archives exactly to threshold", () => {
      const ledger = createEmptyLedger();
      for (let i = 0; i < 5; i++) {
        appendSession(ledger, makeSummary({ sessionId: `s${i}` }));
      }

      const { archived } = archiveIfNeeded(ledger, 5);
      expect(archived).toHaveLength(0);
      expect(ledger.sessions).toHaveLength(5);
    });
  });

  describe("saveArchive / loadArchive", () => {
    test("saves and loads archived sessions", () => {
      const archivePath = join(dir, "token-ledger-archive.json");
      const sessions: LedgerSession[] = [
        summaryToLedgerSession(makeSummary({ sessionId: "old-1" })),
        summaryToLedgerSession(makeSummary({ sessionId: "old-2" })),
      ];

      saveArchive(archivePath, sessions);

      const loaded = loadArchive(archivePath);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].sessionId).toBe("old-1");
    });

    test("prepends to existing archive", () => {
      const archivePath = join(dir, "token-ledger-archive.json");

      // First archive
      saveArchive(archivePath, [
        summaryToLedgerSession(makeSummary({ sessionId: "batch-1" })),
      ]);

      // Second archive — prepends
      saveArchive(archivePath, [
        summaryToLedgerSession(makeSummary({ sessionId: "batch-2" })),
      ]);

      const loaded = loadArchive(archivePath);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].sessionId).toBe("batch-2");
      expect(loaded[1].sessionId).toBe("batch-1");
    });

    test("returns empty array for missing archive file", () => {
      const loaded = loadArchive(join(dir, "nope.json"));
      expect(loaded).toEqual([]);
    });

    test("returns empty array for corrupt archive file", () => {
      const archivePath = join(dir, "token-ledger-archive.json");
      writeFileSync(archivePath, "not json {{{");
      const loaded = loadArchive(archivePath);
      expect(loaded).toEqual([]);
    });
  });
```

Import `LedgerSession` from `../../src/types/token-ledger`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: FAIL — `archiveIfNeeded` not found

- [ ] **Step 3: Implement archive functions**

Add to `src/core/token-ledger.ts`:

```typescript
const DEFAULT_ARCHIVE_THRESHOLD = 1000;

export function archiveIfNeeded(
  ledger: TokenLedger,
  threshold: number = DEFAULT_ARCHIVE_THRESHOLD
): { archived: LedgerSession[] } {
  if (threshold <= 0 || ledger.sessions.length <= threshold) {
    return { archived: [] };
  }

  const toArchive = ledger.sessions.length - threshold;
  const archived = ledger.sessions.splice(0, toArchive);
  // Lifetime counters are NOT adjusted — they're cumulative forever
  return { archived };
}

export function loadArchive(archivePath: string): LedgerSession[] {
  const raw = safeReadJson(archivePath);
  if (Array.isArray(raw)) return raw;
  if (raw !== null) {
    console.error("[mink] token-ledger-archive.json is corrupt — starting fresh");
  }
  return [];
}

export function saveArchive(
  archivePath: string,
  newlyArchived: LedgerSession[]
): void {
  const existing = loadArchive(archivePath);
  const combined = [...newlyArchived, ...existing];
  atomicWriteJson(archivePath, combined);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/token-ledger.ts tests/unit/token-ledger.test.ts
git commit -m "feat(token-ledger): add archiving with configurable threshold"
```

---

### Task 6: Ledger Finalizer Factory

**Files:**
- Modify: `src/core/token-ledger.ts`
- Modify: `tests/unit/token-ledger.test.ts`

- [ ] **Step 1: Write failing tests for createLedgerFinalizer**

Add to `tests/unit/token-ledger.test.ts` (import `createLedgerFinalizer`):

```typescript
  describe("createLedgerFinalizer", () => {
    test("appendSession creates ledger and writes session", () => {
      const finalizer = createLedgerFinalizer(dir);
      finalizer.appendSession(makeSummary({ sessionId: "s1" }));

      const ledger = loadLedger(join(dir, "token-ledger.json"));
      expect(ledger.sessions).toHaveLength(1);
      expect(ledger.sessions[0].sessionId).toBe("s1");
      expect(ledger.lifetime.totalSessions).toBe(1);
    });

    test("updateSession replaces session and adjusts counters", () => {
      const finalizer = createLedgerFinalizer(dir);
      finalizer.appendSession(makeSummary({
        sessionId: "s1",
        estimatedSavings: 100,
      }));

      finalizer.updateSession(makeSummary({
        sessionId: "s1",
        estimatedSavings: 500,
      }));

      const ledger = loadLedger(join(dir, "token-ledger.json"));
      expect(ledger.sessions).toHaveLength(1);
      expect(ledger.sessions[0].estimatedSavings).toBe(500);
      expect(ledger.lifetime.totalEstimatedSavings).toBe(500);
    });

    test("archives sessions when threshold exceeded", () => {
      const finalizer = createLedgerFinalizer(dir, 3);

      for (let i = 0; i < 5; i++) {
        finalizer.appendSession(makeSummary({ sessionId: `s${i}` }));
      }

      const ledger = loadLedger(join(dir, "token-ledger.json"));
      expect(ledger.sessions).toHaveLength(3);
      expect(ledger.sessions[0].sessionId).toBe("s2");

      const archived = loadArchive(join(dir, "token-ledger-archive.json"));
      expect(archived).toHaveLength(2);
      expect(archived[0].sessionId).toBe("s3"); // most recently archived first
    });

    test("multiple appends accumulate correctly", () => {
      const finalizer = createLedgerFinalizer(dir);
      finalizer.appendSession(makeSummary({ sessionId: "s1" }));
      finalizer.appendSession(makeSummary({ sessionId: "s2" }));

      const ledger = loadLedger(join(dir, "token-ledger.json"));
      expect(ledger.lifetime.totalSessions).toBe(2);
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: FAIL — `createLedgerFinalizer` not found

- [ ] **Step 3: Implement createLedgerFinalizer**

Add to `src/core/token-ledger.ts`:

```typescript
export function createLedgerFinalizer(
  projectDir: string,
  archiveThreshold: number = DEFAULT_ARCHIVE_THRESHOLD
): SessionFinalizer {
  const ledgerFile = join(projectDir, "token-ledger.json");
  const archiveFile = join(projectDir, "token-ledger-archive.json");

  return {
    appendSession(summary: SessionSummary): void {
      const ledger = loadLedger(ledgerFile);
      appendSession(ledger, summary);
      const { archived } = archiveIfNeeded(ledger, archiveThreshold);
      saveLedger(ledgerFile, ledger);
      if (archived.length > 0) {
        saveArchive(archiveFile, archived);
      }
    },
    updateSession(summary: SessionSummary): void {
      const ledger = loadLedger(ledgerFile);
      updateSession(ledger, summary);
      saveLedger(ledgerFile, ledger);
      // No archiving on update — only on append
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/token-ledger.ts tests/unit/token-ledger.test.ts
git commit -m "feat(token-ledger): add createLedgerFinalizer factory"
```

---

### Task 7: Session-Stop Integration

**Files:**
- Modify: `src/commands/session-stop.ts`
- Modify: `tests/unit/session-stop.test.ts`

- [ ] **Step 1: Write failing test for ledger integration**

Add to `tests/unit/session-stop.test.ts`:

```typescript
  test("writes to token ledger by default", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, false);
    recordWrite(state, "/src/c.ts", "create", 300);
    const sessionFile = setupSession(dir, state);

    // Call without explicit finalizer — should use ledger
    sessionStop(sessionFile);

    // Verify ledger was created
    const ledgerPath = join(dir, "token-ledger.json");
    const ledger = safeReadJson(ledgerPath) as TokenLedger;
    expect(ledger).not.toBeNull();
    expect(ledger.sessions).toHaveLength(1);
    expect(ledger.lifetime.totalSessions).toBe(1);
    expect(ledger.lifetime.totalReads).toBe(2);
    expect(ledger.lifetime.totalWrites).toBe(1);
    expect(ledger.lifetime.totalTokens).toBe(600);
  });

  test("updates ledger on second stop", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    // First stop
    sessionStop(sessionFile);

    // Simulate more activity and second stop
    const updatedState = safeReadJson(sessionFile) as SessionState;
    recordRead(updatedState, "/src/b.ts", 200, false);
    atomicWriteJson(sessionFile, updatedState);

    sessionStop(sessionFile);

    const ledgerPath = join(dir, "token-ledger.json");
    const ledger = safeReadJson(ledgerPath) as TokenLedger;
    expect(ledger.sessions).toHaveLength(1); // same session, updated
    expect(ledger.lifetime.totalReads).toBe(2); // updated to reflect new state
  });
```

Import `TokenLedger` from `../../src/types/token-ledger` at the top of the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/session-stop.test.ts`
Expected: FAIL — ledger not created (still using noopFinalizer)

- [ ] **Step 3: Update session-stop.ts to use ledger finalizer as default**

Replace the `noopFinalizer` usage in `src/commands/session-stop.ts`:

```typescript
import { statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { isSessionState, buildSummary } from "../core/session";
import { reflect } from "./reflect";
import { createLedgerFinalizer } from "../core/token-ledger";
import type { SessionState, SessionFinalizer } from "../types/session";

function hasActivity(state: SessionState): boolean {
  return Object.keys(state.reads).length > 0 || state.writes.length > 0;
}

function getEditCounts(state: SessionState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const write of state.writes) {
    counts[write.filePath] = (counts[write.filePath] || 0) + 1;
  }
  return counts;
}

function isLearningMemoryStale(memoryPath: string): boolean {
  try {
    const stat = statSync(memoryPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return ageMs > twentyFourHours;
  } catch {
    return false;
  }
}

export function sessionStop(
  sessionFile: string,
  finalizer?: SessionFinalizer,
  onReminder: (msg: string) => void = (msg) => console.error(msg)
): void {
  const raw = safeReadJson(sessionFile);
  if (!isSessionState(raw)) {
    if (raw !== null) {
      console.error("[mink] session.json is corrupt — skipping finalization");
    }
    return;
  }

  const state: SessionState = raw;
  state.stopCount++;

  const projDir = dirname(sessionFile);
  const effectiveFinalizer = finalizer ?? createLedgerFinalizer(projDir);

  if (hasActivity(state)) {
    const summary = buildSummary(state);

    if (state.stopCount === 1) {
      effectiveFinalizer.appendSession(summary);
    } else {
      effectiveFinalizer.updateSession(summary);
    }
  }

  // Check for files edited 3+ times
  const editCounts = getEditCounts(state);
  for (const [filePath, count] of Object.entries(editCounts)) {
    if (count >= 3) {
      onReminder(
        `[mink] ${filePath} was edited ${count} times — consider logging a bug`
      );
    }
  }

  // Run reflection to merge duplicates and prune oversized memory
  const memoryPath = join(projDir, "learning-memory.md");
  const cfgPath = join(projDir, "config.json");
  if (existsSync(memoryPath)) {
    reflect(projDir, memoryPath, cfgPath);
  }

  // Check if learning memory is stale (>24h since last update)
  if (isLearningMemoryStale(memoryPath)) {
    onReminder(
      "[mink] learning memory hasn't been updated in 24+ hours — consider reviewing it"
    );
  }

  atomicWriteJson(sessionFile, state);
}
```

Key changes:
- Import `createLedgerFinalizer`
- Remove `noopFinalizer` constant
- Change `finalizer` param to optional (`finalizer?: SessionFinalizer`)
- Create `effectiveFinalizer` using `finalizer ?? createLedgerFinalizer(projDir)`
- Move `projDir` declaration before the finalizer creation

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/session-stop.test.ts`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: All PASS (existing tests that inject mock finalizers should still work)

- [ ] **Step 6: Commit**

```bash
git add src/commands/session-stop.ts tests/unit/session-stop.test.ts
git commit -m "feat(token-ledger): replace noopFinalizer with real ledger in session-stop"
```

---

### Task 8: Property Tests and Lifetime Invariants

**Files:**
- Modify: `tests/unit/token-ledger.test.ts`

- [ ] **Step 1: Add property tests**

Add to `tests/unit/token-ledger.test.ts`:

```typescript
  describe("properties", () => {
    test("lifetime counters equal sum of session values after N appends", () => {
      const ledger = createEmptyLedger();
      const summaries = [
        makeSummary({
          sessionId: "s1",
          totals: { readCount: 3, writeCount: 1, estimatedTokens: 500, repeatedReads: 1, fileIndexHits: 2, fileIndexMisses: 1 },
          estimatedSavings: 500,
        }),
        makeSummary({
          sessionId: "s2",
          totals: { readCount: 7, writeCount: 4, estimatedTokens: 1200, repeatedReads: 3, fileIndexHits: 5, fileIndexMisses: 2 },
          estimatedSavings: 1400,
        }),
        makeSummary({
          sessionId: "s3",
          totals: { readCount: 2, writeCount: 0, estimatedTokens: 200, repeatedReads: 0, fileIndexHits: 1, fileIndexMisses: 1 },
          estimatedSavings: 200,
        }),
      ];

      for (const s of summaries) {
        appendSession(ledger, s);
      }

      // Verify lifetime = sum of sessions
      const sessionTotals = ledger.sessions.reduce(
        (acc, s) => ({
          tokens: acc.tokens + s.totals.estimatedTokens,
          reads: acc.reads + s.totals.readCount,
          writes: acc.writes + s.totals.writeCount,
          repeated: acc.repeated + s.totals.repeatedReads,
          hits: acc.hits + s.totals.fileIndexHits,
          misses: acc.misses + s.totals.fileIndexMisses,
          savings: acc.savings + s.estimatedSavings,
        }),
        { tokens: 0, reads: 0, writes: 0, repeated: 0, hits: 0, misses: 0, savings: 0 }
      );

      expect(ledger.lifetime.totalTokens).toBe(sessionTotals.tokens);
      expect(ledger.lifetime.totalReads).toBe(sessionTotals.reads);
      expect(ledger.lifetime.totalWrites).toBe(sessionTotals.writes);
      expect(ledger.lifetime.totalRepeatedReads).toBe(sessionTotals.repeated);
      expect(ledger.lifetime.totalFileIndexHits).toBe(sessionTotals.hits);
      expect(ledger.lifetime.totalFileIndexMisses).toBe(sessionTotals.misses);
      expect(ledger.lifetime.totalEstimatedSavings).toBe(sessionTotals.savings);
    });

    test("lifetime counters remain correct after update", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({
        sessionId: "s1",
        totals: { readCount: 3, writeCount: 1, estimatedTokens: 500, repeatedReads: 1, fileIndexHits: 2, fileIndexMisses: 1 },
        estimatedSavings: 500,
      }));
      appendSession(ledger, makeSummary({
        sessionId: "s2",
        totals: { readCount: 2, writeCount: 2, estimatedTokens: 400, repeatedReads: 0, fileIndexHits: 1, fileIndexMisses: 1 },
        estimatedSavings: 200,
      }));

      // Update s1 with new values
      updateSession(ledger, makeSummary({
        sessionId: "s1",
        totals: { readCount: 10, writeCount: 5, estimatedTokens: 2000, repeatedReads: 4, fileIndexHits: 8, fileIndexMisses: 2 },
        estimatedSavings: 1800,
      }));

      // Lifetime should equal s1_updated + s2
      expect(ledger.lifetime.totalReads).toBe(10 + 2);
      expect(ledger.lifetime.totalWrites).toBe(5 + 2);
      expect(ledger.lifetime.totalTokens).toBe(2000 + 400);
      expect(ledger.lifetime.totalEstimatedSavings).toBe(1800 + 200);
    });

    test("sessions array is strictly append-only", () => {
      const ledger = createEmptyLedger();
      appendSession(ledger, makeSummary({ sessionId: "s1" }));
      const s1Snapshot = JSON.stringify(ledger.sessions[0]);

      appendSession(ledger, makeSummary({ sessionId: "s2" }));
      expect(JSON.stringify(ledger.sessions[0])).toBe(s1Snapshot);

      appendSession(ledger, makeSummary({ sessionId: "s3" }));
      expect(JSON.stringify(ledger.sessions[0])).toBe(s1Snapshot);
      expect(ledger.sessions).toHaveLength(3);
    });
  });
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test tests/unit/token-ledger.test.ts`
Expected: All PASS

- [ ] **Step 3: Commit**

```bash
git add tests/unit/token-ledger.test.ts
git commit -m "test(token-ledger): add property tests for lifetime invariants"
```

---

### Task 9: Integration Tests

**Files:**
- Create: `tests/integration/token-ledger.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// tests/integration/token-ledger.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import {
  createSessionState,
  recordRead,
  recordWrite,
} from "../../src/core/session";
import { sessionStop } from "../../src/commands/session-stop";
import { loadLedger, loadArchive } from "../../src/core/token-ledger";
import type { SessionState } from "../../src/types/session";
import type { TokenLedger } from "../../src/types/token-ledger";

function setupSession(dir: string, state: SessionState): string {
  const sessionFile = join(dir, "session.json");
  atomicWriteJson(sessionFile, state);
  return sessionFile;
}

describe("token-ledger integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-ledger-int-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("full lifecycle: session-start → activity → session-stop → ledger", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, false);
    recordRead(state, "/src/a.ts", 100, true); // repeated
    recordWrite(state, "/src/c.ts", "create", 300);
    recordWrite(state, "/src/d.ts", "edit", 150);
    const sessionFile = setupSession(dir, state);

    sessionStop(sessionFile);

    const ledger = loadLedger(join(dir, "token-ledger.json"));
    expect(ledger.lifetime.totalSessions).toBe(1);
    expect(ledger.lifetime.totalReads).toBe(2); // 2 unique files
    expect(ledger.lifetime.totalWrites).toBe(2);
    expect(ledger.lifetime.totalFileIndexHits).toBe(2); // 2 hits (both reads of a.ts)
    expect(ledger.lifetime.totalFileIndexMisses).toBe(1);
    expect(ledger.lifetime.totalRepeatedReads).toBe(1); // a.ts read twice
    expect(ledger.lifetime.totalEstimatedSavings).toBeGreaterThan(0);
  });

  test("multiple sessions produce sequential records", () => {
    // Session 1
    const state1 = createSessionState();
    recordRead(state1, "/src/a.ts", 100, true);
    const file1 = setupSession(dir, state1);
    sessionStop(file1);

    // Session 2
    const state2 = createSessionState();
    recordRead(state2, "/src/b.ts", 200, false);
    recordWrite(state2, "/src/b.ts", "edit", 200);
    const file2 = setupSession(dir, state2);
    sessionStop(file2);

    const ledger = loadLedger(join(dir, "token-ledger.json"));
    expect(ledger.sessions).toHaveLength(2);
    expect(ledger.lifetime.totalSessions).toBe(2);
    expect(ledger.lifetime.totalReads).toBe(2);
    expect(ledger.lifetime.totalWrites).toBe(1);
  });

  test("first-ever session creates ledger from scratch", () => {
    const ledgerPath = join(dir, "token-ledger.json");
    expect(existsSync(ledgerPath)).toBe(false);

    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);
    sessionStop(sessionFile);

    expect(existsSync(ledgerPath)).toBe(true);
    const ledger = loadLedger(ledgerPath);
    expect(ledger.sessions).toHaveLength(1);
  });

  test("update session on second stop reflects new activity", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    // First stop
    sessionStop(sessionFile);

    let ledger = loadLedger(join(dir, "token-ledger.json"));
    expect(ledger.lifetime.totalReads).toBe(1);

    // More activity
    const updated = safeReadJson(sessionFile) as SessionState;
    recordRead(updated, "/src/b.ts", 200, false);
    recordWrite(updated, "/src/c.ts", "create", 300);
    atomicWriteJson(sessionFile, updated);

    // Second stop
    sessionStop(sessionFile);

    ledger = loadLedger(join(dir, "token-ledger.json"));
    expect(ledger.sessions).toHaveLength(1); // same session, updated
    expect(ledger.lifetime.totalReads).toBe(2); // reflects final state
    expect(ledger.lifetime.totalWrites).toBe(1);
  });

  test("archive triggers at low threshold via finalizer", () => {
    // Use createLedgerFinalizer directly with low threshold
    const { createLedgerFinalizer } = require("../../src/core/token-ledger");
    const finalizer = createLedgerFinalizer(dir, 2);

    for (let i = 0; i < 4; i++) {
      const state = createSessionState();
      recordRead(state, `/src/${i}.ts`, 100, true);
      const sessionFile = setupSession(dir, state);
      // Use the custom finalizer
      sessionStop(sessionFile, finalizer);
    }

    const ledger = loadLedger(join(dir, "token-ledger.json"));
    expect(ledger.sessions).toHaveLength(2);
    expect(ledger.lifetime.totalSessions).toBe(4);

    const archived = loadArchive(join(dir, "token-ledger-archive.json"));
    expect(archived.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bun test tests/integration/token-ledger.test.ts`
Expected: All PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All PASS across all files

- [ ] **Step 4: Commit**

```bash
git add tests/integration/token-ledger.test.ts
git commit -m "test(token-ledger): add integration tests for full session lifecycle"
```

---

### Task 10: E2E Smoke Test

**Files:** None (manual verification)

- [ ] **Step 1: Run a session lifecycle**

```bash
cd /tmp && mkdir smoke-ledger && cd smoke-ledger
echo '{}' > package.json
bun /Users/drewpayment/dev/mink/src/cli.ts init
bun /Users/drewpayment/dev/mink/src/cli.ts session-start
bun /Users/drewpayment/dev/mink/src/cli.ts session-stop
```

- [ ] **Step 2: Verify ledger was created**

```bash
cat ~/.mink/projects/smoke-ledger-*/token-ledger.json | head -20
```

Expected: JSON with `lifetime` object showing `totalSessions: 1` and a `sessions` array with one entry.

- [ ] **Step 3: Run a second session**

```bash
bun /Users/drewpayment/dev/mink/src/cli.ts session-start
bun /Users/drewpayment/dev/mink/src/cli.ts session-stop
```

- [ ] **Step 4: Verify accumulation**

```bash
cat ~/.mink/projects/smoke-ledger-*/token-ledger.json | head -5
```

Expected: `totalSessions: 2`

- [ ] **Step 5: Clean up**

```bash
rm -rf /tmp/smoke-ledger ~/.mink/projects/smoke-ledger-*
```

---

## Self-Review

**Spec coverage check:**

| Spec Requirement | Task |
|-----------------|------|
| Lifetime counters (8 fields) | Task 1 (types), Task 3 (appendSession increments) |
| Per-session records (reads, writes, totals) | Task 1 (types), Task 3 (summaryToLedgerSession) |
| Savings estimation formula | Already in session.ts (calculateSavings), propagated via SessionSummary |
| Append-only session records | Task 3 (appendSession), Task 8 (property test) |
| Lifetime counters updated atomically with append | Task 3 (appendSession), Task 6 (finalizer saves atomically) |
| Crash-safe writes (temp + rename) | Task 2 (saveLedger uses atomicWriteJson) |
| First session creates ledger | Task 2 (loadLedger returns empty), Task 9 (integration test) |
| Corrupt ledger recovery | Task 2 (loadLedger), Task 5 (loadArchive) |
| 1000+ sessions archiving | Task 5 (archiveIfNeeded) |
| SessionSummary.totals includes fileIndexHits/Misses | Task 1 (enhancement) |
| SessionFinalizer replaces noop | Task 7 (session-stop integration) |
| updateSession replaces record with delta | Task 4 |
| Lifetime = sum of sessions property | Task 8 (property tests) |

**Placeholder scan:** No TBD, TODO, or vague instructions.

**Type consistency:** `TokenLedger`, `LedgerSession`, `LifetimeCounters` used consistently. `summaryToLedgerSession` signature and usage match. `createLedgerFinalizer(projectDir, threshold?)` consistent across Task 6 and Task 7.
