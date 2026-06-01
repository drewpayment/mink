# 02 — File Index

## Overview

The file index is a structured catalog of every meaningful file in the project. Each entry contains a human-readable description and an estimated token cost. The AI assistant consults this index before reading any file — if the description is sufficient, the full read is skipped, saving tokens. The index is auto-maintained: every write updates the relevant entry, and periodic full rescans keep it current.

## Capabilities

### Index Structure

The file index must:

1. Organize entries by directory, with each directory as a named section.
2. Each entry contains: relative file path, one-line description (max 100 characters), and estimated token cost.
3. Track project-wide state (last scan timestamp) and per-device telemetry (hit count, miss count).
4. Be stored in a structured store (SQLite) optimized for per-entry update and lookup. The assistant consults the index via `mink lookup <path>` / `mink status` rather than by reading the store directly — the per-row read/write cost stays flat as the index grows, so hooks remain fast at 20k+ files.

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
4. No default cap on tracked file count — the SQLite store keeps per-row write cost flat as the index grows. Callers that want a cap may set `maxFiles` in `config.json`.
5. Persist all entries via a single bulk transaction; orphan entries for files no longer on disk are pruned in the same scan.

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

## Prompt-Cache Stability

The file index now lives in SQLite, so the historic risk of a volatile JSON/markdown header busting Anthropic's prefix prompt cache is gone — the assistant never reads the raw store. However, any **derived** markdown surface (e.g. an exported `file-index.md` summary, a status digest, or a CLI report that an LLM may later load) must follow the same layout rule:

- Stable structure (directory section headings, schema/legend, column headers) at the top.
- Volatile fields (`last scan at`, `total files`, per-device hit/miss counters) at the bottom in a `<!-- mink:footer -->` block.

Rationale: prompt caches hash from the prompt prefix forward. Putting a volatile `last_scan: <ISO>` line at line 2 invalidates every cached subsequent token — typically a 10x cost multiplier on hook-rich sessions.

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
