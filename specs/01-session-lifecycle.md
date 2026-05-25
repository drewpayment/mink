# 01 — Session Lifecycle

## Overview

Every interaction with the AI assistant is bounded by a session. The session lifecycle provides the scaffolding that all other features depend on — it creates ephemeral tracking state when a session begins and consolidates accumulated data when the session ends.

## Capabilities

### Session Initialization

When a new session begins, the system must:

1. Generate a unique session identifier incorporating the current date and time.
2. Create an ephemeral session state record that tracks all activity for this session only.
3. Append a session header entry to the action log with a structured table template ready for entries.
4. Increment the lifetime session counter in the token ledger.

### Session State Tracking

The ephemeral session state must maintain:

- Session identifier and start timestamp.
- A map of files read during this session, each recording: read count, estimated token cost, and timestamp of first read.
- An ordered list of files written during this session, each recording: file path, action type (create/edit), estimated token cost, and timestamp.
- Per-file edit counters (how many times each file was modified this session).
- Counters for: file index hits, file index misses, repeated read warnings issued, and learned-rule warnings issued.
- A stop-event counter to handle multiple stop events per session.

### Session Finalization

When the AI assistant finishes responding (stop event), the system must:

1. Read the ephemeral session state.
2. If any activity occurred (reads or writes):
   a. Build a session summary with arrays of reads and writes plus aggregate totals.
   b. Calculate estimated token savings from file index hits and blocked repeated reads.
   c. Append the session entry to the token ledger with lifetime counter updates.
   d. Write a session summary line to the action log.
3. Check for files edited 3+ times without a corresponding bug log entry — emit a reminder if found.
4. Check if the learning memory was updated within the last 24 hours — emit a reminder if stale.

### Session Isolation

- Each session's ephemeral state is independent. Starting a new session always creates fresh state regardless of prior state.
- The stop event may fire multiple times per session (once per assistant response). Only the first stop with activity should write a full session entry; subsequent stops should update the existing entry.

## Acceptance Criteria

```
GIVEN no active session exists
WHEN a new session begins
THEN a unique session state record is created
AND a session header is appended to the action log
AND the lifetime session counter increments by 1

GIVEN an active session with file reads and writes
WHEN the session stop event fires for the first time
THEN a session summary is written to the token ledger
AND estimated savings are calculated from file index hits and repeated read blocks
AND the action log receives a summary line

GIVEN an active session where a file was edited 3+ times
WHEN the session stop event fires
AND no bug log entry exists for that file in this session
THEN a reminder is emitted suggesting a bug log entry

GIVEN an active session
WHEN the stop event fires a second time
THEN the existing session entry is updated rather than duplicated

GIVEN a prior session's ephemeral state still exists on disk
WHEN a new session begins
THEN the old state is overwritten with fresh state
```

## Edge Cases

- Stop event fires with zero activity (no reads, no writes) — no session entry should be written to the ledger.
- Session state file is corrupted or missing when stop fires — degrade gracefully, skip consolidation, log warning.
- Multiple rapid stop events — idempotent handling, no duplicate ledger entries.
- Clock skew or timezone changes mid-session — use UTC consistently.

## Prompt-Cache Stability

Anthropic's prompt cache hashes from the **start** of the prompt forward; any volatile content at the top of a file Mink emits (timestamps, session IDs, counters, "last updated" fields) silently invalidates downstream cache hits and multiplies token cost. Any generated markdown produced by session lifecycle code that may be loaded into model context (for example, per-day vault session files written by `session-stop`) **must** keep volatile fields out of the prefix.

**Layout rule (applies to all markdown emitted by this spec):**

- Stable structure at the top: title (`#`), section headings (`##`), schemas, tables of contents.
- Volatile fields at the bottom: ISO timestamps, session IDs, run counters, "last updated" lines.
- Frontmatter `created`/`updated` keys are acceptable **only** when written exactly once at creation and never rewritten (current behavior of the per-day session file is OK).

**Before / after example:**

```diff
- ---
- updated: "2026-05-25T20:14:11.221Z"
- ---
-
- # Sessions — mink — 2026-05-25
+ # Sessions — mink — 2026-05-25
+ ...
+ <!-- mink:footer (volatile — keep at end of file) -->
+ > Last session appended: 2026-05-25T20:14:11.221Z
```

## Test Requirements

- Unit: Session ID generation produces unique, timestamp-based identifiers.
- Unit: Session state initialization creates correct empty structure.
- Unit: Stop handler correctly aggregates reads/writes into summary totals.
- Unit: Savings calculation: `(file_index_hits × 200) + sum(repeated_read_tokens)`.
- Integration: Full lifecycle — start → reads → writes → stop → verify ledger entry.
- Integration: Multiple stops per session produce exactly one ledger entry (updated, not duplicated).
- Edge: Corrupt session state file does not crash the stop handler.
- Edge: Zero-activity session produces no ledger entry.
