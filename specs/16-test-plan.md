# 16 — Test Plan

## Overview

This document defines the testing strategy for Mink and calls out test gaps observed in the reference implementation. The reference codebase had **zero automated tests** — no unit tests, no integration tests, no end-to-end tests. All validation was implicit (functional testing through production usage). This is the single largest quality risk identified.

Mink must ship with comprehensive test coverage from day one.

---

## Tests the Reference Implementation Should Have Delivered

The following tests were conspicuously absent. Each represents a behavior that was implemented but never validated in isolation:

### Hook Tests (Critical — These Are the Core Product)

| # | Test | Why It Matters |
|---|------|----------------|
| H1 | Session-start hook creates valid session state | If the session state structure is wrong, every downstream hook fails silently |
| H2 | Session-start hook increments lifetime session counter | Counter drift means savings estimates become meaningless |
| H3 | Pre-read hook detects repeated reads correctly | Core token-saving claim — if this is broken, the value proposition collapses |
| H4 | Pre-read hook looks up files in file index correctly | Incorrect lookups produce wrong descriptions or miss entries |
| H5 | Pre-read hook never exits with blocking status | A blocking pre-read would prevent the AI from reading any file — catastrophic |
| H6 | Post-read hook estimates tokens within acceptable margin | Inaccurate estimates undermine all usage metrics |
| H7 | Post-read hook falls back to index estimate when content unavailable | Missing fallback means sessions have gaps in token tracking |
| H8 | Pre-write hook extracts patterns from Do-Not-Repeat section | If extraction fails, the enforcement feature is silently disabled |
| H9 | Pre-write hook matches patterns against write content | False negatives mean learned mistakes are repeated |
| H10 | Pre-write hook never exits with blocking status | A blocking pre-write would prevent the AI from writing any file — catastrophic |
| H11 | Post-write hook extracts smart descriptions from diverse file types | The file index quality depends entirely on this extraction |
| H12 | Post-write hook upserts file index entries atomically | Non-atomic writes risk index corruption |
| H13 | Post-write hook appends to action log without corrupting existing entries | Append-only invariant is the log's integrity guarantee |
| H14 | Stop hook aggregates session totals correctly | Wrong totals cascade into wrong ledger entries and wrong savings estimates |
| H15 | Stop hook handles multiple fires per session (idempotent) | The stop event fires on every assistant response, not just session end |
| H16 | Stop hook detects files edited 3+ times without bug entry | Reminder feature doesn't work if detection is wrong |

### Token Estimation Tests

| # | Test | Why It Matters |
|---|------|----------------|
| T1 | Code file estimation (chars / 3.5) produces results within 20% of actual | The 65.8% savings claim rests on these estimates being reasonable |
| T2 | Prose file estimation (chars / 4.0) produces results within 20% of actual | Same — different ratio for different content types |
| T3 | Mixed file estimation (chars / 3.75) handles realistic content | Most files are mixed; the interpolation must be tested |
| T4 | Empty file produces 0 tokens | Edge case that could produce NaN or errors |
| T5 | Very large file (>1MB) produces a reasonable estimate without crash | No timeout, no overflow, no hang |

### File Description Extraction Tests

| # | Test | Why It Matters |
|---|------|----------------|
| D1 | Markdown file → first heading extracted | Most common documentation format |
| D2 | File with doc comment → first line of doc comment extracted | Source files in most languages |
| D3 | Component file → component name + rendered elements | Frontend-heavy projects depend on this |
| D4 | Module with exports → export summary | Index quality for utility modules |
| D5 | Configuration file → purpose from filename | Configs are the most-read files in projects |
| D6 | Empty file → fallback description | Shouldn't crash or produce empty entry |
| D7 | Binary-like file → safe fallback | Shouldn't attempt to parse binary content |
| D8 | File with only comments → extracts meaningful description | Comment-only files are common (configs, type definitions) |
| D9 | Very long first line → truncated to max length | Prevents index bloat from minified files |

