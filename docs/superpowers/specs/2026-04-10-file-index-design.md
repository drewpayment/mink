# File Index — Implementation Design

## Summary

Spec 02 builds a structured catalog of every meaningful file in the project. Each entry has a human-readable description and token cost estimate. The AI assistant consults this index before reading files — if the description is sufficient, the full read is skipped. The index is populated by a `mink scan` command and updated per-file by write hooks (spec 06, later).

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Architecture | Three modules: scanner, description, index-store | Clear boundaries, independently testable |
| Index format | JSON (`file-index.json`) | Consistent with other state files, reliable upsert via `atomicWriteJson` |
| Description extraction | Simple regex heuristics, no AST | Covers 80% of cases, no language-specific dependencies, easy to extend |
| Scheduling | `mink scan` CLI command only | Periodic scheduling deferred to spec 10 (Background Scheduler) |
| File cap | 500 default, most recently modified first | Recency is strongest signal for "will the AI read this?" |
| Excludes | Built-in defaults + user overrides in `config.json` | Keeps dependencies/build output out of index without user effort |
| Symlinks | Skip entirely | Avoids circular loops, simple and safe |

## Module Structure

```
src/
├── core/
│   ├── description.ts        # Pure functions: extract description from file content
│   ├── scanner.ts            # Filesystem walk, exclude filtering, file discovery
│   ├── index-store.ts        # Index CRUD: load, upsert, remove, staleness check
│   └── token-estimate.ts     # Estimate token cost from content length
├── commands/
│   └── scan.ts               # CLI handler: orchestrate scanner + description + store
├── types/
│   └── file-index.ts         # Interfaces for index entries, header, config
```

State files:

```
~/.mink/projects/<slug>/
├── file-index.json           # The index
├── config.json               # User overrides (excludePatterns, maxFiles)
```

## Data Schema

### Index Structure (`file-index.json`)

```typescript
interface FileIndexHeader {
  lastScanTimestamp: string;    // ISO 8601 UTC
  totalFiles: number;
  lifetimeHits: number;
  lifetimeMisses: number;
}

interface FileIndexEntry {
  filePath: string;             // Relative to project root
  description: string;          // Max 100 chars
  estimatedTokens: number;
  lastModified: string;         // ISO 8601 UTC (from file stat)
  lastIndexed: string;          // ISO 8601 UTC (when we indexed it)
}

interface FileIndex {
  header: FileIndexHeader;
  entries: Record<string, FileIndexEntry>;  // Keyed by relative file path
}
```

Key decisions:
- **Entries as `Record`** — O(1) lookup by path, same pattern as `SessionState.reads`.
- **Relative paths** — not invalidated if project moves (only project ID changes).
- **`lastModified` vs `lastIndexed`** — `lastModified` is the file's mtime (for sort/priority), `lastIndexed` is when we processed it (for staleness).
- **`lifetimeHits`/`lifetimeMisses`** — updated by the read hook (spec 05) when it consults the index.

### Config Structure (`config.json`)

```typescript
interface ProjectConfig {
  excludePatterns?: string[];   // Merged with built-in defaults (additive)
  maxFiles?: number;            // Default: 500
}
```

Minimal. Only overrides — defaults live in code.

## Description Extraction

Pure functions in `description.ts`. Given a file path and content, return a one-line string (max 100 chars). Tried in priority order — first match wins.

### Heuristic Chain

| Priority | File Signal | Extraction Logic | Example |
|----------|------------|-----------------|---------|
| 1 | `.md`, `.mdx` — has heading | First `# ` heading | `"Session Lifecycle"` |
| 2 | `.html`, `.htm` — has `<title>` | Content of `<title>` tag | `"Dashboard - My App"` |
| 3 | Source file — has doc comment | First line of `/** ... */` or `"""..."""` or top `# ` comment block | `"Handles user authentication"` |
| 4 | Source file — has exports | Summarize export names | `"exports: atomicWriteJson, safeReadJson"` |
| 5 | Component (`.tsx`, `.jsx`, `.vue`, `.svelte`) | Component name + detected elements | `"UserProfile — renders form, table"` |
| 6 | Config file (known names) | Purpose from filename convention | `"TypeScript configuration"` |
| 7 | CI/CD file | Workflow `name:` field or filename | `"CI: build-and-test"` |
| 8 | Database/migration file | Table/entity names or filename | `"migration: add_users_table"` |
| 9 | Fallback | First non-empty, non-comment line, truncated | `"import { join } from 'path';"` |

