# Session Lifecycle — Implementation Design

## Summary

Spec 01 is the foundation of Mink. It manages ephemeral session state — created on session start, updated by read/write hooks, consumed at finalization. All state lives in flat JSON files under `~/.mink/projects/<slug>/`.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript | Natural for JSON state, easy to test, broad ecosystem |
| Runtime | Bun preferred, Node.js fallback | Bun's fast startup reduces hook latency; detected once at `mink init` |
| Package | npm package with `mink init` | Automates Claude Code hook wiring |
| State storage | Flat JSON files | Simple, debuggable, no dependencies. Hooks fire sequentially — no concurrency issue |
| State location | `~/.mink/projects/<slug>/` | No files in user's repo. Slug = basename + 6-char path hash |
| Crash safety | Atomic writes (temp + rename) | POSIX rename is atomic. Protects against partial writes |

## Project Structure

```
mink/
├── src/
│   ├── cli.ts                # Entry point, command routing
│   ├── commands/
│   │   ├── init.ts           # mink init — detect runtime, wire hooks
│   │   ├── session-start.ts  # Hook: session start
│   │   └── session-stop.ts   # Hook: session stop
│   ├── core/
│   │   ├── session.ts        # Session state CRUD
│   │   ├── paths.ts          # ~/.mink path resolution
│   │   ├── project-id.ts     # Slugified name + hash generation
│   │   └── fs-utils.ts       # Atomic write, safe read with error handling
│   └── types/
│       └── session.ts        # TypeScript interfaces
├── tests/
│   ├── unit/
│   │   ├── session.test.ts
│   │   ├── project-id.test.ts
│   │   ├── fs-utils.test.ts
│   │   └── session-stop.test.ts
│   └── integration/
│       └── lifecycle.test.ts
├── package.json
├── tsconfig.json
└── bunfig.toml
```

## State Directory Layout

```
~/.mink/
├── config.json                        # Global config (future)
├── projects/
│   └── my-project-a3f2b1/
│       ├── session.json               # Ephemeral (this spec)
│       ├── token-ledger.json          # Spec 04
│       ├── action-log.md              # Spec 08
│       ├── learning-memory.md         # Spec 03
│       ├── bug-memory.json            # Spec 07
│       └── file-index.json            # Spec 02
```

## Session State Schema

```typescript
interface SessionState {
  sessionId: string;            // "2026-04-10T14:32:07Z-a3f2"
  startTimestamp: string;       // ISO 8601 UTC
  stopCount: number;            // Times stop has fired

  reads: Record<string, FileRead>;  // Keyed by file path
  writes: WriteEntry[];             // Ordered list

  counters: {
    fileIndexHits: number;
    fileIndexMisses: number;
    repeatedReadWarnings: number;
    learnedRuleWarnings: number;
  };
}

interface FileRead {
  readCount: number;
  estimatedTokens: number;
  firstReadAt: string;          // ISO 8601 UTC
}

interface WriteEntry {
  filePath: string;
  action: "create" | "edit";
  estimatedTokens: number;
  timestamp: string;            // ISO 8601 UTC
}
```

### Session ID Format

ISO timestamp + 4-char random hex suffix: `2026-04-10T14:32:07Z-a3f2`. Readable, sortable, unique.

### Why Reads Are a Map

O(1) lookup for "have I read this file?" and easy `readCount` increment. The spec requires per-file read counts and repeated-read detection.

### Why Writes Are an Array

The spec says "ordered list" — insertion order matters for the action log timeline.

## Lifecycle Operations

### Session Start (`mink session-start`)

1. Resolve project ID from `cwd`
2. Ensure `~/.mink/projects/<slug>/` exists
3. Generate session ID
4. Write fresh `session.json` (overwrites any prior state)
5. Downstream stubs (later specs): append session header to action log, increment lifetime counter in token ledger

### Session Stop (`mink session-stop`)

1. Read `session.json` — if missing/corrupt, log warning and bail
2. Increment `stopCount`
3. If `stopCount === 1` and session has activity:
   - Build summary: read/write arrays, aggregate totals
   - Calculate savings: `(fileIndexHits × 200) + sum(repeated read tokens)`
   - Call token ledger stub: append session entry
   - Call action log stub: append summary line
4. If `stopCount > 1`: Update existing entry (no duplicate)
5. If zero activity: Skip ledger/log writes
6. Post-finalization checks (stubs):
   - Files edited 3+ times without bug log entry → emit reminder
   - Learning memory stale (>24h) → emit reminder
7. Write updated `session.json`

### Mid-Session Updates (functions, not commands)

Exposed for read/write hooks (specs 05/06) to call:

- `recordRead(filePath, estimatedTokens, indexHit)` — upsert into reads map, increment counters
- `recordWrite(filePath, action, estimatedTokens)` — append to writes array

### Downstream Interface

```typescript
interface SessionFinalizer {
  appendSession(summary: SessionSummary): void;
}
```

Ships with a no-op implementation. Specs 04 and 08 provide real implementations.

## Hook Integration

### `mink init`

1. Detect runtime (`bun` on PATH → bun, else node)
2. Resolve CLI entry point path
3. Merge hooks into `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "", "command": "bun run /path/to/mink/cli.js session-start" }
    ],
    "Stop": [
      { "matcher": "", "command": "bun run /path/to/mink/cli.js session-stop" }
    ]
  }
}
```

4. Create project state directory
5. Print confirmation

### Hook Event Mapping

| Claude Code Event | Mink Command | Spec |
|---|---|---|
| `SessionStart` | `mink session-start` | 01 |
| `Stop` | `mink session-stop` | 01 |
| `PreToolUse` (Read) | `mink on-read` | 05 |
| `PostToolUse` (Write/Edit) | `mink on-write` | 06 |

### Runtime Detection

```typescript
function detectRuntime(): "bun" | "node" {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return "bun";
  } catch {
    return "node";
  }
}
```

Decision is made once at init time, baked into hook commands. Re-run `mink init` to change.

## Error Handling

### Atomic Writes

All JSON writes: write to `<path>.tmp`, then `rename`. POSIX rename is atomic — if the process dies mid-write, only `.tmp` is corrupt.

### Corrupt/Missing Session State

At stop time: missing file → log warning, skip finalization. Invalid JSON → same. Wrong shape → type guard check, treat as corrupt. No crashes.

### Multiple Stop Events

`stopCount` field: first stop (0→1) does full finalization. Subsequent stops update the existing entry.

### Zero-Activity Sessions

Empty reads + empty writes → skip all ledger/log writes. `stopCount` still increments.

### Token Estimation

Session module records what callers pass in. It doesn't estimate tokens itself — that's the responsibility of the read/write hooks (specs 05/06).

## Testing Strategy

### Unit Tests

- Session ID generation: unique, timestamp-based, correct format
- State initialization: correct empty structure with zeroed counters
- `recordRead`: first read creates entry, subsequent reads increment count
- `recordWrite`: appends in order, correct shape
- Stop handler: aggregates reads/writes into summary, calculates savings correctly
- Savings formula: `(fileIndexHits × 200) + sum(repeatedReadTokens)`
- `stopCount` logic: first stop finalizes, subsequent stops update
- Corrupt state handling: graceful degradation, no crash
- Project ID generation: deterministic, collision-resistant

### Integration Tests

- Full lifecycle: start → record reads/writes → stop → verify session.json and stub calls
- Multiple stops: produce exactly one finalization (updated, not duplicated)

### Edge Tests

- Missing session.json at stop time
- Invalid JSON in session.json
- Zero-activity session produces no ledger entry
- Session start overwrites stale state from prior session
