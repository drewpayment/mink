# 03 — Learning Memory

## Overview

The learning memory is a persistent, structured document that accumulates knowledge across sessions. It captures user preferences, project conventions, past mistakes, and architectural decisions. The AI assistant reads it before generating code and updates it when corrected. Pre-write hooks enforce the "do-not-repeat" section by pattern-matching against code being written.

## Capabilities

### Structure

The learning memory must maintain four distinct sections:

1. **User Preferences** — How the user likes things done: coding style, naming conventions, tooling choices, organizational preferences.
2. **Key Learnings** — Project-specific facts the AI discovered: framework quirks, configuration details, naming conventions, architectural patterns.
3. **Do-Not-Repeat** — Timestamped entries of specific mistakes or anti-patterns that must not recur. Each entry includes a date and a concrete rule.
4. **Decision Log** — Timestamped architectural or design decisions with brief rationale.

### Population

The learning memory is populated through:

1. **Initialization** — Seed with project name, description, and detected framework/tooling information from project metadata files.
2. **Manual updates** — The AI assistant updates sections during normal conversation when:
   - User corrects the AI's approach → User Preferences.
   - AI discovers a project convention → Key Learnings.
   - AI encounters a gotcha or mistake → Do-Not-Repeat (with date).
   - A design/architecture decision is made → Decision Log (with date).
3. **Automated reflection** — A scheduled task periodically reviews and prunes the learning memory to keep it under a configurable token budget (default: 2000 tokens). Removes duplicates, merges related entries, and archives stale items.

### Enforcement

Before any file is written or edited, the system must:

1. Read the Do-Not-Repeat section.
2. Extract enforceable patterns:
   - Quoted strings within entries become literal match patterns.
   - Phrases following "never use" or "avoid" become word-boundary match patterns.
3. Compare extracted patterns against the content being written.
4. If a match is found: emit a warning identifying the matched rule. The warning must include the original Do-Not-Repeat entry text.
5. Never block the write — warnings only. The AI assistant decides whether to proceed.

### Token Budget

The learning memory should remain concise:

- Target maximum: configurable (default 2000 tokens).
- Automated reflection prunes entries that are redundant, outdated, or superseded.
- Entries should be specific and actionable, not vague or philosophical.

## Acceptance Criteria

```
GIVEN a new project is initialized
WHEN the learning memory is created
THEN it contains the project name and description from project metadata
AND all four sections exist (even if empty)

GIVEN the user corrects the AI ("don't use default exports")
WHEN the AI updates the learning memory
THEN a new entry appears in User Preferences reflecting the correction

GIVEN the AI discovers a project convention ("API uses sliding window rate limiting")
WHEN the AI updates the learning memory
THEN a new entry appears in Key Learnings with the convention

GIVEN the AI made a mistake that was caught
WHEN the AI adds a Do-Not-Repeat entry
THEN the entry includes a date and a specific, actionable rule

GIVEN a Do-Not-Repeat entry: '[2026-03-10] Never use "var" — always "const" or "let"'
WHEN the AI writes code containing "var x = 5"
THEN a warning is emitted referencing the Do-Not-Repeat entry
AND the write is NOT blocked

GIVEN a Do-Not-Repeat entry: '[2026-03-11] Avoid mocking the database in integration tests'
WHEN the AI writes test code containing "mock" and "database"
THEN a warning is emitted referencing the entry

GIVEN the learning memory has grown beyond the token budget
WHEN the automated reflection task runs
THEN duplicate and redundant entries are merged
AND the resulting document is within the token budget
AND no unique, actionable information is lost

GIVEN the learning memory was last updated more than 24 hours ago
WHEN a session stop event fires
THEN a reminder is emitted suggesting the learning memory may need updating
```

## Edge Cases

- Do-Not-Repeat pattern matches on a comment or string literal, not actual code — warning still fires (false positive is acceptable; blocking is not).
- Multiple Do-Not-Repeat entries match the same write — all matching warnings are emitted.
- Learning memory file is missing or corrupted — recreate with empty sections, log warning.
- Reflection task encounters an entry it cannot classify as redundant or unique — preserve it (err on the side of keeping).
- User explicitly contradicts a Do-Not-Repeat entry — the AI should update the entry, not just ignore it.

## Prompt-Cache Stability

The learning memory is read into model context every session by the AI assistant — making its prefix one of the most cache-sensitive files Mink emits. Anthropic's prompt cache hashes from the start of the prompt forward, so volatile content at the top (a "last updated" timestamp, a session counter, a reflection-run ID) invalidates the entire downstream cache and multiplies token cost.

**Layout rule:**

- **Top (stable, cached):** `# Learning Memory — <project>` title, then the four section headings (`## User Preferences`, `## Key Learnings`, `## Do-Not-Repeat`, `## Decision Log`) in fixed order, followed by their entries.
- **Bottom (volatile, must not appear in the prefix):** any `last_updated`, `reflection_run_at`, or counter fields belong in a footer block — e.g. an HTML-comment marker followed by a `> Last reflection: <ISO>` line.

Note: dated Do-Not-Repeat and Decision Log entries are not "volatile" in the cache sense — they accumulate append-only inside their section and the prefix above them stays stable.

**Before / after example:**

```diff
- # Learning Memory — mink
- > Last updated: 2026-05-25T20:14:11Z
- > Reflection run: 47
-
- ## User Preferences
+ # Learning Memory — mink
+
+ ## User Preferences
  - prefer arrow functions
+
+ <!-- mink:footer (volatile — keep at end of file) -->
+ > Last reflection: 2026-05-25T20:14:11Z (run 47)
```

## Test Requirements

- Unit: Pattern extraction from Do-Not-Repeat entries — quoted strings, "never use X", "avoid X" phrases.
- Unit: Pattern matching against sample code snippets — true positives and true negatives.
- Unit: Section parsing — correctly identifies and separates the four sections.
- Unit: Initialization seeding from sample project metadata files.
- Integration: Pre-write hook loads learning memory, extracts patterns, matches against write content, emits correct warnings.
- Integration: Reflection task reduces a bloated learning memory to within token budget without losing unique entries.
- Edge: Corrupted learning memory file triggers recreation with empty sections.
- Edge: Overlapping patterns from multiple Do-Not-Repeat entries all produce warnings.
- Property: Pre-write hook never exits with a blocking status code regardless of input.