### Config Filename Map (Priority 6)

```typescript
const CONFIG_DESCRIPTIONS: Record<string, string> = {
  "package.json": "Node.js package manifest",
  "tsconfig.json": "TypeScript configuration",
  "tailwind.config": "Tailwind CSS configuration",
  "vite.config": "Vite build configuration",
  "next.config": "Next.js configuration",
  "eslint.config": "ESLint configuration",
  ".eslintrc": "ESLint configuration",
  ".prettierrc": "Prettier configuration",
  "Dockerfile": "Docker container definition",
  "docker-compose": "Docker Compose services",
  "Makefile": "Make build targets",
};
```

Matched by basename (with or without extension).

### Truncation

All descriptions truncated to 100 characters. If truncated, last 3 chars replaced with `...`.

### Edge Cases

- **Empty file** — `"<filename> — empty file"`
- **Binary content** (null bytes detected) — `"<filename> — binary file"`
- **File > 100KB** — extract description normally, append `" (large file)"`
- **Non-UTF-8** — `"<filename> — non-UTF-8 content"`

## Scanner

`scanner.ts` walks the project directory, filters excludes, returns a sorted capped list.

### Built-in Exclude Patterns

```typescript
const DEFAULT_EXCLUDES: string[] = [
  // Dependencies
  "node_modules", "vendor", ".venv", "venv", "__pycache__",
  "bower_components", ".yarn", ".pnp",
  // Build output
  "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".vercel", ".output",
  // Coverage/test artifacts
  "coverage", ".nyc_output",
  // Version control
  ".git", ".hg", ".svn",
  // Lock files
  "package-lock.json", "bun.lock", "yarn.lock",
  "pnpm-lock.yaml", "Gemfile.lock", "poetry.lock", "composer.lock",
  // Minified/generated
  "*.min.js", "*.min.css", "*.map",
  // Binary/media
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico",
  "*.woff", "*.woff2", "*.ttf", "*.eot",
  "*.mp3", "*.mp4", "*.webm", "*.zip", "*.tar", "*.gz",
  "*.pdf", "*.exe", "*.dll", "*.so", "*.dylib",
  // Environment
  ".env", ".env.*",
  // Mink state
  ".mink",
];
```

User patterns from `config.json` are appended (additive, not replacing).

### Pattern Matching

- **Directory names** (no `*`, no extension-like prefix) — match against any path segment. `node_modules` matches `foo/node_modules/bar.js`.
- **Glob patterns** (contain `*`) — match against basename. `*.min.js` matches `app.min.js`.
- **Dotfile/exact names** — match against basename exactly. `.env` matches `.env`.

Simple string matching, no glob library dependency.

### Walk Algorithm

1. Recursive `readdirSync` with `withFileTypes: true`
2. Skip directories matching an exclude pattern (prune subtrees)
3. Skip files matching an exclude pattern
4. Skip symlinks entirely
5. For each included file: `stat` for `mtimeMs`, collect `{ relativePath, mtimeMs }`
6. Sort by `mtimeMs` descending (most recent first)
7. Slice to `maxFiles` (default 500)
8. Return the list

## Index Store

`index-store.ts` owns `file-index.json`. CRUD plus staleness detection.

### Operations

- **`loadIndex(indexPath)`** — Read and parse. If missing/corrupt, return fresh empty index with zeroed header.
- **`saveIndex(indexPath, index)`** — Atomic write via `atomicWriteJson`.
- **`upsertEntry(index, entry)`** — Insert or update keyed by `filePath`. Updates `header.totalFiles`.
- **`removeEntry(index, filePath)`** — Delete entry. Updates `header.totalFiles`.
- **`lookupEntry(index, filePath)`** — Return entry or `null`. Does not modify counters.
- **`recordHit(index)`** — Increment `header.lifetimeHits`.
- **`recordMiss(index)`** — Increment `header.lifetimeMisses`.
- **`checkStaleness(index, scannedFiles)`** — Compare index entries against a list of scanned file paths:
  - Files in scanned list but not in index → `missingFromIndex[]`
  - Entries in index not in scanned list → `orphanedEntries[]`
  - Return `{ missingFromIndex, orphanedEntries, isStale }`

