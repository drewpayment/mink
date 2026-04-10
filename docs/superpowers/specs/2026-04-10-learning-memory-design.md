# Learning Memory — Implementation Design

## Summary

Spec 03 builds a persistent, structured markdown document that accumulates project knowledge across sessions. It has four sections: User Preferences, Key Learnings, Do-Not-Repeat, and Decision Log. A pattern engine extracts enforceable rules from Do-Not-Repeat entries for future pre-write hook integration (spec 06). A reflection command prunes the memory to stay within a configurable token budget.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage format | Pure markdown (`learning-memory.md`) | Human-readable, the spec describes it as a "document," entries are natural-language prose |
| Pattern extraction scope | Exact spec — quoted strings + "never use"/"avoid" only | Predictable behavior, minimal false positives, expandable later |
| Initialization seeding | Multi-ecosystem (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`) | Broader coverage from the start |
| Pruning trigger | `mink reflect` CLI command, also called from session-stop | Standalone command for flexibility, automatic on session end |
| Pruning strategy | Merge duplicates first, then trim oldest | Matches spec language, preserves unique actionable entries |
| Write enforcement | Pure functions only (no hook wiring until spec 06) | Functions are testable in isolation, spec 06 wires the hook |

## Module Structure

```
src/
├── core/
│   ├── learning-memory.ts    # CRUD: parse, serialize, add/remove entries, section management
│   ├── pattern-engine.ts     # Pure functions: extractPatterns, matchPatterns
│   ├── reflection.ts         # Pruning: duplicate detection, merge, oldest-first trim
│   └── seed.ts               # Initialization: parse metadata files, generate seed content
├── commands/
│   ├── reflect.ts            # CLI handler: load memory, prune, save
│   └── session-stop.ts       # (modified) call reflect after session finalization
├── types/
│   └── learning-memory.ts    # Interfaces for entries, sections, patterns, match results
```

State files:

```
~/.mink/projects/<slug>/
├── learning-memory.md        # The learning memory document
├── config.json               # User overrides (learningMemoryTokenBudget)
```

## Markdown Format

```markdown
# Learning Memory — my-project

## User Preferences

- Prefer named exports over default exports
- Use camelCase for variables, PascalCase for types

## Key Learnings

- Project: my-api — A REST API for user management
- Detected frameworks: Express, TypeScript, Jest

## Do-Not-Repeat

- [2026-04-10] Never use "var" — always "const" or "let"
- [2026-04-10] Avoid mocking the database in integration tests — use test fixtures instead

## Decision Log

- [2026-04-10] Chose Bun as primary runtime with Node.js fallback for portability
```

### Parsing Rules

- Sections identified by `## ` heading matching one of the four known names.
- Entries are lines starting with `- ` under each section heading.
- Do-Not-Repeat and Decision Log entries require `[YYYY-MM-DD]` date prefix.
- Blank lines between entries are preserved but ignored during parsing.
- Everything outside recognized sections is ignored (future-proofing).

### Serialization

Sections emitted in fixed order: User Preferences → Key Learnings → Do-Not-Repeat → Decision Log. Title line is `# Learning Memory — <project-name>`.

## Initialization Seeding

When `mink init` runs (or when learning memory doesn't exist and is needed), `seed.ts` inspects project metadata files.

### Metadata File Parsing

| File | Extract |
|------|---------|
| `package.json` | `name`, `description`, `dependencies`/`devDependencies` keys for framework detection |
| `pyproject.toml` | `[project]` name/description, `[project.dependencies]` for framework detection |
| `Cargo.toml` | `[package]` name/description, `[dependencies]` keys |
| `go.mod` | Module path as name, dependency lines for framework detection |

### Framework Detection

Match dependency names against a known map (e.g., `react` → "React", `fastapi` → "FastAPI", `actix-web` → "Actix Web"). List detected frameworks in the Key Learnings section as seed entries.

### Seed Output

```markdown
# Learning Memory — my-api

## User Preferences

(empty)

## Key Learnings

- Project: my-api — A REST API for user management
- Detected frameworks: Express, TypeScript, Jest

## Do-Not-Repeat

(empty)

## Decision Log

(empty)
```

### Edge Cases

- No metadata file found → seed with directory name only, no framework detection.
- Multiple metadata files (monorepo) → include findings from all.
- Metadata file exists but is malformed → skip it, no error.

## Pattern Engine

Pure functions in `pattern-engine.ts` for Do-Not-Repeat enforcement.

### `extractPatterns(doNotRepeatEntries: string[])`

Takes raw entry strings, returns an array of pattern objects. Tried in priority order:

1. **Quoted strings** — extract content between `"..."` or `'...'`. Match literally in target content.
   - `'Never use "var"'` → literal pattern `var`
   - `'Avoid "export default"'` → literal pattern `export default`

2. **"Never use" / "avoid" phrases** — extract the word(s) following these triggers up to end of phrase (punctuation or dash). Match as word-boundary patterns.
   - `'Avoid mocking the database in integration tests'` → word-boundary pattern `mocking the database`
   - `'Never use default exports'` → word-boundary pattern `default exports`

3. **Both can appear in one entry** — extract all patterns found.

4. **No extractable pattern** — entry is skipped, no pattern produced.

### `matchPatterns(patterns, content)`

Takes extracted patterns + file content. Returns array of match results: matched pattern, original Do-Not-Repeat entry text, matched substring location.

- Literal patterns: `content.includes(pattern)` — case-sensitive.
- Word-boundary patterns: regex with `\b` anchors — case-insensitive.

## Reflection (Pruning)

### Flow

1. **Estimate tokens.** Use `estimateTokens()` on the full markdown content (prose ratio, 4.0 chars/token). If under budget (default 2000), done.

2. **Merge duplicates.** Within each section, compare entries pairwise:
   - **Exact duplicates** (normalized whitespace) → keep one.
   - **Same quoted pattern** in Do-Not-Repeat entries → merge, keep newer date.
   - **Substring containment** — if one entry fully contains another's meaning → keep the more specific one.

3. **Trim oldest.** If still over budget after merging, remove entries one at a time:
   - Decision Log trimmed first (historical, least actionable).
   - Key Learnings and User Preferences trimmed next by age.
   - Do-Not-Repeat trimmed last (enforced, highest value).
   - Re-check budget after each removal.

### Token Budget

Default 2000, configurable via `config.json` (`learningMemoryTokenBudget`).

### CLI Output

```
[mink] reflect
  tokens: 2450 → 1820 (within 2000 budget)
  merged: 3 duplicate entries
  trimmed: 2 stale entries
```

## Session-Stop Integration

After existing finalization logic, session-stop calls the reflect function. This replaces the current `isLearningMemoryStale()` check — reflect handles both pruning and staleness detection (if no entries were added in >24h, emit the reminder).

## CLI Integration

Add to `src/cli.ts`:

```typescript
case "reflect": {
  const { reflect } = await import("./commands/reflect");
  reflect(cwd);
  break;
}
```

## `paths.ts` Extension

```typescript
export function learningMemoryPath(cwd: string): string {
  return join(projectDir(cwd), "learning-memory.md");
}
```

Replaces the hardcoded path in `session-stop.ts`.

## `fs-utils.ts` Extension

```typescript
export function atomicWriteText(filePath: string, content: string): void {
  const tmp = filePath + ".tmp";
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}
```

Same crash-safe pattern as `atomicWriteJson`, but writes raw string content for markdown files.

## Init Integration

After creating project dir and running scan, also seed learning memory if it doesn't exist. `init.ts` calls `seed.ts` to generate and write the initial file.

## Error Handling

- **Missing learning memory file** — CRUD functions return empty structure, log warning. `reflect` exits cleanly. Pattern engine returns no patterns.
- **Corrupted/unparseable file** — Recreate with empty sections, preserve salvageable content as a User Preferences entry, log warning.
- **Empty sections** — Valid state. Serialization writes section headings with no entries beneath.
- **Entry with no extractable pattern** — Skipped by pattern engine. No warning, no error.
- **Multiple patterns match same content** — All matching warnings emitted.
- **Token budget of 0 or negative** — No budget enforcement, skip pruning.
- **Metadata file malformed during init** — Skip that file, continue with others. Log warning.
- **Concurrent writes** — Atomic write via `atomicWriteText` (write `.tmp`, rename).

## Integration Points (Future Specs)

- **Spec 06 (Write Enforcement)** — calls `extractPatterns()` and `matchPatterns()` from `pattern-engine.ts` in the pre-write hook. See integration notes added to spec 06.
- **Spec 10 (Background Scheduler)** — can invoke `mink reflect` on a schedule for periodic pruning.
- **Spec 01 (Session Lifecycle)** — `SessionCounters.learnedRuleWarnings` already exists, updated by the future pre-write hook.

## Testing Strategy

### Unit Tests

- **`learning-memory.ts`** — parse markdown into sections, serialize back. Add/remove entries per section. Round-trip: parse → serialize → parse produces identical structure. Edge cases: empty file, missing sections, corrupted content.
- **`pattern-engine.ts`** — extract quoted strings, "never use" phrases, "avoid" phrases, mixed entries, entries with no pattern. Match literal patterns (case-sensitive), word-boundary patterns (case-insensitive). True positives and true negatives.
- **`reflection.ts`** — exact duplicate merge, same-pattern merge, substring containment merge. Trim order (Decision Log first, Do-Not-Repeat last). Budget enforcement. No-op when under budget.
- **`seed.ts`** — parse each metadata format. Framework detection from dependency names. Missing files, malformed files, multiple files.

### Integration Tests

- Full init → seed → verify learning memory file contents match project metadata.
- Add entries until over budget → reflect → verify merged/trimmed and under budget.
- Parse Do-Not-Repeat → extract patterns → match against sample code → verify warnings.

### Edge Tests

- Empty project (no metadata files) — seed produces skeleton with directory name only.
- Learning memory at exactly token budget — no pruning.
- All entries are unique with no duplicates — merge pass is no-op, trim by age only.
- Corrupted file triggers recreation with empty sections.