### Bug Similarity Tests

| # | Test | Why It Matters |
|---|------|----------------|
| B1 | Exact substring match scores 1.0 | Primary match path |
| B2 | Word overlap (Jaccard) with 0.5× multiplier | Secondary match path |
| B3 | Score below 0.3 is not surfaced | Prevents noise from irrelevant matches |
| B4 | Same filename in different directory does not match | Prevents false positives from common filenames like index.ts |
| B5 | Empty bug log returns empty results | No crash on fresh project |
| B6 | Search across all fields (error, cause, fix, tags, file) | Users search with any context they remember |

### Cron/Scheduler Tests

| # | Test | Why It Matters |
|---|------|----------------|
| C1 | Exponential backoff calculates correct delays | Wrong delays could fire retries too fast or too slow |
| C2 | Dead letter queue operations (add, list, retry, remove) | Core reliability mechanism |
| C3 | Task execution respects enabled/disabled flag | Disabled tasks must never fire |
| C4 | Manual trigger bypasses schedule | CLI usability depends on this |
| C5 | Concurrent task scheduling doesn't race | Two tasks at the same second must not corrupt state |

### Atomic Write Tests

| # | Test | Why It Matters |
|---|------|----------------|
| A1 | Write-to-temp then rename produces correct file | The corruption prevention mechanism itself |
| A2 | Interrupted write leaves original file intact | The whole point of atomic writes |
| A3 | Temp file is cleaned up after successful rename | Prevents tmp file accumulation |

---

## Tests Mink Must Deliver (Beyond Reference Gaps)

### Cross-Project Wiki Tests

| # | Test | Description |
|---|------|-------------|
| W1 | Init creates project wiki pages with correct structure | Overview, conventions, architecture pages |
| W2 | Learning memory update mirrors to wiki conventions page | Incremental append, not overwrite |
| W3 | Bug log entry creates wiki bug page with full context | Error, cause, fix, tags, links |
| W4 | Session end appends daily session summary | Correct date-based file, append within existing day |
| W5 | Cross-project pattern detection finds real similarities | Two projects with similar conventions produce a pattern page |
| W6 | Cross-project pattern detection ignores false similarities | Unrelated entries don't produce noise pages |
| W7 | Wikilinks resolve to existing pages | No broken links in the vault |
| W8 | Wiki disabled in config produces zero file operations | Feature flag works correctly |
| W9 | Simultaneous updates from different projects don't corrupt shared files | Index.md and pattern pages handle concurrent writes |
| W10 | Generated files are valid markdown | No syntax errors, proper heading hierarchy, valid tables |

### CLI Tests

| # | Test | Description |
|---|------|-------------|
| CLI1 | `mink init` in fresh directory creates all required state files | Happy path initialization |
| CLI2 | `mink init` upgrade preserves user state and updates templates | Migration path |
| CLI3 | `mink status` output contains all expected sections | Display correctness |
| CLI4 | `mink scan --check` exits 1 when stale, 0 when current | CI-safe exit codes |
| CLI5 | `mink cron list` shows all tasks with correct formatting | Display correctness |
| CLI6 | `mink bug search` returns relevant results | Search quality |
| CLI7 | `mink restore` lists backups when no argument given | UX correctness |
| CLI8 | Each command handles missing state directory gracefully | Error recovery |

### Dashboard Tests

| # | Test | Description |
|---|------|-------------|
| DASH1 | Each panel renders with sample data | No crash on valid input |
| DASH2 | Each panel renders with empty data | No crash on empty/missing state |
| DASH3 | Live update from daemon refreshes affected panel | Real-time correctness |
| DASH4 | Theme toggle persists across reloads | Local storage integration |
| DASH5 | Search/filter in file index and bug log panels | Interaction correctness |
| DASH6 | Daemon offline state displays and recovers | Connection resilience |

### Tool-Output Compression Tests (spec 21)

