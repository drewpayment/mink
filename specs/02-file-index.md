# 02 — File Index

## Overview

The file index is a structured catalog of every meaningful file in the project. Each entry contains a human-readable description and an estimated token cost. The AI assistant consults this index before reading any file — if the description is sufficient, the full read is skipped, saving tokens. The index is auto-maintained: every write updates the relevant entry, and periodic full rescans keep it current.

## Capabilities

### Index Structure

The file index must:

1. Organize entries by directory, with each directory as a named section.
2. Each entry contains: relative file path, one-line description (max 100 characters), and estimated token cost.
3. Include a header with: last scan timestamp, total tracked file count, lifetime hit count, and lifetime miss count.
4. Be stored in a human-readable format that the AI assistant naturally consumes (not a binary or deeply nested structure).

### Auto-Update on Write

After any file is written or edited, the system must:

1. Read the newly written file content.
2. Extract a smart description using content-aware heuristics:
   - Documentation files: first heading.
   - Markup files: title element.
   - Source files with doc comments: first line of the doc comment.
   - Module files: summary of exports (function/class/constant names).
   - Component files: component name plus key rendered elements (form, table, modal, etc.).
   - Configuration files: purpose derived from filename conventions.
   - Database files: entity/table names.
   - CI/CD files: workflow or pipeline name.
   - Fallback: first non-empty, non-comment line truncated to max length.
3. Estimate token cost from file length using character-to-token ratios (code ~3.5 chars/token, prose ~4.0, mixed ~3.75).
4. Upsert the entry in the correct directory section of the index.
5. Write atomically (write to temporary file, then rename) to prevent corruption.
6. Skip files in the system's own state directory and environment variable files.

### Full Project Scan

On initialization and on a configurable schedule (default: every 6 hours), the system must:

1. Walk the project directory tree.
2. Exclude configured patterns (dependency directories, build output, lock files, binary assets, version control directories, the system's own state directory).
3. For each discovered file: extract description, estimate tokens, create index entry.
4. Cap the total tracked files at a configurable maximum (default: 500).
5. Write the complete index atomically.

### Staleness Detection

The system should support a check mode that:

1. Compares the current filesystem against the index without modifying it.
2. Reports files that exist on disk but are missing from the index.
3. Reports index entries whose files no longer exist on disk.
4. Exits with a failure status if staleness is detected (suitable for CI pipelines).

## Acceptance Criteria

```
GIVEN a file is written for the first time
WHEN the post-write hook fires
THEN a new entry appears in the file index under the correct directory section
AND the entry contains a description derived from the file content
AND the entry contains an estimated token cost

GIVEN a file already exists in the index
WHEN that file is edited
THEN the existing entry is updated with a new description and token estimate
AND no duplicate entry is created

GIVEN a project with 50 source files
WHEN a full scan is triggered
THEN all 50 files appear in the index with descriptions and token estimates
AND files matching exclude patterns are omitted
AND the header reflects the correct file count and scan timestamp

GIVEN a file index exists
WHEN a file is deleted from the project but not from the index
AND a staleness check runs
THEN the check reports the orphaned entry
AND exits with failure status

GIVEN the index is being written
WHEN the write is interrupted (crash, timeout)
THEN the previous version of the index remains intact (atomic write guarantee)

GIVEN a source file with a doc comment "Handles user authentication"
WHEN the description extractor processes it
THEN the extracted description is "Handles user authentication"

GIVEN a component file that renders a form with a table inside
WHEN the description extractor processes it
THEN the description includes the component name and mentions form/table elements
```

## Edge Cases

- File with no extractable description (empty file, binary-like content) — use filename as description with "unknown content" qualifier.
- File exceeding reasonable size (>100KB) — still index it but note large size in description.
- Symlinks — follow or skip based on configuration, but never create circular scan loops.
- Files with unusual encodings — attempt UTF-8, fall back to noting "non-UTF-8 content" in description.
- Index file itself should never appear as an entry in the index.
- Concurrent writes to the index from multiple hooks — atomic write prevents corruption, last writer wins.

## Test Requirements

- Unit: Description extraction for each supported file pattern (doc comments, headings, exports, components, configs, CI files, fallback).
- Unit: Token estimation accuracy within 20% of actual tokenizer output for representative files.
- Unit: Directory section parsing and entry upsert logic.
- Unit: Exclude pattern matching against common dependency/build directories.
- Integration: Full scan of a sample project produces correct index.
- Integration: Post-write hook updates index entry after file edit.
- Integration: Staleness check detects added and removed files.
- Edge: Atomic write survives simulated crash (temp file exists but rename hasn't happened).
- Edge: Description extraction on empty file, binary file, extremely long first line.
- Property: Index entry count never exceeds configured maximum.
