# 09 — Waste Detection

## Overview

Waste detection analyzes token usage patterns to identify behaviors that consume tokens unnecessarily. It runs as a scheduled task (default: weekly) and produces actionable flags that highlight specific waste patterns with estimated token costs and remediation suggestions.

## Capabilities

### Waste Patterns

The detector must identify the following patterns:

1. **Repeated Reads** — Same file read multiple times in a single session. Flag includes: file path, read count, tokens wasted per extra read.

2. **Missed Index Opportunities** — Large file reads (>500 estimated tokens) where the file index had a description that might have sufficed. Flag includes: file path, token cost, index description that was available.

3. **Action Log Bloat** — Action log exceeds a configurable token threshold (default: 5000 tokens). Flag includes: current size, recommended consolidation.

4. **Learning Memory Staleness** — Learning memory has not been updated in more than a configurable period (default: 14 days). Flag includes: last update date, suggestion to review.

5. **Index Miss Rate** — More than a configurable percentage (default: 20%) of file index lookups resulted in misses. Flag includes: hit/miss ratio, suggestion to rescan.

### Flag Structure

Each waste flag must contain:

- Pattern name (which of the 5 patterns).
- Human-readable description of what was detected.
- Estimated tokens wasted.
- Actionable suggestion for remediation.
- Detection timestamp.

### Reporting

- Waste flags are stored in the token ledger under a dedicated section.
- Each detection run replaces the previous set of flags (they reflect current state, not history).
- The dashboard (if enabled) displays active waste flags.

## Acceptance Criteria

```
GIVEN a session where "src/large-module.ts" (~800 tokens) was read 3 times
WHEN waste detection runs
THEN a "Repeated Reads" flag is produced for that file
AND the estimated waste is ~1600 tokens (2 extra reads × 800)

GIVEN 100 file index lookups with 25 misses
WHEN waste detection runs
THEN an "Index Miss Rate" flag is produced showing 25% miss rate
AND the suggestion recommends a full rescan

GIVEN the action log is 6000 tokens
WHEN waste detection runs
THEN an "Action Log Bloat" flag is produced
AND the suggestion recommends running consolidation

GIVEN the learning memory was last updated 20 days ago
WHEN waste detection runs
THEN a "Learning Memory Staleness" flag is produced
AND the suggestion recommends reviewing and updating the learning memory

GIVEN all patterns are within healthy thresholds
WHEN waste detection runs
THEN no waste flags are produced
```

## Edge Cases

- Token ledger is empty (no sessions yet) — report zero waste, no flags.
- Waste detection runs but token ledger is corrupted — skip detection, log warning.
- All reads were repeated reads — flag every file, not just an aggregate.
- Learning memory file is missing — flag as stale (infinite staleness).

## Test Requirements

- Unit: Each pattern detector in isolation with known inputs → correct flag or no flag.
- Unit: Threshold boundary testing — exactly at threshold, one above, one below.
- Unit: Flag structure validation — all required fields present.
- Integration: Full detection run across a sample ledger with mixed waste patterns.
- Edge: Empty ledger produces zero flags.
- Edge: Missing learning memory file is detected as stale.
