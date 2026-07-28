# 29 — Similar-Task Recall

## Overview

Mink records every session's activity, but that history is append-only: there is
no way to ask "have I done something like this before?". This capability makes
the history queryable. Given the files a task is about to touch — or a free-text
description — it ranks prior sessions by similarity, so the assistant can find
and reuse the approach it took last time instead of rediscovering it.

The similarity signal is deterministic file overlap (the Jaccard index over the
set of files each session touched). Ranking prior sessions semantically over a
richer description is a future enhancement layered on the embedding capability;
the file-overlap heuristic is the reliable, dependency-free baseline.

## Capabilities

### Ranking

- Given a set of files, prior sessions are ranked by the Jaccard overlap between
  that set and each session's touched files (reads and writes combined).
- Given a free-text query, prior sessions are ranked by how many of their touched
  file paths match the query's keywords.
- Results include the matched (shared) files and the session's timestamp, and are
  ordered most-similar first with a deterministic tie-break (newer session, then
  identifier).
- A session may be excluded from the results by identifier (for example, the
  current session).

### Surfaces

- Recall is available as a command and as a pull tool; the tool requires at least
  one of a file set or a query.

## Acceptance Criteria

```
GIVEN prior sessions with known touched files
WHEN similar tasks are requested for a set of files
THEN sessions are returned ranked by Jaccard overlap, and a session with no
     overlap is excluded

GIVEN a session identifier to exclude
WHEN similar tasks are requested
THEN that session does not appear in the results

GIVEN a free-text query
WHEN similar tasks are requested with no file set
THEN sessions whose file paths match the query keywords are returned

GIVEN two sessions with equal similarity
WHEN results are ordered
THEN the more recent session is ranked first

GIVEN neither a file set nor a query
WHEN similar tasks are requested
THEN no results are returned
```

## Edge Cases

- Sessions that touched no files — skipped.
- A query with only short/stop tokens — yields no keyword matches.
- No prior sessions — an empty result and a plain "none found" message.
- Ties in similarity — broken deterministically so output is stable.

## Prompt-Cache Stability

- Ranking is deterministic for a fixed session history and input, so repeated
  calls produce identical output.

## Test Requirements

- Unit: Jaccard math and the file-set union; ranking by overlap with a
  no-overlap session excluded; exclusion by identifier; query keyword matching;
  deterministic newer-first tie-break; empty-signal and empty-history cases.
