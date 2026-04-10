# 08 — Action Log

## Overview

The action log is a chronological, append-only record of every significant action taken during AI sessions. It provides a human-readable history of what happened, when, and at what token cost. The log is structured as timestamped tables, one per session, and is periodically consolidated to prevent unbounded growth.

## Capabilities

### Session Entries

Each session in the action log must contain:

1. A session header with the session date and time.
2. A structured table with columns: Time, Action, File(s), Outcome, ~Tokens.
3. A session start row when the session begins.
4. A row for each file read (with file index hit/miss status and token estimate).
5. A row for each file write/edit (with description of what changed and token estimate).
6. A session end summary row with: total writes, files touched, and total estimated tokens.

### Append-Only Writes

- New entries are appended to the end of the log file.
- Existing entries are never modified by hooks (only by the consolidation process).
- Each append must handle concurrent access safely (hooks should not corrupt the file if they fire in quick succession).

### Consolidation

When the action log grows beyond a configurable threshold (default: 200 entries or 7 days of history), the system must:

1. Identify sessions older than the retention threshold.
2. Compress each old session into a single summary line containing: session date, total reads, total writes, total tokens, and key files touched.
3. Preserve full detail for recent sessions.
4. Full historical data remains available in the token ledger — consolidation only affects the action log's human-readable file.

### Readability

The action log must be:

- Human-readable without tooling — standard markdown tables.
- Scannable — most recent sessions at the bottom.
- Useful for the AI assistant — it can read the log to understand what happened in recent sessions without requiring the full token ledger.

## Acceptance Criteria

```
GIVEN a new session starts
WHEN the session-start hook fires
THEN a session header and empty table template are appended to the action log

GIVEN the AI reads "src/config.ts" during a session
WHEN the post-read updates the action log
THEN a row appears with: timestamp, "Read", "src/config.ts", index hit/miss status, token estimate

GIVEN the AI edits "src/server.ts" during a session
WHEN the post-write updates the action log
THEN a row appears with: timestamp, "Edit", "src/server.ts", brief outcome description, token estimate

GIVEN a session completes with 3 reads and 2 writes totaling ~2400 tokens
WHEN the session stop event fires
THEN a summary row is appended: "Session end: 2 writes across 2 files | ~2400 tok total"

GIVEN the action log contains 250 entries spanning 10 days
WHEN the consolidation task runs with 7-day retention
THEN sessions older than 7 days are compressed to single summary lines
AND sessions within the last 7 days retain full detail

GIVEN two hooks fire in rapid succession (back-to-back writes)
WHEN both attempt to append to the action log
THEN both entries appear in the log without corruption
```

## Edge Cases

- Action log file doesn't exist — create it with a header on first write.
- Action log file is locked or inaccessible — retry once, then skip with a warning.
- Consolidation runs but all sessions are within retention window — no changes made.
- Very long file paths in log entries — truncate display to last 60 characters with leading ellipsis.
- Session with zero activity — only header and summary row, no action rows.

## Test Requirements

- Unit: Session header formatting with correct timestamp.
- Unit: Action row formatting for reads and writes.
- Unit: Summary row calculation from session data.
- Unit: Consolidation logic — old sessions compressed, recent sessions preserved.
- Integration: Full session lifecycle produces correct log entries in order.
- Integration: Consolidation reduces a 300-entry log while preserving recent sessions.
- Edge: Concurrent appends from rapidly firing hooks produce valid output.
- Edge: Missing log file is created on first append.
- Property: Log entries are strictly chronological (no out-of-order timestamps).
