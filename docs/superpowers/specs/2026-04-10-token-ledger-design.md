# Token Ledger — Implementation Design

## Summary

Spec 04 builds a persistent record of all token usage across sessions. It stores lifetime aggregate counters, per-session detail arrays, and enables savings calculations. The ledger implements the existing `SessionFinalizer` interface — replacing the no-op stub — so that session-stop automatically records usage data. An archiving threshold moves old sessions to a separate file to keep the active ledger performant.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage | Single flat file (`token-ledger.json`) | Follows existing patterns (`file-index.json`), simple, atomic writes protect against corruption |
| updateSession behavior | Replace last session record, adjust lifetime via delta | Sessions evolve across multiple stop events; ledger should reflect final state |
| Archiving | Built-in threshold (default 1000), archive oldest on append | Prevents unbounded growth without deferring to a future spec |
| Lifetime counter updates | Delta from old vs new session record | O(1) computation, correct even after archiving |
| Finalizer construction | Standalone module with `createLedgerFinalizer()` factory | Clean separation, testable in isolation |

## Module Structure

```
src/
├── core/
│   └── token-ledger.ts       # CRUD, archive, createLedgerFinalizer factory
├── types/
│   └── token-ledger.ts       # TokenLedger, LedgerSession, LifetimeCounters
├── commands/
│   └── session-stop.ts       # (modified) use createLedgerFinalizer as default
```

State files:

```
~/.mink/projects/<slug>/
├── token-ledger.json          # Active ledger (lifetime + recent sessions)
├── token-ledger-archive.json  # Archived old sessions
```

## Data Schema

### TokenLedger (`token-ledger.json`)

```typescript
interface LifetimeCounters {
  totalTokens: number;
  totalReads: number;
  totalWrites: number;
  totalSessions: number;
  totalFileIndexHits: number;
  totalFileIndexMisses: number;
  totalRepeatedReads: number;
  totalEstimatedSavings: number;
}

interface LedgerSession {
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

interface TokenLedger {
  lifetime: LifetimeCounters;
  sessions: LedgerSession[];
}
```

Key points:
- `LedgerSession` maps from `SessionSummary` — reads/writes arrays are direct copies, totals include `fileIndexHits`/`fileIndexMisses`.
- `LifetimeCounters` aggregates across all sessions (including archived ones — counters are never decremented).
- Sessions are ordered chronologically. Archiving removes from the front of the array.

## SessionSummary Enhancement

The current `SessionSummary.totals` is missing `fileIndexHits` and `fileIndexMisses`. These live on `SessionState.counters` but don't pass through to the summary. Add them:

```typescript
// Updated SessionSummary.totals
totals: {
  readCount: number;
  writeCount: number;
  estimatedTokens: number;
  repeatedReads: number;
  fileIndexHits: number;      // NEW
  fileIndexMisses: number;    // NEW
};
```

Update `buildSummary()` in `session.ts` to populate them from `state.counters`.

## Operations

### `createEmptyLedger(): TokenLedger`

Fresh ledger with zeroed `LifetimeCounters` and empty `sessions` array.

### `isTokenLedger(value): value is TokenLedger`

Type guard. Checks for `lifetime` object and `sessions` array.

### `loadLedger(ledgerPath): TokenLedger`

Read and parse. If missing or corrupt, return fresh empty ledger (log warning on corrupt).

### `saveLedger(ledgerPath, ledger): void`

Atomic write via `atomicWriteJson`.

### `appendSession(ledger, summary): void`

1. Transform `SessionSummary` into `LedgerSession`.
2. Push to `sessions` array.
3. Add session totals to lifetime counters.
4. Increment `lifetime.totalSessions`.
5. Add `summary.estimatedSavings` to `lifetime.totalEstimatedSavings`.

### `updateSession(ledger, summary): void`

1. Find existing `LedgerSession` by `sessionId`.
2. If not found: fall back to `appendSession`.
3. Calculate delta: new totals minus old totals for each counter.
4. Apply delta to lifetime counters.
5. Replace the session record with the new one.

### `archiveIfNeeded(ledger, threshold?): { ledger: TokenLedger, archived: LedgerSession[] }`

