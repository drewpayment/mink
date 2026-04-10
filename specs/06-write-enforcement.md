# 06 — Write Enforcement

## Overview

Write enforcement intercepts file write and edit operations at two points: before the write (pre-write) and after the write (post-write). Pre-write checks learned rules from the learning memory and surfaces relevant bug history. Post-write updates the file index, appends to the action log, and tracks the operation in session state.

## Capabilities

### Pre-Write: Before a File is Written

When the AI assistant is about to write or edit a file, the system must:

1. **Learning memory enforcement:**
   - Read the Do-Not-Repeat section of the learning memory.
   - Extract enforceable patterns from entries:
     - Quoted strings become literal match targets.
     - "Never use X" / "avoid X" phrases become word-boundary patterns.
   - Match extracted patterns against the content being written.
   - If any pattern matches: emit a warning identifying the specific Do-Not-Repeat entry.

2. **Bug memory lookup:**
   - Search the bug log for entries related to the file being edited.
   - Use similarity matching: exact substring matches on error messages, plus word overlap scoring.
   - If relevant bugs are found (similarity score > 0.3): emit a summary of prior bugs for that file, including root cause and fix.

3. **Non-blocking:**
   - The pre-write hook must NEVER prevent the write from proceeding.
   - All output is advisory warnings, not enforcement.
   - Exit with success status regardless of findings.

### Post-Write: After a File is Written

After the file write completes, the system must:

1. **File index update:**
   - Read the newly written file.
   - Extract a smart description using content-aware heuristics (see spec 02).
   - Estimate token cost from file length.
   - Upsert the entry in the file index under the correct directory section.
   - Write atomically (temp file + rename).

2. **Action log entry:**
   - Append a timestamped entry to the action log with: file path, action type (create/edit), and estimated token cost.

3. **Session state update:**
   - Record the write in the session state: file path, action type, token estimate, timestamp.
   - Increment the per-file edit counter for this file.

4. **Exclusions:**
   - Skip files in the system's own state directory.
   - Skip environment variable files (`.env*` patterns).

### Timeout Safety

- Pre-write must complete within 5 seconds.
- Post-write must complete within 10 seconds (longer due to file reading and index updates).
- Timeouts exit silently without disrupting the AI assistant's workflow.

## Acceptance Criteria

```
GIVEN a Do-Not-Repeat entry: '[2026-03-10] Never use "var"'
WHEN the AI writes code containing the string "var "
THEN a warning is emitted citing the Do-Not-Repeat entry
AND the write proceeds normally

GIVEN a Do-Not-Repeat entry: '[2026-03-11] Avoid default exports'
WHEN the AI writes code containing "export default"
THEN a warning is emitted citing the Do-Not-Repeat entry

GIVEN a bug log entry for "src/api.ts" with root_cause "null response from auth service"
WHEN the AI begins editing "src/api.ts"
THEN the pre-write hook emits the bug context including root cause and fix

GIVEN the AI just wrote a new file "src/utils/format.ts"
WHEN the post-write hook fires
THEN the file index contains an entry for "src/utils/format.ts" with description and token estimate
AND the action log has a new entry with the file path and "create" action
AND the session state records the write

GIVEN the AI edits a file in the system's state directory
WHEN the post-write hook fires
THEN no file index update occurs
AND no action log entry is created

GIVEN the AI edits a ".env.local" file
WHEN the post-write hook fires
THEN the file is excluded from all tracking

GIVEN the post-write hook is updating the file index
WHEN the process is interrupted mid-write
THEN the previous version of the file index remains intact
```

## Edge Cases

- Do-Not-Repeat entries with no extractable pattern (vague text like "be careful with auth") — skip pattern extraction, do not emit false warnings.
- Multiple Do-Not-Repeat entries match the same write — emit all matching warnings.
- Bug log contains entries for a different file with the same name in a different directory — only match on full relative path.
- Written file is empty — still update file index with "empty file" description and 0 tokens.
- Written file is very large (>100KB) — still process, but token estimation may be imprecise.
- Post-write cannot read the written file (permissions, race condition) — skip index update, log warning.

## Test Requirements

- Unit: Pattern extraction from various Do-Not-Repeat entry formats.
- Unit: Pattern matching — true positives (var in code), true negatives (variable name containing "var" substring — configurable sensitivity).
- Unit: Bug similarity scoring — exact match, partial overlap, no match, same-filename-different-directory.
- Unit: File exclusion patterns — state directory, .env files, other files not excluded.
- Integration: Pre-write loads learning memory and bug log, emits correct warnings for a contrived scenario.
- Integration: Post-write updates file index, action log, and session state for a new file and an edited file.
- Edge: Empty Do-Not-Repeat section produces no warnings and no errors.
- Edge: Missing bug log file does not crash pre-write.
- Performance: Post-write completes within 10 seconds including file index update on a 500-entry index.
