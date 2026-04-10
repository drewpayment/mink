# 05 — Read Intelligence

## Overview

Read intelligence intercepts file read operations at two points: before the read (pre-read) and after the read (post-read). Pre-read surfaces context from the file index and warns about repeated reads. Post-read records the actual token cost of the read. Together, they give the AI assistant situational awareness about what it's reading and what it has already read.

## Capabilities

### Pre-Read: Before a File is Read

When the AI assistant is about to read a file, the system must:

1. **Repeated read detection:**
   - Check the ephemeral session state for whether this file was already read this session.
   - If repeated: emit a warning to the AI assistant including the file path and estimated token cost from the prior read.
   - Record the repeated read warning in session state counters.

2. **File index lookup:**
   - Search the file index for the file being read.
   - If found: emit the file's description and estimated token cost to the AI assistant.
   - Record whether the lookup was a hit or miss in session state.

3. **Non-blocking:**
   - The pre-read hook must NEVER prevent the read from proceeding.
   - All output is advisory (warnings and context), not enforcement.
   - Exit with success status regardless of findings.

### Post-Read: After a File is Read

After the file read completes, the system must:

1. **Token estimation:**
   - Estimate the token count from the actual file content using character-to-token ratios.
   - Code-heavy files: ~3.5 characters per token.
   - Prose-heavy files: ~4.0 characters per token.
   - Mixed content: ~3.75 characters per token.

2. **Session state update:**
   - Record or update the file's entry in the session state with: actual token estimate, read count, and timestamp.
   - If content is unavailable from the tool output, fall back to the file index estimate.

### Timeout Safety

- Pre-read must complete within 5 seconds.
- Post-read must complete within 5 seconds.
- If a timeout occurs, the hook exits silently without disrupting the AI assistant's workflow.

## Acceptance Criteria

```
GIVEN a file "src/auth.ts" exists in the file index with description "Auth middleware" (~380 tokens)
WHEN the AI assistant begins reading that file
THEN the pre-read hook emits: description "Auth middleware" and estimated cost ~380 tokens
AND the session state records a file index hit

GIVEN a file "src/new-feature.ts" does NOT exist in the file index
WHEN the AI assistant begins reading that file
THEN no description is emitted
AND the session state records a file index miss

GIVEN "src/auth.ts" was already read earlier this session (~380 tokens)
WHEN the AI assistant begins reading it again
THEN a repeated-read warning is emitted with the file path and prior token cost
AND the session state increments the repeated read warning counter

GIVEN the AI assistant just finished reading a 2000-character source file
WHEN the post-read hook fires
THEN the session state records an estimated ~571 tokens (2000 / 3.5) for that file

GIVEN the post-read hook cannot access the file content from tool output
WHEN it attempts to estimate tokens
THEN it falls back to the estimate from the file index

GIVEN the pre-read hook takes longer than 5 seconds
WHEN the timeout is reached
THEN the hook exits with success status
AND the file read proceeds normally
```

## Edge Cases

- File is read via a partial/range read (offset + limit) — still check repeated reads and file index, but token estimate may only reflect the partial content.
- File read targets a binary or non-text file — skip token estimation, record as "non-text" in session state.
- File index is missing or corrupted — skip the lookup, record a miss, do not crash.
- Session state file is missing when pre-read fires — create fresh session state on the fly.
- Extremely large file (>1MB) — still estimate and record, but consider emitting a size warning.

## Test Requirements

- Unit: Repeated read detection — first read not flagged, second read flagged with correct token count.
- Unit: File index lookup — hit returns description + tokens, miss returns nothing.
- Unit: Token estimation — code file, prose file, mixed file, empty file.
- Unit: Fallback to file index estimate when content unavailable.
- Integration: Pre-read → read → post-read full sequence updates session state correctly.
- Integration: Multiple reads of different files accumulate correctly in session state.
- Edge: Missing session state file triggers graceful creation.
- Edge: Missing file index file does not crash pre-read.
- Performance: Pre-read completes within 5 seconds on a project with 500+ file index entries.
