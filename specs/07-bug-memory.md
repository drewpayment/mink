# 07 — Bug Memory

## Overview

The bug memory is a persistent, searchable log of bugs encountered and resolved across sessions. Each entry captures the error, its root cause, the fix applied, and contextual tags. When the AI assistant edits a file, relevant past bugs for that file are surfaced. Over time, the bug memory builds a project-specific knowledge base of failure modes and solutions.

## Capabilities

### Entry Structure

Each bug entry must contain:

- Unique identifier (sequential, e.g., "bug-001").
- Timestamp of when the bug was logged.
- Error message or symptom description.
- File path where the bug was encountered.
- Line number (if applicable).
- Root cause explanation.
- Fix description — what was changed and why.
- Tags — short keywords for categorization (e.g., "null-check", "api-response", "auth").
- Related bugs — references to other bug IDs that share a root cause or file.
- Occurrence count — how many times this bug has been seen.
- Last seen timestamp.

### When to Log

The AI assistant should create a bug entry when:

- The user reports an error, bug, or problem.
- A test fails or a command produces an error.
- The AI fixes something that was broken.
- A file is edited more than twice to get right (indicating trial-and-error).
- An import, module, or dependency is missing.
- A runtime, type, or syntax error occurs.
- A build or lint process fails.
- A feature doesn't work as expected.
- Error handling, validation, or try-catch logic is changed.

### Similarity Matching

When searching the bug log (either for surfacing during pre-write or via explicit search), the system must:

1. Use SQLite FTS5 (porter+unicode61 tokenization) over error message, root cause, fix description, and tags. The BM25-derived rank is normalized into a (0, 1+] score so the rest of the rules stay compatible with the v1 Jaccard scoring.
2. Exact-substring match on error messages adds 1.0 to the score (same as v1).
3. Only surface matches with similarity score > 0.3.
4. Prioritize matches from the same file path (+0.2 boost).
5. Prevent false positives by requiring at least file-path match OR tag overlap when the FTS score alone is borderline (≤ 0.3).

### Reminders

- When a file is edited 3+ times in a session without a corresponding bug entry, the system should emit a reminder suggesting a bug log entry.
- The reminder should include the file path and edit count.

### Search Interface

Users must be able to search the bug log by:

- Error message text (partial match).
- Root cause text.
- Fix description text.
- Tags.
- File path.

Search results should include all matching entries sorted by relevance (similarity score).

## Acceptance Criteria

```
GIVEN the AI fixes a TypeError in "src/api.ts" caused by a null API response
WHEN the AI logs the bug
THEN a new entry exists with: error_message, file "src/api.ts", root_cause, fix, and relevant tags

GIVEN a bug entry exists for "src/api.ts" about null response handling
WHEN the AI begins editing "src/api.ts"
THEN the pre-write hook surfaces the bug entry including root_cause and fix

GIVEN two bug entries — one for "src/api.ts" about null responses, one for "src/auth.ts" about token expiry
WHEN searching for "null response"
THEN the "src/api.ts" entry is returned with high similarity
AND the "src/auth.ts" entry is NOT returned (below threshold)

GIVEN the AI has edited "src/utils.ts" 4 times this session
AND no bug entry exists for "src/utils.ts" in this session
WHEN the session stop event fires
THEN a reminder is emitted: "src/utils.ts was edited 4 times — consider logging a bug"

GIVEN a bug with ID "bug-005" was seen again
WHEN the AI updates the bug entry
THEN the occurrence count increments
AND the last_seen timestamp updates
AND the original entry data is preserved

GIVEN a search query "database connection timeout"
WHEN the search runs against 50 bug entries
THEN entries mentioning "database", "connection", or "timeout" in error_message, root_cause, or tags appear
AND results are sorted by similarity score descending
```

## Edge Cases

- Bug log file doesn't exist yet — create it with an empty array on first write.
- Duplicate bug (same error, same file) — update occurrence count rather than creating a new entry.
- Bug entry with empty tags array — still searchable by other fields.
- Search query matches only on tags but not on error text — still surface if score > 0.3.
- Very large bug log (500+ entries) — search should remain performant (simple text matching, no indexing required).

## Test Requirements

- Unit: Similarity scoring — exact substring, word overlap, mixed, no match.
- Unit: Threshold filtering — entries below 0.3 excluded, above 0.3 included.
- Unit: Occurrence count increment preserves other fields.
- Unit: Search across all searchable fields (error_message, root_cause, fix, tags, file).
- Integration: AI fixes a bug → logs entry → edits same file later → entry is surfaced.
- Integration: File edited 3+ times → reminder emitted at session stop.
- Edge: Empty bug log — search returns empty results, no crash.
- Edge: Duplicate detection — same error+file logs as update, not new entry.
- Property: Bug IDs are unique and sequential.