### Fresh Index

```typescript
function createEmptyIndex(): FileIndex {
  return {
    header: {
      lastScanTimestamp: "",
      totalFiles: 0,
      lifetimeHits: 0,
      lifetimeMisses: 0,
    },
    entries: {},
  };
}
```

## Token Estimation

`token-estimate.ts` — pure function, no dependencies.

```typescript
function estimateTokens(content: string, filePath: string): number
```

Ratios based on content type:
- Code files (`.ts`, `.js`, `.py`, `.go`, `.rs`, etc.) — ~3.5 chars/token
- Prose files (`.md`, `.txt`, `.rst`) — ~4.0 chars/token
- Mixed/unknown — ~3.75 chars/token

Determined by file extension. Returns `Math.ceil(content.length / ratio)`.

## Scan Command

### `mink scan`

1. Load project config — merge user excludes with defaults
2. Load existing index (or create fresh)
3. Run scanner: walk, filter, sort, cap
4. For each file: read content → extract description → estimate tokens → build entry
5. Build new entries map from scan results
6. Update header: `lastScanTimestamp = now`, `totalFiles = count` — preserve `lifetimeHits`/`lifetimeMisses`
7. Save index atomically
8. Print summary: files indexed, time elapsed

### `mink scan --check`

1. Load existing index — if missing, "no index found", exit 1
2. Run scanner to get current file list
3. Run `checkStaleness(index, scannedFiles)`
4. Print missing and orphaned files
5. Exit 0 if clean, exit 1 if stale

### `mink init` Update

After wiring hooks and creating the project directory, run an initial scan automatically so the index is populated on first setup.

## CLI Integration

Add to `src/cli.ts`:

```typescript
case "scan": {
  const { scan } = await import("./commands/scan");
  const check = process.argv.includes("--check");
  scan(cwd, { check });
  break;
}
```

## `paths.ts` Extension

```typescript
export function fileIndexPath(cwd: string): string {
  return join(projectDir(cwd), "file-index.json");
}

export function configPath(cwd: string): string {
  return join(projectDir(cwd), "config.json");
}
```

## Error Handling

- File can't be read (permissions, encoding) — skip, log warning, continue scan
- Config file missing — use defaults, no warning
- Scan finds 0 files — write empty index, log note
- Scan interrupted — previous index retained (atomic write)
- Index file missing at load — return fresh empty index
- Index file corrupt — return fresh empty index, log warning

## Integration Points (Future Specs)

- **Spec 05 (Read Intelligence)** — calls `lookupEntry()`, then `recordHit()`/`recordMiss()`, passes description to AI if found
- **Spec 06 (Write Enforcement)** — calls `upsertEntry()` after every file write with fresh description + token estimate
- **Spec 01 (Session Lifecycle)** — `SessionState.counters.fileIndexHits`/`fileIndexMisses` already exist, updated by the read hook

## Testing Strategy

### Unit Tests

- **`description.ts`** — one test per heuristic: markdown heading, HTML title, doc comment, exports, component, config filename, CI workflow, migration, fallback. Plus edge cases: empty file, binary content, large file, non-UTF-8, truncation.
- **`token-estimate.ts`** — known content strings with expected token ranges for code, prose, and mixed.
- **`scanner.ts`** — temp directory with nested structure. Verify: exclude filtering prunes directories and files, sort by mtime descending, cap at maxFiles, symlinks skipped, user config excludes merged.
- **`index-store.ts`** — upsert (new + update), remove, lookup, hit/miss counting, staleness check (missing files, orphaned entries), corrupt file recovery, fresh empty index.

### Integration Tests

- Full scan of temp project → verify index entries match filesystem
- Staleness check detects added and removed files
- Scan with custom config excludes filters correctly

### Edge Tests

- Empty project (0 files) — empty index, no crash
- Project exceeding maxFiles — only 500 most recent indexed
- Config with custom excludes — merged with defaults correctly
- File deleted between scan start and content read — skip gracefully