| # | Test | Description |
|---|------|-------------|
| TC1 | countTokens is deterministic and monotonic | Measurement validity rests on a stable estimator |
| TC2 | Ledger records compressed and holdout arms; measured savings credits compressed only | Savings must be measured, not the legacy heuristic |
| TC3 | Holdout selection is stable per event | An event must never be double-counted across arms |
| TC4 | Cache store→get returns the byte-exact original | Reversibility is the correctness guarantee |
| TC5 | Unknown/expired retrieval token is a graceful miss | The assistant is never stranded by an error |
| TC6 | Each engine strategy (search/log/file/json/text) shrinks and notes omissions | Content-aware compression correctness |
| TC7 | Engine is deterministic (identical input → identical output) | Prompt-cache stability |
| TC8 | Code skeleton elides bodies, captures members, masks string braces | Structural summary fidelity |
| TC9 | Orchestrator: disabled→no-op, below-threshold→pass-through, min-savings gate discards weak | Conservative-by-default behavior |
| TC10 | E2E: large Read is compressed via updatedToolOutput and `mink retrieve` returns the original | The headline capability, end to end |

---

## Testing Strategy

### Layer 1: Unit Tests

Every pure function and module gets unit tests. Priority order:

1. **Hook logic** — the core product. Every branch, every edge case.
2. **Token estimation** — the metrics foundation.
3. **Description extraction** — the index quality driver.
4. **Similarity matching** — the bug memory intelligence.
5. **Pattern extraction and matching** — the enforcement mechanism.
6. **Cron scheduling** — the automation reliability.

### Layer 2: Integration Tests

End-to-end flows through the system:

1. **Full session lifecycle** — init → start → read → write → stop → verify all state files.
2. **Upgrade path** — existing installation → init again → verify preservation + updates.
3. **Wiki sync** — project operations → verify wiki pages reflect changes.
4. **CLI commands** — each command in a sample project environment.
5. **Dashboard data flow** — daemon event → dashboard update.

### Layer 3: Property Tests

Invariants that must hold across all inputs:

1. Pre-read and pre-write hooks NEVER exit with blocking status codes.
2. Atomic writes NEVER produce partially written files.
3. Session state is ALWAYS fresh per session (no cross-session contamination).
4. Token ledger lifetime counters ALWAYS equal the sum of per-session values.
5. Bug IDs are ALWAYS unique and sequential.
6. All generated wiki files are ALWAYS valid markdown.
7. File index entry count NEVER exceeds configured maximum.

### Coverage Targets

- Hook logic: 100% branch coverage (these are the product).
- Core utilities (token estimation, description extraction, similarity matching): 95%+ line coverage.
- CLI commands: integration test for each command's happy path + error path.
- Dashboard: render test for each panel with data + empty state.
- Wiki: integration test for each sync trigger.
- Global config: integration test for CLI config commands + priority resolution.
- Git backup: integration test for commit/push lifecycle including failure modes.

---

## Automation Test Mandate

**Every feature in Mink must have automated tests before it can be considered complete.** This applies to:

1. **All features inherited from the reference implementation** — The reference shipped with zero tests. Mink must not repeat this. Every hook, every utility, every state mutation must be tested.
2. **All Mink-unique features** — The cross-project wiki, global config, git backup, and CLI config command must have full test coverage matching the same standards as core features.
3. **No feature is exempt** — Optional features (design evaluation, framework advisor) included. If it ships, it's tested.

A feature is not done until:

- Unit tests cover all branches and edge cases.
- Integration tests verify end-to-end behavior.
- Property tests enforce invariants.
- Edge case tests handle corruption, missing files, and timeouts.

CI must run the full test suite on every change and block merges on failure.

---

## Environments

Tests must pass in:

- macOS (primary development platform).
- Linux (CI/CD and server environments).
- Windows (community support, lower priority but must not crash).

Platform-specific behavior (paths, process management, file permissions) must be tested or abstracted behind a platform module with per-platform tests.
