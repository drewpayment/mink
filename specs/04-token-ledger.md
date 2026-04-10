# 04 — Token Ledger

## Overview

The token ledger is a persistent record of all token usage across every session. It stores lifetime aggregate counters, per-session detail arrays, and enables savings calculations. It provides the data foundation for waste detection, dashboard visualizations, and the user's understanding of where tokens go.

## Capabilities

### Lifetime Counters

The ledger must track cumulative totals across all sessions:

- Total estimated tokens consumed (reads + writes).
- Total file reads performed.
- Total file writes performed.
- Total sessions completed.
- Total file index hits (file read was in the index).
- Total file index misses (file read was not in the index).
- Total repeated reads warned (same file read multiple times in one session).
- Estimated total tokens saved versus unassisted AI usage.

### Per-Session Records

Each session appended to the ledger must include:

- Session identifier and start/end timestamps.
- Array of reads: file path, estimated tokens, whether it was a repeated read, whether the file index had a description.
- Array of writes: file path, estimated tokens, action type (create/edit).
- Aggregate totals for the session: input tokens, output tokens, read count, write count, repeated reads blocked, file index lookups.

### Savings Estimation

The system must calculate estimated token savings using:

- Each file index hit saves an estimated 200 tokens (the cost of the AI reading blind without context).
- Each blocked repeated read saves the full estimated token cost of that file.
- Formula: `savings = (index_hits × 200) + sum(repeated_read_token_estimates)`
- The savings figure is an estimate, not an exact measurement. It should be presented as approximate.

### Data Integrity

- The ledger must be append-only for session records — existing sessions are never modified or deleted.
- Lifetime counters are updated atomically with each session append.
- The ledger file must survive partial writes (write to temp, then rename).

## Acceptance Criteria

```
GIVEN a session with 5 file reads (3 index hits) and 2 file writes
WHEN the session finalizes
THEN a new session record is appended to the ledger with 5 read entries and 2 write entries
AND lifetime total_reads increments by 5
AND lifetime total_writes increments by 2
AND lifetime anatomy_hits increments by 3

GIVEN a session where a file (~400 tokens) was read twice
WHEN the session finalizes
THEN the repeated read is flagged in the session record
AND lifetime repeated_reads_blocked increments by 1
AND estimated savings includes 400 tokens for the blocked repeated read

GIVEN the ledger has 10 existing sessions
WHEN a new session is appended
THEN all 10 existing sessions remain unchanged
AND the new session appears at the end of the sessions array

GIVEN the system crashes during a ledger write
WHEN the system recovers
THEN the ledger contains either the old state or the new state — never a partial write

GIVEN the ledger contains session data across 30 sessions
WHEN the savings calculation runs
THEN the result equals (total_index_hits × 200) + sum(all repeated_read_token_costs)
```

## Edge Cases

- Ledger file does not exist on first session — create with zeroed lifetime counters and empty session array.
- Ledger file is corrupted (invalid structure) — attempt recovery from last known good state, or reinitialize with a warning logged.
- Very large ledger (1000+ sessions) — consider archiving old sessions to a separate file to keep the active ledger performant.
- Token estimate is zero for a file (empty file read) — record it but do not count toward savings.

## Test Requirements

- Unit: Lifetime counter arithmetic — incrementing each counter correctly.
- Unit: Savings calculation formula with known inputs.
- Unit: Session record structure validation — all required fields present.
- Integration: Full session lifecycle → ledger entry with correct values.
- Integration: Multiple sessions produce sequentially numbered entries with accumulating counters.
- Edge: First-ever session creates the ledger from scratch.
- Edge: Corrupted ledger triggers graceful recovery.
- Property: Lifetime counters always equal the sum of per-session values.
- Property: Session array is strictly append-only across operations.