1. If `sessions.length <= threshold` (default 1000): return empty `archived` array.
2. Calculate how many to archive: `sessions.length - threshold`.
3. Splice oldest sessions from the front of the array.
4. Return the archived sessions. Lifetime counters are NOT adjusted (cumulative forever).

### `calculateLifetimeSavings(ledger): number`

Returns `ledger.lifetime.totalEstimatedSavings`.

### `createLedgerFinalizer(projectDir): SessionFinalizer`

Factory that returns `{ appendSession, updateSession }` closures:

```typescript
function createLedgerFinalizer(projectDir: string): SessionFinalizer {
  const ledgerFile = join(projectDir, "token-ledger.json");
  const archiveFile = join(projectDir, "token-ledger-archive.json");

  return {
    appendSession(summary) {
      const ledger = loadLedger(ledgerFile);
      appendSession(ledger, summary);
      const { archived } = archiveIfNeeded(ledger);
      saveLedger(ledgerFile, ledger);
      if (archived.length > 0) {
        saveArchive(archiveFile, archived);
      }
    },
    updateSession(summary) {
      const ledger = loadLedger(ledgerFile);
      updateSession(ledger, summary);
      saveLedger(ledgerFile, ledger);
      // No archiving on update — only on append
    },
  };
}
```

### `saveArchive(archivePath, newlyArchived): void`

Load existing archive (or empty array), prepend newly archived sessions, save atomically.

## `paths.ts` Extension

```typescript
export function tokenLedgerPath(cwd: string): string {
  return join(projectDir(cwd), "token-ledger.json");
}

export function tokenLedgerArchivePath(cwd: string): string {
  return join(projectDir(cwd), "token-ledger-archive.json");
}
```

## Session-Stop Integration

Replace the default `noopFinalizer` with the real ledger finalizer:

```typescript
// session-stop.ts
import { createLedgerFinalizer } from "../core/token-ledger";

export function sessionStop(
  sessionFile: string,
  finalizer?: SessionFinalizer,
  onReminder?: (msg: string) => void
): void {
  // ...existing logic...
  const projDir = dirname(sessionFile);
  const effectiveFinalizer = finalizer ?? createLedgerFinalizer(projDir);
  // Use effectiveFinalizer instead of noopFinalizer
}
```

Tests can still inject a mock finalizer. The default is now the real ledger.

## Error Handling

- **Missing ledger file** — `loadLedger` returns fresh empty ledger. First `appendSession` creates it.
- **Corrupt ledger file** — Return fresh empty ledger, log warning. Lifetime counters reset.
- **Session not found in updateSession** — Fall back to `appendSession`.
- **Empty session (no activity)** — Session-stop already skips finalization. Ledger never sees zero-activity sessions.
- **Archive file missing** — Create with archived sessions array.
- **Archive file corrupt** — Start fresh array, log warning.
- **Zero-token reads** — Recorded but contribute 0 to savings.
- **Concurrent writes** — Atomic write via `atomicWriteJson`.
- **Threshold ≤ 0** — No archiving, keep all sessions.

## Testing Strategy

### Unit Tests

- **`token-ledger.ts`** — createEmptyLedger, isTokenLedger (valid/invalid inputs), appendSession (counters increment correctly), updateSession (delta applied, fallback to append on missing session), archiveIfNeeded (threshold behavior, no archiving when under, correct oldest removed), calculateLifetimeSavings.
- **Property: lifetime counters equal sum of session values** — After N appends, verify each lifetime counter equals the sum across all session records.
- **Property: sessions array is append-only** — Verify existing sessions are not modified by new appends.

### Integration Tests

- Full lifecycle: session-start → activity → session-stop → verify ledger has correct session record and lifetime counters.
- Multiple sessions: three sessions with varying activity → verify sequential records, accumulating counters.
- Update session: first stop then second stop on same session → verify record replaced, counters adjusted.
- Archive threshold: set threshold to 3, append 5 sessions → verify 2 archived, 3 remain.

### Edge Tests

- First-ever session creates ledger from scratch.
- Corrupt ledger triggers fresh start with warning.
- Session not found in updateSession falls back to append.
- Archive file missing on first archive creates it.
