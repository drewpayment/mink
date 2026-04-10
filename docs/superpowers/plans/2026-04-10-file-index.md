# File Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Mink's file index — a structured JSON manifest of every project file with descriptions and token estimates, enabling AI assistants to locate files without reading the entire tree, reducing token waste from blind exploration.

**Architecture:** A scanner walks the project filesystem (respecting exclude patterns), reads each file, extracts a one-line description via heuristics, estimates token count by character-to-token ratio, and persists the result as `file-index.json` under `~/.mink/projects/<slug>/`. The `mink scan` CLI command triggers a full rebuild; `mink scan --check` reports staleness without mutating state. The `mink init` command runs an initial scan after setup.

**Tech Stack:** TypeScript, Bun (runtime + test runner + package manager), Node.js fallback

**Design doc:** `docs/superpowers/specs/2026-04-10-file-index-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/types/file-index.ts` | TypeScript interfaces: FileIndex, FileIndexHeader, FileIndexEntry, ProjectConfig, StalenessReport, ScannedFile |
| `src/core/token-estimate.ts` | Pure function: estimate token count from file content and extension |
| `src/core/description.ts` | Heuristic extraction: one-line description from file content using priority chain |
| `src/core/scanner.ts` | Filesystem walk with configurable exclude patterns and max-file cap |
| `src/core/index-store.ts` | Index CRUD: create, upsert, remove, lookup, hit/miss counters, staleness check |
| `src/core/paths.ts` | (modify) Add `fileIndexPath(cwd)` and `configPath(cwd)` |
| `src/commands/scan.ts` | CLI handler: orchestrate scan, build index, persist, report |
| `src/cli.ts` | (modify) Add `scan` case with `--check` flag |
| `src/commands/init.ts` | (modify) Run initial scan after setup |
| `tests/unit/token-estimate.test.ts` | Tests for token estimation ratios and edge cases |
| `tests/unit/description.test.ts` | Tests for all description extraction priorities and edge cases |
| `tests/unit/scanner.test.ts` | Tests for directory walk, exclude filtering, max-file cap |
| `tests/unit/index-store.test.ts` | Tests for index CRUD, counters, staleness detection |
| `tests/integration/file-index.test.ts` | Full scan lifecycle: scan project, verify index, check staleness |

---

## Task 1: Types

**Files:**
- Create: `src/types/file-index.ts`

- [ ] **Step 1: Create the type definitions file**

Create `src/types/file-index.ts`:

```typescript
export interface FileIndexHeader {
  lastScanTimestamp: string;
  totalFiles: number;
  lifetimeHits: number;
  lifetimeMisses: number;
}

export interface FileIndexEntry {
  filePath: string;
  description: string;
  estimatedTokens: number;
  lastModified: string;
  lastIndexed: string;
}

export interface FileIndex {
  header: FileIndexHeader;
  entries: Record<string, FileIndexEntry>;
}

export interface ProjectConfig {
  excludePatterns?: string[];
  maxFiles?: number;
}

export interface StalenessReport {
  missingFromIndex: string[];
  orphanedEntries: string[];
  isStale: boolean;
}

export interface ScannedFile {
  relativePath: string;
  mtimeMs: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/file-index.ts
git commit -m "feat: add file index type definitions

Introduce interfaces for FileIndex, FileIndexEntry, FileIndexHeader,
ProjectConfig, StalenessReport, and ScannedFile."
```

---

## Task 2: Token Estimation (TDD)

**Files:**
- Create: `tests/unit/token-estimate.test.ts`
- Create: `src/core/token-estimate.ts`

- [ ] **Step 1: Write tests first**

Create `tests/unit/token-estimate.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { estimateTokens } from "../../src/core/token-estimate";

describe("estimateTokens", () => {
  test("uses code ratio (3.5) for .ts files", () => {
    const content = "a".repeat(350);
    const result = estimateTokens(content, "src/app.ts");
    expect(result).toBe(100); // 350 / 3.5 = 100
  });

  test("uses code ratio (3.5) for .py files", () => {
    const content = "a".repeat(700);
    const result = estimateTokens(content, "main.py");
    expect(result).toBe(200); // 700 / 3.5 = 200
  });

  test("uses prose ratio (4.0) for .md files", () => {
    const content = "a".repeat(400);
    const result = estimateTokens(content, "README.md");
    expect(result).toBe(100); // 400 / 4.0 = 100
  });

  test("uses prose ratio (4.0) for .txt files", () => {
    const content = "a".repeat(200);
    const result = estimateTokens(content, "notes.txt");
    expect(result).toBe(50); // 200 / 4.0 = 50
  });

  test("uses default ratio (3.75) for unknown extensions", () => {
    const content = "a".repeat(375);
    const result = estimateTokens(content, "data.csv");
    expect(result).toBe(100); // 375 / 3.75 = 100
  });

  test("rounds up to nearest integer", () => {
    const content = "a".repeat(10);
    const result = estimateTokens(content, "tiny.ts");
    expect(result).toBe(3); // 10 / 3.5 = 2.857... -> ceil = 3
  });

  test("returns 0 for empty content", () => {
    const result = estimateTokens("", "empty.ts");
    expect(result).toBe(0); // 0 / 3.5 = 0
  });

  test("handles uppercase extensions", () => {
    const content = "a".repeat(350);
    const result = estimateTokens(content, "APP.TS");
    expect(result).toBe(100); // .TS lowercased -> code ratio
  });

  test("handles .tsx as code", () => {
    const content = "a".repeat(350);
    const result = estimateTokens(content, "Component.tsx");
    expect(result).toBe(100);
  });

  test("handles .jsx as code", () => {
    const content = "a".repeat(350);
    const result = estimateTokens(content, "Component.jsx");
    expect(result).toBe(100);
  });

  test("handles .go as code", () => {
    const content = "a".repeat(350);
    const result = estimateTokens(content, "main.go");
    expect(result).toBe(100);
  });

  test("handles .rs as code", () => {
    const content = "a".repeat(350);
    const result = estimateTokens(content, "lib.rs");
    expect(result).toBe(100);
  });

  test("handles .mdx as prose", () => {
    const content = "a".repeat(400);
    const result = estimateTokens(content, "post.mdx");
    expect(result).toBe(100);
  });

  test("handles file with no extension using default ratio", () => {
    const content = "a".repeat(375);
    const result = estimateTokens(content, "Makefile");
    // "Makefile" has no dot, so lastIndexOf(".") returns -1
    // slice(-1) gives "e" which is not in any set -> default 3.75
    // Actually, we need to handle this: "Makefile".slice("Makefile".lastIndexOf("."))
    // lastIndexOf(".") = -1, so slice(-1) = "e". Not in any set -> default ratio
    expect(result).toBe(100); // 375 / 3.75 = 100
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `bun test tests/unit/token-estimate.test.ts`
Expected: All tests fail with module resolution errors (file does not exist yet).

- [ ] **Step 3: Implement token-estimate.ts**

Create `src/core/token-estimate.ts`:

```typescript
const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
  ".kt", ".scala", ".sh", ".bash", ".zsh", ".sql", ".graphql",
]);

const PROSE_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".rst", ".adoc", ".tex",
]);

export function estimateTokens(content: string, filePath: string): number {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  let ratio: number;
  if (CODE_EXTENSIONS.has(ext)) {
    ratio = 3.5;
  } else if (PROSE_EXTENSIONS.has(ext)) {
    ratio = 4.0;
  } else {
    ratio = 3.75;
  }
  return Math.ceil(content.length / ratio);
}
```

- [ ] **Step 4: Verify tests pass**

Run: `bun test tests/unit/token-estimate.test.ts`
Expected:
```
bun test v1.x.x
tests/unit/token-estimate.test.ts:
  estimateTokens
    ✓ uses code ratio (3.5) for .ts files
    ✓ uses code ratio (3.5) for .py files
    ✓ uses prose ratio (4.0) for .md files
    ✓ uses prose ratio (4.0) for .txt files
    ✓ uses default ratio (3.75) for unknown extensions
    ✓ rounds up to nearest integer
    ✓ returns 0 for empty content
    ✓ handles uppercase extensions
    ✓ handles .tsx as code
    ✓ handles .jsx as code
    ✓ handles .go as code
    ✓ handles .rs as code
    ✓ handles .mdx as prose
    ✓ handles file with no extension using default ratio

 14 pass
 0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/core/token-estimate.ts tests/unit/token-estimate.test.ts
git commit -m "feat: add token estimation with TDD

Pure function that estimates token count from file content length and
extension-based character-to-token ratio (code=3.5, prose=4.0, other=3.75)."
```

---

## Task 3: Description Extraction - Core Heuristics (TDD)

**Files:**
- Create: `tests/unit/description.test.ts`
- Create: `src/core/description.ts`

- [ ] **Step 1: Write tests for priorities 1-4, 6, 9, and edge cases**

Create `tests/unit/description.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { extractDescription } from "../../src/core/description";

describe("extractDescription", () => {
  describe("edge cases", () => {
    test("empty file returns filename with empty note", () => {
      const result = extractDescription("src/empty.ts", "");
      expect(result).toBe("empty.ts — empty file");
    });

    test("binary file returns filename with binary note", () => {
      const result = extractDescription("image.png", "PNG\0IHDR\0\0");
      expect(result).toBe("image.png — binary file");
    });

    test("truncates long descriptions to 100 chars", () => {
      const longLine = "a".repeat(200);
      const result = extractDescription("src/long.ts", longLine);
      expect(result.length).toBeLessThanOrEqual(100);
      expect(result).toEndWith("...");
    });

    test("large file adds (large file) suffix", () => {
      // 101KB of content
      const content = "export function bigFn() {}\n" + "x".repeat(101 * 1024);
      const result = extractDescription("src/big.ts", content);
      expect(result).toContain("(large file)");
    });
  });

  describe("priority 1: markdown heading", () => {
    test("extracts h1 from markdown", () => {
      const content = "# My Awesome Module\n\nSome content here.";
      const result = extractDescription("README.md", content);
      expect(result).toBe("My Awesome Module");
    });

    test("extracts h1 from mdx", () => {
      const content = "import X from 'y'\n\n# Component Guide\n\nText.";
      const result = extractDescription("guide.mdx", content);
      expect(result).toBe("Component Guide");
    });

    test("prefers h1 over other heuristics for .md files", () => {
      const content = "# Title\n\nexport function foo() {}";
      const result = extractDescription("doc.md", content);
      expect(result).toBe("Title");
    });
  });

  describe("priority 3: doc comment", () => {
    test("extracts JSDoc comment", () => {
      const content = `/**
 * Handles user authentication flows
 */
export function auth() {}`;
      const result = extractDescription("src/auth.ts", content);
      expect(result).toBe("Handles user authentication flows");
    });

    test("extracts shell comment after shebang", () => {
      const content = `#!/bin/bash
# Deploy script for production
set -e`;
      const result = extractDescription("deploy.sh", content);
      expect(result).toBe("Deploy script for production");
    });

    test("extracts top-of-file hash comment", () => {
      const content = `# Utility functions for string manipulation
def capitalize(s):
    return s.capitalize()`;
      const result = extractDescription("utils.py", content);
      expect(result).toBe("Utility functions for string manipulation");
    });
  });

  describe("priority 4: exports", () => {
    test("extracts exported function names", () => {
      const content = `export function createUser() {}
export function deleteUser() {}`;
      const result = extractDescription("src/users.ts", content);
      expect(result).toBe("exports: createUser, deleteUser");
    });

    test("extracts mixed export types", () => {
      const content = `export interface Config {}
export const DEFAULT_CONFIG = {};
export function loadConfig() {}`;
      const result = extractDescription("src/config.ts", content);
      expect(result).toBe("exports: Config, DEFAULT_CONFIG, loadConfig");
    });

    test("extracts exported class", () => {
      const content = `export class UserService {
  getUser() {}
}`;
      const result = extractDescription("src/user-service.ts", content);
      expect(result).toBe("exports: UserService");
    });

    test("extracts exported enum", () => {
      const content = `export enum Status {
  Active,
  Inactive,
}`;
      const result = extractDescription("src/status.ts", content);
      expect(result).toBe("exports: Status");
    });

    test("extracts exported type", () => {
      const content = `export type UserId = string;
export type UserName = string;`;
      const result = extractDescription("src/types.ts", content);
      expect(result).toBe("exports: UserId, UserName");
    });
  });

  describe("priority 6: known config files", () => {
    test("identifies package.json", () => {
      const content = `{ "name": "my-app", "version": "1.0.0" }`;
      const result = extractDescription("package.json", content);
      expect(result).toBe("Node.js package manifest");
    });

    test("identifies tsconfig.json", () => {
      const content = `{ "compilerOptions": {} }`;
      const result = extractDescription("tsconfig.json", content);
      expect(result).toBe("TypeScript configuration");
    });

    test("identifies Dockerfile", () => {
      const content = "FROM node:20\nRUN npm install";
      const result = extractDescription("Dockerfile", content);
      expect(result).toBe("Docker container definition");
    });

    test("identifies Cargo.toml", () => {
      const content = `[package]\nname = "my-crate"`;
      const result = extractDescription("Cargo.toml", content);
      expect(result).toBe("Rust package manifest");
    });

    test("identifies bunfig.toml", () => {
      const content = `[install]\noptional = true`;
      const result = extractDescription("bunfig.toml", content);
      expect(result).toBe("Bun configuration");
    });
  });

  describe("priority 9: fallback", () => {
    test("uses first non-comment line as fallback", () => {
      const content = `const x = 42;`;
      const result = extractDescription("src/mystery.dat", content);
      expect(result).toBe("const x = 42;");
    });

    test("skips comment lines for fallback", () => {
      const content = `// this is a comment
// another comment
const setup = true;`;
      // No exports, no doc comment (// is not doc comment), no config match
      const result = extractDescription("src/setup.xyz", content);
      expect(result).toBe("const setup = true;");
    });

    test("returns filename when no content matches", () => {
      const content = "// only comments\n# only comments";
      const result = extractDescription("src/empty-ish.xyz", content);
      // Both lines start with comment chars, fallback skips them
      // Final fallback is the filename
      expect(result).toBe("empty-ish.xyz");
    });
  });

  describe("priority ordering", () => {
    test("doc comment wins over exports when present", () => {
      const content = `/**
 * Authentication utilities
 */
export function login() {}
export function logout() {}`;
      const result = extractDescription("src/auth.ts", content);
      expect(result).toBe("Authentication utilities");
    });

    test("exports win over config description when file has exports", () => {
      // A file named like a config but with TS exports
      const content = `export function validate() {}`;
      const result = extractDescription("src/validate.ts", content);
      expect(result).toBe("exports: validate");
    });
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `bun test tests/unit/description.test.ts`
Expected: All tests fail with module resolution errors (file does not exist yet).

- [ ] **Step 3: Implement description.ts with priorities 1-4, 6, 9**

Create `src/core/description.ts`:

```typescript
import { basename, extname } from "path";

const MAX_DESCRIPTION_LENGTH = 100;

const CONFIG_DESCRIPTIONS: Record<string, string> = {
  "package.json": "Node.js package manifest",
  "tsconfig.json": "TypeScript configuration",
  "tsconfig.node.json": "TypeScript configuration (Node)",
  "tailwind.config.js": "Tailwind CSS configuration",
  "tailwind.config.ts": "Tailwind CSS configuration",
  "vite.config.js": "Vite build configuration",
  "vite.config.ts": "Vite build configuration",
  "next.config.js": "Next.js configuration",
  "next.config.ts": "Next.js configuration",
  "next.config.mjs": "Next.js configuration",
  "eslint.config.js": "ESLint configuration",
  "eslint.config.mjs": "ESLint configuration",
  ".eslintrc": "ESLint configuration",
  ".eslintrc.js": "ESLint configuration",
  ".eslintrc.json": "ESLint configuration",
  ".prettierrc": "Prettier configuration",
  ".prettierrc.json": "Prettier configuration",
  "prettier.config.js": "Prettier configuration",
  "Dockerfile": "Docker container definition",
  "docker-compose.yml": "Docker Compose services",
  "docker-compose.yaml": "Docker Compose services",
  "Makefile": "Make build targets",
  "CMakeLists.txt": "CMake build configuration",
  "Cargo.toml": "Rust package manifest",
  "go.mod": "Go module definition",
  "pyproject.toml": "Python project configuration",
  "setup.py": "Python package setup",
  "Gemfile": "Ruby dependency manifest",
  "composer.json": "PHP package manifest",
  "build.gradle": "Gradle build configuration",
  "pom.xml": "Maven build configuration",
  "bunfig.toml": "Bun configuration",
};

function truncate(str: string): string {
  if (str.length <= MAX_DESCRIPTION_LENGTH) return str;
  return str.slice(0, MAX_DESCRIPTION_LENGTH - 3) + "...";
}

function hasBinaryContent(content: string): boolean {
  return content.includes("\0");
}

function extractMarkdownHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractDocComment(content: string): string | null {
  // JSDoc / JavaDoc style: /** ... */
  const jsdoc = content.match(/^\/\*\*\s*\n?\s*\*?\s*(.+)/m);
  if (jsdoc) return jsdoc[1].replace(/\*\/\s*$/, "").trim();

  // Python docstring: """...""" or '''...'''
  const pydoc = content.match(/^(?:def |class ).*\n\s*(?:"""|''')(.+)/m);
  if (pydoc) return pydoc[1].trim();

  // Shell/Ruby/Python top-of-file comment block
  const lines = content.split("\n");
  if (lines[0]?.startsWith("#!")) {
    // Skip shebang, look at next comment
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
      const line = lines[i].trim();
      if (line.startsWith("# ") && line.length > 2) {
        return line.slice(2).trim();
      }
      if (line && !line.startsWith("#")) break;
    }
  } else if (lines[0]?.startsWith("# ") && lines[0].length > 2) {
    return lines[0].slice(2).trim();
  }

  return null;
}

function extractExports(content: string): string | null {
  const exports: string[] = [];
  const re = /export\s+(?:function|const|class|interface|type|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    exports.push(match[1]);
  }
  if (exports.length === 0) return null;
  return `exports: ${exports.join(", ")}`;
}

function extractFallback(content: string): string | null {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("#")) {
      return trimmed;
    }
  }
  return null;
}

export function extractDescription(filePath: string, content: string): string {
  const name = basename(filePath);
  const ext = extname(filePath).toLowerCase();

  // Edge cases first
  if (content.length === 0) return `${name} — empty file`;
  if (hasBinaryContent(content)) return `${name} — binary file`;

  let description: string | null = null;
  const isLargeFile = content.length > 100 * 1024;

  // Priority 1: Markdown heading
  if ([".md", ".mdx"].includes(ext)) {
    description = extractMarkdownHeading(content);
  }

  // Priority 3: Doc comment
  if (!description) {
    description = extractDocComment(content);
  }

  // Priority 4: Exports
  if (!description) {
    description = extractExports(content);
  }

  // Priority 6: Known config file
  if (!description) {
    const configDesc = CONFIG_DESCRIPTIONS[name];
    if (configDesc) description = configDesc;
  }

  // Priority 9: Fallback
  if (!description) {
    description = extractFallback(content);
  }

  // Final fallback
  if (!description) {
    description = name;
  }

  if (isLargeFile) {
    description = truncate(description + " (large file)");
  } else {
    description = truncate(description);
  }

  return description;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `bun test tests/unit/description.test.ts`
Expected:
```
bun test v1.x.x
tests/unit/description.test.ts:
  extractDescription
    edge cases
      ✓ empty file returns filename with empty note
      ✓ binary file returns filename with binary note
      ✓ truncates long descriptions to 100 chars
      ✓ large file adds (large file) suffix
    priority 1: markdown heading
      ✓ extracts h1 from markdown
      ✓ extracts h1 from mdx
      ✓ prefers h1 over other heuristics for .md files
    priority 3: doc comment
      ✓ extracts JSDoc comment
      ✓ extracts shell comment after shebang
      ✓ extracts top-of-file hash comment
    priority 4: exports
      ✓ extracts exported function names
      ✓ extracts mixed export types
      ✓ extracts exported class
      ✓ extracts exported enum
      ✓ extracts exported type
    priority 6: known config files
      ✓ identifies package.json
      ✓ identifies tsconfig.json
      ✓ identifies Dockerfile
      ✓ identifies Cargo.toml
      ✓ identifies bunfig.toml
    priority 9: fallback
      ✓ uses first non-comment line as fallback
      ✓ skips comment lines for fallback
      ✓ returns filename when no content matches
    priority ordering
      ✓ doc comment wins over exports when present
      ✓ exports win over config description when file has exports

 25 pass
 0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/core/description.ts tests/unit/description.test.ts
git commit -m "feat: add description extraction with core heuristics (TDD)

Implements priority chain: markdown heading, doc comment, exports,
known config files, and first-line fallback. Truncates at 100 chars."
```

---

## Task 4: Description Extraction - Component, CI, Migration (TDD)

**Files:**
- Modify: `tests/unit/description.test.ts`
- Modify: `src/core/description.ts`

- [ ] **Step 1: Add tests for priorities 2, 5, 7, 8 to the existing test file**

Append the following `describe` blocks inside the outer `describe("extractDescription", ...)` in `tests/unit/description.test.ts`, after the `"priority ordering"` block:

```typescript
  describe("priority 2: HTML title", () => {
    test("extracts title from HTML file", () => {
      const content = `<!DOCTYPE html>
<html>
<head><title>My App Dashboard</title></head>
<body></body>
</html>`;
      const result = extractDescription("index.html", content);
      expect(result).toBe("My App Dashboard");
    });

    test("extracts title from htm file", () => {
      const content = `<html><head><title>Legacy Page</title></head></html>`;
      const result = extractDescription("page.htm", content);
      expect(result).toBe("Legacy Page");
    });
  });

  describe("priority 5: component with elements", () => {
    test("detects form in tsx component", () => {
      const content = `export default function LoginForm() {
  return <form><input type="text" /></form>;
}`;
      const result = extractDescription("LoginForm.tsx", content);
      expect(result).toBe("LoginForm — renders form, inputs");
    });

    test("detects table in jsx component", () => {
      const content = `export function DataTable() {
  return <table><tr><td>data</td></tr></table>;
}`;
      const result = extractDescription("DataTable.jsx", content);
      expect(result).toBe("DataTable — renders table");
    });

    test("detects modal in tsx component", () => {
      const content = `export const ConfirmModal = () => {
  return <div className="modal">Confirm?</div>;
}`;
      const result = extractDescription("ConfirmModal.tsx", content);
      expect(result).toBe("ConfirmModal — renders modal");
    });

    test("detects list elements", () => {
      const content = `export function NavMenu() {
  return <ul><li>Home</li><li>About</li></ul>;
}`;
      const result = extractDescription("NavMenu.tsx", content);
      expect(result).toBe("NavMenu — renders list");
    });

    test("uses basename when no named export found", () => {
      const content = `const x = () => <form><input /></form>;
export default x;`;
      const result = extractDescription("ContactForm.tsx", content);
      expect(result).toBe("ContactForm — renders form, inputs");
    });

    test("does not trigger for non-component extensions", () => {
      const content = `export function handler() { return "<form></form>"; }`;
      const result = extractDescription("handler.ts", content);
      // Should use exports priority, not component
      expect(result).toBe("exports: handler");
    });
  });

  describe("priority 7: CI/CD workflows", () => {
    test("extracts workflow name from GitHub Actions", () => {
      const content = `name: Build and Deploy
on: push
jobs:
  build:
    runs-on: ubuntu-latest`;
      const result = extractDescription(
        ".github/workflows/deploy.yml",
        content
      );
      expect(result).toBe("CI: Build and Deploy");
    });

    test("uses filename when no name field", () => {
      const content = `on: push
jobs:
  test:
    runs-on: ubuntu-latest`;
      const result = extractDescription(
        ".github/workflows/ci.yml",
        content
      );
      expect(result).toBe("CI: ci.yml");
    });

    test("detects GitLab CI file", () => {
      const content = `stages:
  - build
  - test`;
      const result = extractDescription(".gitlab-ci.yml", content);
      expect(result).toBe("CI: .gitlab-ci.yml");
    });

    test("detects Jenkinsfile", () => {
      const content = `pipeline {
  agent any
  stages {
    stage('Build') { steps { sh 'make' } }
  }
}`;
      const result = extractDescription("Jenkinsfile", content);
      expect(result).toBe("CI: Jenkinsfile");
    });
  });

  describe("priority 8: migrations", () => {
    test("extracts table name from CREATE TABLE", () => {
      const content = `CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);`;
      const result = extractDescription(
        "db/migrations/001_create_users.sql",
        content
      );
      expect(result).toBe("migration: create users");
    });

    test("uses filename when no CREATE TABLE found", () => {
      const content = `ALTER TABLE users ADD COLUMN email TEXT;`;
      const result = extractDescription(
        "db/migrations/002_add_email.sql",
        content
      );
      expect(result).toBe("migration: 002_add_email.sql");
    });

    test("detects migration in path with migrate keyword", () => {
      const content = `CREATE TABLE posts (id INT);`;
      const result = extractDescription(
        "src/migrate/003_posts.sql",
        content
      );
      expect(result).toBe("migration: create posts");
    });
  });
```

- [ ] **Step 2: Verify new tests fail**

Run: `bun test tests/unit/description.test.ts`
Expected: The newly added tests for priorities 2, 5, 7, 8 fail because those extraction functions are not yet implemented.

- [ ] **Step 3: Add priority 2 (HTML title) to description.ts**

Add the `extractHtmlTitle` function after `extractMarkdownHeading`:

```typescript
function extractHtmlTitle(content: string): string | null {
  const match = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}
```

Add priority 2 check in `extractDescription`, after the priority 1 block:

```typescript
  // Priority 2: HTML title
  if (!description && [".html", ".htm"].includes(ext)) {
    description = extractHtmlTitle(content);
  }
```

- [ ] **Step 4: Add priority 5 (component detection) to description.ts**

Add the `extractComponent` function after `extractExports`:

```typescript
function extractComponent(content: string, filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  if (![".tsx", ".jsx", ".vue", ".svelte"].includes(ext)) return null;

  const nameMatch = content.match(
    /(?:export\s+(?:default\s+)?function|const)\s+(\w+)/
  );
  const componentName = nameMatch ? nameMatch[1] : basename(filePath, ext);

  const elements: string[] = [];
  if (/<form[\s>]/i.test(content)) elements.push("form");
  if (/<table[\s>]/i.test(content)) elements.push("table");
  if (/modal/i.test(content)) elements.push("modal");
  if (/<ul[\s>]|<ol[\s>]|<li[\s>]/i.test(content)) elements.push("list");
  if (/<input[\s>]|<textarea[\s>]|<select[\s>]/i.test(content))
    elements.push("inputs");

  if (elements.length === 0) return null;
  return `${componentName} — renders ${elements.join(", ")}`;
}
```

Add priority 5 check in `extractDescription`, after the priority 4 block:

```typescript
  // Priority 5: Component with elements
  if (!description) {
    description = extractComponent(content, filePath);
  }
```

- [ ] **Step 5: Add priority 7 (CI/CD) to description.ts**

Add the `extractCiWorkflow` function after `extractComponent`:

```typescript
function extractCiWorkflow(content: string, filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const isCi =
    normalized.includes(".github/workflows/") ||
    normalized.includes(".gitlab-ci") ||
    basename(filePath).toLowerCase() === "jenkinsfile";
  if (!isCi) return null;

  const nameMatch = content.match(/^name:\s*(.+)$/m);
  if (nameMatch) return `CI: ${nameMatch[1].trim()}`;
  return `CI: ${basename(filePath)}`;
}
```

Add priority 7 check in `extractDescription`, after the priority 6 block:

```typescript
  // Priority 7: CI/CD
  if (!description) {
    description = extractCiWorkflow(content, filePath);
  }
```

- [ ] **Step 6: Add priority 8 (migration) to description.ts**

Add the `extractMigration` function after `extractCiWorkflow`:

```typescript
function extractMigration(content: string, filePath: string): string | null {
  const normalized = filePath.toLowerCase();
  const isMigration =
    normalized.includes("migration") || normalized.includes("migrate");
  if (!isMigration) return null;

  const tableMatch = content.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/i
  );
  if (tableMatch) return `migration: create ${tableMatch[1]}`;
  return `migration: ${basename(filePath)}`;
}
```

Add priority 8 check in `extractDescription`, after the priority 7 block:

```typescript
  // Priority 8: Migration
  if (!description) {
    description = extractMigration(content, filePath);
  }
```

- [ ] **Step 7: Verify all tests pass**

Run: `bun test tests/unit/description.test.ts`
Expected:
```
bun test v1.x.x
tests/unit/description.test.ts:
  extractDescription
    edge cases
      ✓ empty file returns filename with empty note
      ✓ binary file returns filename with binary note
      ✓ truncates long descriptions to 100 chars
      ✓ large file adds (large file) suffix
    priority 1: markdown heading
      ✓ extracts h1 from markdown
      ✓ extracts h1 from mdx
      ✓ prefers h1 over other heuristics for .md files
    priority 2: HTML title
      ✓ extracts title from HTML file
      ✓ extracts title from htm file
    priority 3: doc comment
      ✓ extracts JSDoc comment
      ✓ extracts shell comment after shebang
      ✓ extracts top-of-file hash comment
    priority 4: exports
      ✓ extracts exported function names
      ✓ extracts mixed export types
      ✓ extracts exported class
      ✓ extracts exported enum
      ✓ extracts exported type
    priority 5: component with elements
      ✓ detects form in tsx component
      ✓ detects table in jsx component
      ✓ detects modal in tsx component
      ✓ detects list elements
      ✓ uses basename when no named export found
      ✓ does not trigger for non-component extensions
    priority 6: known config files
      ✓ identifies package.json
      ✓ identifies tsconfig.json
      ✓ identifies Dockerfile
      ✓ identifies Cargo.toml
      ✓ identifies bunfig.toml
    priority 7: CI/CD workflows
      ✓ extracts workflow name from GitHub Actions
      ✓ uses filename when no name field
      ✓ detects GitLab CI file
      ✓ detects Jenkinsfile
    priority 8: migrations
      ✓ extracts table name from CREATE TABLE
      ✓ uses filename when no CREATE TABLE found
      ✓ detects migration in path with migrate keyword
    priority 9: fallback
      ✓ uses first non-comment line as fallback
      ✓ skips comment lines for fallback
      ✓ returns filename when no content matches
    priority ordering
      ✓ doc comment wins over exports when present
      ✓ exports win over config description when file has exports

 38 pass
 0 fail
```

- [ ] **Step 8: Commit**

```bash
git add src/core/description.ts tests/unit/description.test.ts
git commit -m "feat: add component, CI, and migration description heuristics

Complete the priority chain with HTML title extraction (priority 2),
component element detection for TSX/JSX (priority 5), CI workflow name
extraction (priority 7), and migration table detection (priority 8)."
```

---

## Task 5: Path Extensions

**Files:**
- Modify: `src/core/paths.ts`

- [ ] **Step 1: Add fileIndexPath and configPath to paths.ts**

Add the following two functions to the end of `src/core/paths.ts`, after the `sessionPath` function:

```typescript
export function fileIndexPath(cwd: string): string {
  return join(projectDir(cwd), "file-index.json");
}

export function configPath(cwd: string): string {
  return join(projectDir(cwd), "config.json");
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `bun test`
Expected: All existing tests pass (no regressions).

- [ ] **Step 4: Commit**

```bash
git add src/core/paths.ts
git commit -m "feat: add fileIndexPath and configPath to paths module

Extend the paths module with helpers that resolve file-index.json and
config.json under the project state directory."
```

---

## Task 6: Scanner (TDD)

**Files:**
- Create: `tests/unit/scanner.test.ts`
- Create: `src/core/scanner.ts`

- [ ] **Step 1: Write tests first**

Create `tests/unit/scanner.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanProject,
  getExcludes,
  loadConfig,
  DEFAULT_EXCLUDES,
} from "../../src/core/scanner";
import { atomicWriteJson } from "../../src/core/fs-utils";

describe("scanner", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-scanner-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("DEFAULT_EXCLUDES", () => {
    test("includes node_modules", () => {
      expect(DEFAULT_EXCLUDES).toContain("node_modules");
    });

    test("includes .git", () => {
      expect(DEFAULT_EXCLUDES).toContain(".git");
    });

    test("includes .mink", () => {
      expect(DEFAULT_EXCLUDES).toContain(".mink");
    });

    test("includes lock files", () => {
      expect(DEFAULT_EXCLUDES).toContain("package-lock.json");
      expect(DEFAULT_EXCLUDES).toContain("bun.lock");
      expect(DEFAULT_EXCLUDES).toContain("yarn.lock");
    });

    test("includes binary extensions", () => {
      expect(DEFAULT_EXCLUDES).toContain("*.png");
      expect(DEFAULT_EXCLUDES).toContain("*.jpg");
    });
  });

  describe("loadConfig", () => {
    test("returns empty object for missing config", () => {
      const config = loadConfig(join(dir, "nonexistent.json"));
      expect(config).toEqual({});
    });

    test("returns parsed config from valid JSON", () => {
      const cfgPath = join(dir, "config.json");
      atomicWriteJson(cfgPath, {
        excludePatterns: ["*.log"],
        maxFiles: 100,
      });
      const config = loadConfig(cfgPath);
      expect(config.excludePatterns).toEqual(["*.log"]);
      expect(config.maxFiles).toBe(100);
    });

    test("returns empty object for invalid JSON", () => {
      const cfgPath = join(dir, "config.json");
      writeFileSync(cfgPath, "not json");
      const config = loadConfig(cfgPath);
      expect(config).toEqual({});
    });
  });

  describe("getExcludes", () => {
    test("returns default excludes when no custom patterns", () => {
      const excludes = getExcludes({});
      expect(excludes).toEqual(DEFAULT_EXCLUDES);
    });

    test("merges custom patterns with defaults", () => {
      const excludes = getExcludes({ excludePatterns: ["*.log", "tmp"] });
      expect(excludes).toContain("*.log");
      expect(excludes).toContain("tmp");
      expect(excludes).toContain("node_modules");
    });
  });

  describe("scanProject", () => {
    test("finds files in project root", () => {
      writeFileSync(join(dir, "index.ts"), "export default {};");
      writeFileSync(join(dir, "util.ts"), "export const x = 1;");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain("index.ts");
      expect(paths).toContain("util.ts");
    });

    test("finds files in subdirectories", () => {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "const app = true;");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain(join("src", "app.ts"));
    });

    test("excludes node_modules directory", () => {
      mkdirSync(join(dir, "node_modules", "foo"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "foo", "index.js"), "module.exports = {};");
      writeFileSync(join(dir, "app.ts"), "export {};");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).not.toContain(join("node_modules", "foo", "index.js"));
      expect(paths).toContain("app.ts");
    });

    test("excludes files matching glob patterns", () => {
      writeFileSync(join(dir, "app.min.js"), "minified");
      writeFileSync(join(dir, "app.ts"), "source");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).not.toContain("app.min.js");
      expect(paths).toContain("app.ts");
    });

    test("excludes .env files", () => {
      writeFileSync(join(dir, ".env"), "SECRET=123");
      writeFileSync(join(dir, ".env.local"), "LOCAL=456");
      writeFileSync(join(dir, "app.ts"), "export {};");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).not.toContain(".env");
      expect(paths).not.toContain(".env.local");
    });

    test("respects maxFiles limit", () => {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(dir, `file${i}.ts`), `export const x${i} = ${i};`);
      }

      const results = scanProject(dir, DEFAULT_EXCLUDES, 5);
      expect(results).toHaveLength(5);
    });

    test("sorts by mtime descending (newest first)", () => {
      // Create files with a slight delay to ensure different mtimes
      writeFileSync(join(dir, "old.ts"), "old");
      writeFileSync(join(dir, "new.ts"), "new");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      // Both files should be present; newest mtime should be first
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].mtimeMs).toBeGreaterThanOrEqual(results[1].mtimeMs);
    });

    test("skips symlinks", () => {
      writeFileSync(join(dir, "real.ts"), "real content");
      try {
        symlinkSync(join(dir, "real.ts"), join(dir, "link.ts"));
      } catch {
        // Symlinks may not be supported on all platforms
        return;
      }

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain("real.ts");
      expect(paths).not.toContain("link.ts");
    });

    test("returns relative paths", () => {
      mkdirSync(join(dir, "src", "utils"), { recursive: true });
      writeFileSync(join(dir, "src", "utils", "helper.ts"), "export {};");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain(join("src", "utils", "helper.ts"));
      // Ensure no absolute paths
      for (const p of paths) {
        expect(p.startsWith("/")).toBe(false);
      }
    });

    test("includes mtimeMs for each file", () => {
      writeFileSync(join(dir, "test.ts"), "export {};");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      expect(results[0].mtimeMs).toBeGreaterThan(0);
    });

    test("handles empty project directory", () => {
      const results = scanProject(dir, DEFAULT_EXCLUDES);
      expect(results).toHaveLength(0);
    });

    test("applies custom exclude patterns", () => {
      writeFileSync(join(dir, "app.ts"), "export {};");
      writeFileSync(join(dir, "debug.log"), "log data");

      const excludes = [...DEFAULT_EXCLUDES, "*.log"];
      const results = scanProject(dir, excludes);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain("app.ts");
      expect(paths).not.toContain("debug.log");
    });
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `bun test tests/unit/scanner.test.ts`
Expected: All tests fail with module resolution errors (file does not exist yet).

- [ ] **Step 3: Implement scanner.ts**

Create `src/core/scanner.ts`:

```typescript
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";
import type { ScannedFile, ProjectConfig } from "../types/file-index";
import { safeReadJson } from "./fs-utils";

export const DEFAULT_EXCLUDES: string[] = [
  "node_modules", "vendor", ".venv", "venv", "__pycache__",
  "bower_components", ".yarn", ".pnp",
  "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".vercel", ".output",
  "coverage", ".nyc_output",
  ".git", ".hg", ".svn",
  "package-lock.json", "bun.lock", "yarn.lock",
  "pnpm-lock.yaml", "Gemfile.lock", "poetry.lock", "composer.lock",
  "*.min.js", "*.min.css", "*.map",
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico",
  "*.woff", "*.woff2", "*.ttf", "*.eot",
  "*.mp3", "*.mp4", "*.webm", "*.zip", "*.tar", "*.gz",
  "*.pdf", "*.exe", "*.dll", "*.so", "*.dylib",
  ".env", ".env.*",
  ".mink",
];

const DEFAULT_MAX_FILES = 500;

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    // Glob: *.min.js -> match against basename
    const regex = new RegExp(
      "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
    );
    return regex.test(name);
  }
  // Exact match against name
  return name === pattern;
}

function isExcluded(name: string, excludes: string[]): boolean {
  return excludes.some((pattern) => matchesPattern(name, pattern));
}

function walkDirectory(
  dir: string,
  projectRoot: string,
  excludes: string[],
  results: ScannedFile[]
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or other error — skip
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      if (isExcluded(entry.name, excludes)) continue;
      walkDirectory(join(dir, entry.name), projectRoot, excludes, results);
      continue;
    }

    if (entry.isFile()) {
      if (isExcluded(entry.name, excludes)) continue;
      try {
        const fullPath = join(dir, entry.name);
        const stat = statSync(fullPath);
        results.push({
          relativePath: relative(projectRoot, fullPath),
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // stat failed — skip
      }
    }
  }
}

export function loadConfig(configPath: string): ProjectConfig {
  const raw = safeReadJson(configPath);
  if (raw && typeof raw === "object") return raw as ProjectConfig;
  return {};
}

export function getExcludes(config: ProjectConfig): string[] {
  return [...DEFAULT_EXCLUDES, ...(config.excludePatterns ?? [])];
}

export function scanProject(
  projectRoot: string,
  excludes: string[],
  maxFiles: number = DEFAULT_MAX_FILES
): ScannedFile[] {
  const results: ScannedFile[] = [];
  walkDirectory(projectRoot, projectRoot, excludes, results);
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return results.slice(0, maxFiles);
}
```

- [ ] **Step 4: Verify tests pass**

Run: `bun test tests/unit/scanner.test.ts`
Expected:
```
bun test v1.x.x
tests/unit/scanner.test.ts:
  scanner
    DEFAULT_EXCLUDES
      ✓ includes node_modules
      ✓ includes .git
      ✓ includes .mink
      ✓ includes lock files
      ✓ includes binary extensions
    loadConfig
      ✓ returns empty object for missing config
      ✓ returns parsed config from valid JSON
      ✓ returns empty object for invalid JSON
    getExcludes
      ✓ returns default excludes when no custom patterns
      ✓ merges custom patterns with defaults
    scanProject
      ✓ finds files in project root
      ✓ finds files in subdirectories
      ✓ excludes node_modules directory
      ✓ excludes files matching glob patterns
      ✓ excludes .env files
      ✓ respects maxFiles limit
      ✓ sorts by mtime descending (newest first)
      ✓ skips symlinks
      ✓ returns relative paths
      ✓ includes mtimeMs for each file
      ✓ handles empty project directory
      ✓ applies custom exclude patterns

 22 pass
 0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/core/scanner.ts tests/unit/scanner.test.ts
git commit -m "feat: add filesystem scanner with exclude filtering (TDD)

Walk the project tree respecting configurable exclude patterns for
directories, filenames, and glob extensions. Sort by mtime descending
and cap at maxFiles (default 500)."
```

---

## Task 7: Index Store (TDD)

**Files:**
- Create: `tests/unit/index-store.test.ts`
- Create: `src/core/index-store.ts`

- [ ] **Step 1: Write tests first**

Create `tests/unit/index-store.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import {
  createEmptyIndex,
  isFileIndex,
  upsertEntry,
  removeEntry,
  lookupEntry,
  recordHit,
  recordMiss,
  checkStaleness,
} from "../../src/core/index-store";
import type { FileIndex, FileIndexEntry } from "../../src/types/file-index";

function makeEntry(filePath: string): FileIndexEntry {
  return {
    filePath,
    description: `Description for ${filePath}`,
    estimatedTokens: 100,
    lastModified: "2026-01-01T00:00:00.000Z",
    lastIndexed: "2026-01-01T00:00:00.000Z",
  };
}

describe("index-store", () => {
  describe("createEmptyIndex", () => {
    test("returns empty header with zero counters", () => {
      const index = createEmptyIndex();
      expect(index.header.lastScanTimestamp).toBe("");
      expect(index.header.totalFiles).toBe(0);
      expect(index.header.lifetimeHits).toBe(0);
      expect(index.header.lifetimeMisses).toBe(0);
    });

    test("returns empty entries object", () => {
      const index = createEmptyIndex();
      expect(Object.keys(index.entries)).toHaveLength(0);
    });
  });

  describe("isFileIndex", () => {
    test("returns true for valid index", () => {
      const index = createEmptyIndex();
      expect(isFileIndex(index)).toBe(true);
    });

    test("returns false for null", () => {
      expect(isFileIndex(null)).toBe(false);
    });

    test("returns false for undefined", () => {
      expect(isFileIndex(undefined)).toBe(false);
    });

    test("returns false for string", () => {
      expect(isFileIndex("not an index")).toBe(false);
    });

    test("returns false for object without header", () => {
      expect(isFileIndex({ entries: {} })).toBe(false);
    });

    test("returns false for object without entries", () => {
      expect(isFileIndex({ header: {} })).toBe(false);
    });

    test("returns false for object with null header", () => {
      expect(isFileIndex({ header: null, entries: {} })).toBe(false);
    });

    test("returns true for index with populated entries", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("src/app.ts"));
      expect(isFileIndex(index)).toBe(true);
    });
  });

  describe("upsertEntry", () => {
    test("adds new entry to empty index", () => {
      const index = createEmptyIndex();
      const entry = makeEntry("src/app.ts");
      upsertEntry(index, entry);

      expect(index.entries["src/app.ts"]).toEqual(entry);
      expect(index.header.totalFiles).toBe(1);
    });

    test("updates existing entry", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("src/app.ts"));

      const updated: FileIndexEntry = {
        filePath: "src/app.ts",
        description: "Updated description",
        estimatedTokens: 200,
        lastModified: "2026-06-01T00:00:00.000Z",
        lastIndexed: "2026-06-01T00:00:00.000Z",
      };
      upsertEntry(index, updated);

      expect(index.entries["src/app.ts"].description).toBe("Updated description");
      expect(index.entries["src/app.ts"].estimatedTokens).toBe(200);
      expect(index.header.totalFiles).toBe(1);
    });

    test("increments totalFiles for new entries", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("b.ts"));
      upsertEntry(index, makeEntry("c.ts"));

      expect(index.header.totalFiles).toBe(3);
    });
  });

  describe("removeEntry", () => {
    test("removes existing entry", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("src/app.ts"));
      removeEntry(index, "src/app.ts");

      expect(index.entries["src/app.ts"]).toBeUndefined();
      expect(index.header.totalFiles).toBe(0);
    });

    test("no-ops for non-existent entry", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("src/app.ts"));
      removeEntry(index, "src/other.ts");

      expect(index.header.totalFiles).toBe(1);
    });

    test("decrements totalFiles", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("b.ts"));
      removeEntry(index, "a.ts");

      expect(index.header.totalFiles).toBe(1);
    });
  });

  describe("lookupEntry", () => {
    test("returns entry when found", () => {
      const index = createEmptyIndex();
      const entry = makeEntry("src/app.ts");
      upsertEntry(index, entry);

      const result = lookupEntry(index, "src/app.ts");
      expect(result).toEqual(entry);
    });

    test("returns null when not found", () => {
      const index = createEmptyIndex();
      const result = lookupEntry(index, "src/missing.ts");
      expect(result).toBeNull();
    });
  });

  describe("recordHit", () => {
    test("increments lifetimeHits", () => {
      const index = createEmptyIndex();
      recordHit(index);
      recordHit(index);
      recordHit(index);

      expect(index.header.lifetimeHits).toBe(3);
    });
  });

  describe("recordMiss", () => {
    test("increments lifetimeMisses", () => {
      const index = createEmptyIndex();
      recordMiss(index);
      recordMiss(index);

      expect(index.header.lifetimeMisses).toBe(2);
    });
  });

  describe("checkStaleness", () => {
    test("reports no staleness when index matches scanned files", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("b.ts"));

      const report = checkStaleness(index, ["a.ts", "b.ts"]);
      expect(report.isStale).toBe(false);
      expect(report.missingFromIndex).toHaveLength(0);
      expect(report.orphanedEntries).toHaveLength(0);
    });

    test("detects files missing from index", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));

      const report = checkStaleness(index, ["a.ts", "b.ts", "c.ts"]);
      expect(report.isStale).toBe(true);
      expect(report.missingFromIndex).toEqual(["b.ts", "c.ts"]);
      expect(report.orphanedEntries).toHaveLength(0);
    });

    test("detects orphaned entries", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("deleted.ts"));

      const report = checkStaleness(index, ["a.ts"]);
      expect(report.isStale).toBe(true);
      expect(report.missingFromIndex).toHaveLength(0);
      expect(report.orphanedEntries).toEqual(["deleted.ts"]);
    });

    test("detects both missing and orphaned simultaneously", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("old.ts"));

      const report = checkStaleness(index, ["new.ts"]);
      expect(report.isStale).toBe(true);
      expect(report.missingFromIndex).toEqual(["new.ts"]);
      expect(report.orphanedEntries).toEqual(["old.ts"]);
    });

    test("empty index with scanned files reports all missing", () => {
      const index = createEmptyIndex();

      const report = checkStaleness(index, ["a.ts", "b.ts"]);
      expect(report.isStale).toBe(true);
      expect(report.missingFromIndex).toEqual(["a.ts", "b.ts"]);
    });

    test("populated index with no scanned files reports all orphaned", () => {
      const index = createEmptyIndex();
      upsertEntry(index, makeEntry("a.ts"));
      upsertEntry(index, makeEntry("b.ts"));

      const report = checkStaleness(index, []);
      expect(report.isStale).toBe(true);
      expect(report.orphanedEntries).toContain("a.ts");
      expect(report.orphanedEntries).toContain("b.ts");
    });

    test("both empty returns not stale", () => {
      const index = createEmptyIndex();
      const report = checkStaleness(index, []);
      expect(report.isStale).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `bun test tests/unit/index-store.test.ts`
Expected: All tests fail with module resolution errors (file does not exist yet).

- [ ] **Step 3: Implement index-store.ts**

Create `src/core/index-store.ts`:

```typescript
import type {
  FileIndex,
  FileIndexEntry,
  StalenessReport,
} from "../types/file-index";

export function createEmptyIndex(): FileIndex {
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

export function isFileIndex(value: unknown): value is FileIndex {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.header === "object" &&
    obj.header !== null &&
    typeof obj.entries === "object" &&
    obj.entries !== null
  );
}

export function upsertEntry(index: FileIndex, entry: FileIndexEntry): void {
  index.entries[entry.filePath] = entry;
  index.header.totalFiles = Object.keys(index.entries).length;
}

export function removeEntry(index: FileIndex, filePath: string): void {
  delete index.entries[filePath];
  index.header.totalFiles = Object.keys(index.entries).length;
}

export function lookupEntry(
  index: FileIndex,
  filePath: string
): FileIndexEntry | null {
  return index.entries[filePath] ?? null;
}

export function recordHit(index: FileIndex): void {
  index.header.lifetimeHits++;
}

export function recordMiss(index: FileIndex): void {
  index.header.lifetimeMisses++;
}

export function checkStaleness(
  index: FileIndex,
  scannedFiles: string[]
): StalenessReport {
  const scannedSet = new Set(scannedFiles);
  const indexedSet = new Set(Object.keys(index.entries));

  const missingFromIndex = scannedFiles.filter((f) => !indexedSet.has(f));
  const orphanedEntries = Object.keys(index.entries).filter(
    (f) => !scannedSet.has(f)
  );

  return {
    missingFromIndex,
    orphanedEntries,
    isStale: missingFromIndex.length > 0 || orphanedEntries.length > 0,
  };
}
```

- [ ] **Step 4: Verify tests pass**

Run: `bun test tests/unit/index-store.test.ts`
Expected:
```
bun test v1.x.x
tests/unit/index-store.test.ts:
  index-store
    createEmptyIndex
      ✓ returns empty header with zero counters
      ✓ returns empty entries object
    isFileIndex
      ✓ returns true for valid index
      ✓ returns false for null
      ✓ returns false for undefined
      ✓ returns false for string
      ✓ returns false for object without header
      ✓ returns false for object without entries
      ✓ returns false for object with null header
      ✓ returns true for index with populated entries
    upsertEntry
      ✓ adds new entry to empty index
      ✓ updates existing entry
      ✓ increments totalFiles for new entries
    removeEntry
      ✓ removes existing entry
      ✓ no-ops for non-existent entry
      ✓ decrements totalFiles
    lookupEntry
      ✓ returns entry when found
      ✓ returns null when not found
    recordHit
      ✓ increments lifetimeHits
    recordMiss
      ✓ increments lifetimeMisses
    checkStaleness
      ✓ reports no staleness when index matches scanned files
      ✓ detects files missing from index
      ✓ detects orphaned entries
      ✓ detects both missing and orphaned simultaneously
      ✓ empty index with scanned files reports all missing
      ✓ populated index with no scanned files reports all orphaned
      ✓ both empty returns not stale

 27 pass
 0 fail
```

- [ ] **Step 5: Commit**

```bash
git add src/core/index-store.ts tests/unit/index-store.test.ts
git commit -m "feat: add index store with CRUD and staleness detection (TDD)

In-memory operations for file index: create, upsert, remove, lookup,
hit/miss counters, and staleness check comparing index against scanned
file list to find missing and orphaned entries."
```

---

## Task 8: Scan Command

**Files:**
- Create: `src/commands/scan.ts`

- [ ] **Step 1: Create scan.ts**

Create `src/commands/scan.ts`:

```typescript
import { readFileSync } from "fs";
import { join } from "path";
import { fileIndexPath, configPath } from "../core/paths";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";
import { scanProject, loadConfig, getExcludes } from "../core/scanner";
import { extractDescription } from "../core/description";
import { estimateTokens } from "../core/token-estimate";
import {
  createEmptyIndex,
  isFileIndex,
  upsertEntry,
  checkStaleness,
} from "../core/index-store";
import type { FileIndex, FileIndexEntry } from "../types/file-index";

function loadExistingIndex(indexPath: string): FileIndex {
  const raw = safeReadJson(indexPath);
  if (isFileIndex(raw)) return raw;
  if (raw !== null) {
    console.error("[mink] file-index.json is corrupt — starting fresh");
  }
  return createEmptyIndex();
}

export function scan(cwd: string, options: { check: boolean }): void {
  const idxPath = fileIndexPath(cwd);
  const cfgPath = configPath(cwd);
  const config = loadConfig(cfgPath);
  const excludes = getExcludes(config);
  const maxFiles = config.maxFiles ?? 500;

  if (options.check) {
    const existing = safeReadJson(idxPath);
    if (!isFileIndex(existing)) {
      console.error("[mink] no index found — run mink scan first");
      process.exit(1);
    }

    const scanned = scanProject(cwd, excludes, maxFiles);
    const scannedPaths = scanned.map((f) => f.relativePath);
    const report = checkStaleness(existing, scannedPaths);

    if (!report.isStale) {
      console.log("[mink] index is up to date");
      return;
    }

    if (report.missingFromIndex.length > 0) {
      console.log(`Missing from index (${report.missingFromIndex.length}):`);
      for (const f of report.missingFromIndex) {
        console.log(`  + ${f}`);
      }
    }
    if (report.orphanedEntries.length > 0) {
      console.log(`Orphaned entries (${report.orphanedEntries.length}):`);
      for (const f of report.orphanedEntries) {
        console.log(`  - ${f}`);
      }
    }
    process.exit(1);
  }

  // Full scan
  const start = Date.now();
  const index = loadExistingIndex(idxPath);

  const scanned = scanProject(cwd, excludes, maxFiles);

  // Build new entries, preserving lifetime counters
  const newIndex = createEmptyIndex();
  newIndex.header.lifetimeHits = index.header.lifetimeHits;
  newIndex.header.lifetimeMisses = index.header.lifetimeMisses;

  for (const file of scanned) {
    const fullPath = join(cwd, file.relativePath);
    let content: string;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue; // Skip unreadable files
    }

    const entry: FileIndexEntry = {
      filePath: file.relativePath,
      description: extractDescription(file.relativePath, content),
      estimatedTokens: estimateTokens(content, file.relativePath),
      lastModified: new Date(file.mtimeMs).toISOString(),
      lastIndexed: new Date().toISOString(),
    };
    upsertEntry(newIndex, entry);
  }

  newIndex.header.lastScanTimestamp = new Date().toISOString();

  atomicWriteJson(idxPath, newIndex);

  const elapsed = Date.now() - start;
  console.log(
    `[mink] indexed ${newIndex.header.totalFiles} files in ${elapsed}ms`
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/scan.ts
git commit -m "feat: add scan command for full index rebuild and staleness check

Orchestrates scanner, description extraction, and token estimation into
a complete file-index.json. Supports --check mode for staleness reporting
without mutation. Preserves lifetime hit/miss counters across rebuilds."
```

---

## Task 9: CLI Integration

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add scan case to the CLI switch statement**

In `src/cli.ts`, add the following case block after the `"init"` case and before the `default:` case:

```typescript
  case "scan": {
    const { scan } = await import("./commands/scan");
    const check = process.argv.includes("--check");
    scan(cwd, { check });
    break;
  }
```

- [ ] **Step 2: Update the usage string in the default case**

Change the usage line from:

```typescript
    console.error("Usage: mink <session-start|session-stop|init>");
```

to:

```typescript
    console.error("Usage: mink <session-start|session-stop|init|scan>");
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify existing tests still pass**

Run: `bun test`
Expected: All existing tests pass (no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire scan command into CLI with --check flag

Add mink scan and mink scan --check to the CLI router. Update usage
string to include the new command."
```

---

## Task 10: Init Integration

**Files:**
- Modify: `src/commands/init.ts`

- [ ] **Step 1: Add initial scan to the init function**

In `src/commands/init.ts`, add the following lines at the end of the `init()` function body, after the last `console.log` line (`console.log(\`  hooks:    ${settingsPath}\`);`):

```typescript
  // Run initial scan
  const { scan } = await import("./scan");
  scan(cwd, { check: false });
```

- [ ] **Step 2: Make the init function async**

Change the function signature from:

```typescript
export function init(cwd: string): void {
```

to:

```typescript
export async function init(cwd: string): Promise<void> {
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Verify existing tests still pass**

Run: `bun test`
Expected: All existing tests pass (no regressions). The existing `init.test.ts` tests only test `buildHooksConfig` and `mergeHooksIntoSettings`, not the `init()` function directly, so they should not be affected.

- [ ] **Step 5: Commit**

```bash
git add src/commands/init.ts
git commit -m "feat: run initial file index scan after mink init

When a user runs mink init, automatically scan the project and build
the initial file-index.json so the index is ready from the first session."
```

---

## Task 11: Integration Tests

**Files:**
- Create: `tests/integration/file-index.test.ts`

- [ ] **Step 1: Create the integration test file**

Create `tests/integration/file-index.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { scanProject, loadConfig, getExcludes } from "../../src/core/scanner";
import { extractDescription } from "../../src/core/description";
import { estimateTokens } from "../../src/core/token-estimate";
import {
  createEmptyIndex,
  isFileIndex,
  upsertEntry,
  checkStaleness,
  lookupEntry,
  recordHit,
  recordMiss,
} from "../../src/core/index-store";
import type { FileIndex, FileIndexEntry } from "../../src/types/file-index";

describe("file index integration", () => {
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "mink-project-"));
    stateDir = mkdtempSync(join(tmpdir(), "mink-state-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  function buildIndex(): FileIndex {
    const indexPath = join(stateDir, "file-index.json");
    const configPath = join(stateDir, "config.json");
    const config = loadConfig(configPath);
    const excludes = getExcludes(config);
    const maxFiles = config.maxFiles ?? 500;

    const scanned = scanProject(projectDir, excludes, maxFiles);
    const index = createEmptyIndex();

    for (const file of scanned) {
      const fullPath = join(projectDir, file.relativePath);
      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      const entry: FileIndexEntry = {
        filePath: file.relativePath,
        description: extractDescription(file.relativePath, content),
        estimatedTokens: estimateTokens(content, file.relativePath),
        lastModified: new Date(file.mtimeMs).toISOString(),
        lastIndexed: new Date().toISOString(),
      };
      upsertEntry(index, entry);
    }

    index.header.lastScanTimestamp = new Date().toISOString();
    atomicWriteJson(indexPath, index);
    return index;
  }

  test("scan → persist → reload produces valid index", () => {
    // Create sample project files
    writeFileSync(
      join(projectDir, "index.ts"),
      'export function main() { console.log("hello"); }'
    );
    mkdirSync(join(projectDir, "src"));
    writeFileSync(
      join(projectDir, "src", "utils.ts"),
      "export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }"
    );
    writeFileSync(
      join(projectDir, "README.md"),
      "# My Project\n\nA sample project."
    );

    // Build and persist index
    const index = buildIndex();
    const indexPath = join(stateDir, "file-index.json");

    // Reload from disk
    const raw = safeReadJson(indexPath);
    expect(isFileIndex(raw)).toBe(true);

    const loaded = raw as FileIndex;
    expect(loaded.header.totalFiles).toBe(3);
    expect(loaded.header.lastScanTimestamp).not.toBe("");

    // Verify individual entries
    const indexEntry = lookupEntry(loaded, "index.ts");
    expect(indexEntry).not.toBeNull();
    expect(indexEntry!.description).toBe("exports: main");
    expect(indexEntry!.estimatedTokens).toBeGreaterThan(0);

    const utilsEntry = lookupEntry(loaded, join("src", "utils.ts"));
    expect(utilsEntry).not.toBeNull();
    expect(utilsEntry!.description).toBe("exports: add, sub");

    const readmeEntry = lookupEntry(loaded, "README.md");
    expect(readmeEntry).not.toBeNull();
    expect(readmeEntry!.description).toBe("My Project");
  });

  test("excluded files are not indexed", () => {
    writeFileSync(join(projectDir, "app.ts"), "export const app = true;");
    mkdirSync(join(projectDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(
      join(projectDir, "node_modules", "pkg", "index.js"),
      "module.exports = {};"
    );
    writeFileSync(join(projectDir, ".env"), "SECRET=abc");

    const index = buildIndex();

    expect(lookupEntry(index, "app.ts")).not.toBeNull();
    expect(lookupEntry(index, join("node_modules", "pkg", "index.js"))).toBeNull();
    expect(lookupEntry(index, ".env")).toBeNull();
  });

  test("staleness check detects new and deleted files", () => {
    // Initial scan with two files
    writeFileSync(join(projectDir, "a.ts"), "export const a = 1;");
    writeFileSync(join(projectDir, "b.ts"), "export const b = 2;");

    const index = buildIndex();
    expect(index.header.totalFiles).toBe(2);

    // Simulate: delete b.ts, add c.ts
    rmSync(join(projectDir, "b.ts"));
    writeFileSync(join(projectDir, "c.ts"), "export const c = 3;");

    // Re-scan filesystem (but don't rebuild index)
    const config = loadConfig(join(stateDir, "config.json"));
    const excludes = getExcludes(config);
    const scanned = scanProject(projectDir, excludes);
    const scannedPaths = scanned.map((f) => f.relativePath);

    const report = checkStaleness(index, scannedPaths);
    expect(report.isStale).toBe(true);
    expect(report.missingFromIndex).toContain("c.ts");
    expect(report.orphanedEntries).toContain("b.ts");
  });

  test("rebuild preserves lifetime counters", () => {
    writeFileSync(join(projectDir, "app.ts"), "export const x = 1;");

    // First build
    const firstIndex = buildIndex();
    recordHit(firstIndex);
    recordHit(firstIndex);
    recordMiss(firstIndex);
    const indexPath = join(stateDir, "file-index.json");
    atomicWriteJson(indexPath, firstIndex);

    // Simulate rebuild: load existing, create new index preserving counters
    const existing = safeReadJson(indexPath) as FileIndex;
    const newIndex = createEmptyIndex();
    newIndex.header.lifetimeHits = existing.header.lifetimeHits;
    newIndex.header.lifetimeMisses = existing.header.lifetimeMisses;

    const scanned = scanProject(projectDir, getExcludes({}));
    for (const file of scanned) {
      const fullPath = join(projectDir, file.relativePath);
      const content = readFileSync(fullPath, "utf-8");
      const entry: FileIndexEntry = {
        filePath: file.relativePath,
        description: extractDescription(file.relativePath, content),
        estimatedTokens: estimateTokens(content, file.relativePath),
        lastModified: new Date(file.mtimeMs).toISOString(),
        lastIndexed: new Date().toISOString(),
      };
      upsertEntry(newIndex, entry);
    }
    newIndex.header.lastScanTimestamp = new Date().toISOString();
    atomicWriteJson(indexPath, newIndex);

    // Verify counters survived
    const reloaded = safeReadJson(indexPath) as FileIndex;
    expect(reloaded.header.lifetimeHits).toBe(2);
    expect(reloaded.header.lifetimeMisses).toBe(1);
  });

  test("custom config excludePatterns are respected", () => {
    writeFileSync(join(projectDir, "app.ts"), "export const app = 1;");
    writeFileSync(join(projectDir, "debug.log"), "DEBUG: some log");
    writeFileSync(join(projectDir, "error.log"), "ERROR: bad thing");

    // Write custom config
    const configPath = join(stateDir, "config.json");
    atomicWriteJson(configPath, { excludePatterns: ["*.log"] });

    const config = loadConfig(configPath);
    const excludes = getExcludes(config);
    const scanned = scanProject(projectDir, excludes);
    const index = createEmptyIndex();

    for (const file of scanned) {
      const fullPath = join(projectDir, file.relativePath);
      const content = readFileSync(fullPath, "utf-8");
      const entry: FileIndexEntry = {
        filePath: file.relativePath,
        description: extractDescription(file.relativePath, content),
        estimatedTokens: estimateTokens(content, file.relativePath),
        lastModified: new Date(file.mtimeMs).toISOString(),
        lastIndexed: new Date().toISOString(),
      };
      upsertEntry(index, entry);
    }

    expect(lookupEntry(index, "app.ts")).not.toBeNull();
    expect(lookupEntry(index, "debug.log")).toBeNull();
    expect(lookupEntry(index, "error.log")).toBeNull();
  });

  test("maxFiles config limits the number of indexed files", () => {
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(projectDir, `file${String(i).padStart(2, "0")}.ts`),
        `export const x${i} = ${i};`
      );
    }

    const configPath = join(stateDir, "config.json");
    atomicWriteJson(configPath, { maxFiles: 5 });

    const config = loadConfig(configPath);
    const excludes = getExcludes(config);
    const maxFiles = config.maxFiles ?? 500;
    const scanned = scanProject(projectDir, excludes, maxFiles);

    expect(scanned).toHaveLength(5);
  });

  test("description extraction works across file types in a real project", () => {
    // TypeScript with exports
    writeFileSync(
      join(projectDir, "router.ts"),
      "export function createRouter() {}\nexport function addRoute() {}"
    );

    // Markdown with heading
    writeFileSync(
      join(projectDir, "CHANGELOG.md"),
      "# Changelog\n\n## v1.0.0\n- Initial release"
    );

    // Package.json (known config)
    writeFileSync(
      join(projectDir, "package.json"),
      '{ "name": "test", "version": "1.0.0" }'
    );

    // Shell script with shebang
    writeFileSync(
      join(projectDir, "deploy.sh"),
      "#!/bin/bash\n# Deploy to production\nset -e\necho 'deploying'"
    );

    const index = buildIndex();

    const router = lookupEntry(index, "router.ts");
    expect(router!.description).toBe("exports: createRouter, addRoute");

    const changelog = lookupEntry(index, "CHANGELOG.md");
    expect(changelog!.description).toBe("Changelog");

    const pkg = lookupEntry(index, "package.json");
    expect(pkg!.description).toBe("Node.js package manifest");

    const deploy = lookupEntry(index, "deploy.sh");
    expect(deploy!.description).toBe("Deploy to production");
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bun test tests/integration/file-index.test.ts`
Expected:
```
bun test v1.x.x
tests/integration/file-index.test.ts:
  file index integration
    ✓ scan → persist → reload produces valid index
    ✓ excluded files are not indexed
    ✓ staleness check detects new and deleted files
    ✓ rebuild preserves lifetime counters
    ✓ custom config excludePatterns are respected
    ✓ maxFiles config limits the number of indexed files
    ✓ description extraction works across file types in a real project

 7 pass
 0 fail
```

- [ ] **Step 3: Run full test suite to verify no regressions**

Run: `bun test`
Expected:
```
bun test v1.x.x

tests/unit/token-estimate.test.ts:     14 pass
tests/unit/description.test.ts:        38 pass
tests/unit/scanner.test.ts:            22 pass
tests/unit/index-store.test.ts:        27 pass
tests/unit/project-id.test.ts:         (existing pass)
tests/unit/fs-utils.test.ts:           (existing pass)
tests/unit/session.test.ts:            (existing pass)
tests/unit/session-stop.test.ts:       (existing pass)
tests/unit/init.test.ts:               (existing pass)
tests/integration/lifecycle.test.ts:   (existing pass)
tests/integration/file-index.test.ts:  7 pass

 0 fail
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/file-index.test.ts
git commit -m "test: add integration tests for file index lifecycle

Cover the full scan-persist-reload cycle, exclude filtering, staleness
detection, lifetime counter preservation, custom config, maxFiles cap,
and cross-file-type description extraction."
```

---

## Task 12: End-to-End Smoke Test

**Files:** None created or modified. Manual verification only.

- [ ] **Step 1: Run scan against the mink project itself**

Run: `bun run src/cli.ts scan`
Expected output (approximate):
```
[mink] indexed NN files in NNms
```

Where `NN` is a positive number. No errors or crashes.

- [ ] **Step 2: Verify the index file was created**

Run: `cat ~/.mink/projects/*/file-index.json | head -20`
Expected: Valid JSON with `header` and `entries` fields. The `header.totalFiles` should match the number reported by the scan command.

- [ ] **Step 3: Verify file entries look correct**

Run: `cat ~/.mink/projects/*/file-index.json | bun -e "const idx = JSON.parse(await Bun.stdin.text()); const entries = Object.values(idx.entries).slice(0, 5); entries.forEach(e => console.log(e.filePath, '|', e.description, '|', e.estimatedTokens + ' tokens'))"`
Expected: 5 entries with reasonable descriptions and token counts. For example:
```
src/cli.ts | exports: ... | NN tokens
src/core/paths.ts | exports: minkRoot, projectDir, sessionPath, fileIndexPath, configPath | NN tokens
src/core/scanner.ts | exports: ... | NN tokens
```

- [ ] **Step 4: Run staleness check when up to date**

Run: `bun run src/cli.ts scan --check`
Expected:
```
[mink] index is up to date
```
Exit code 0.

- [ ] **Step 5: Create a temporary file and verify staleness is detected**

Run:
```bash
echo "export const temp = true;" > /tmp/mink-smoke-test.ts
cp /tmp/mink-smoke-test.ts src/temp-smoke-test.ts
bun run src/cli.ts scan --check
```
Expected:
```
Missing from index (1):
  + src/temp-smoke-test.ts
```
Exit code 1.

- [ ] **Step 6: Clean up the temporary file**

Run:
```bash
rm src/temp-smoke-test.ts
rm /tmp/mink-smoke-test.ts
```

- [ ] **Step 7: Run full test suite one final time**

Run: `bun test`
Expected: All tests pass. Zero failures.

- [ ] **Step 8: Final commit (if any cleanup was needed)**

If no changes were needed, skip this step. Otherwise:

```bash
git add -A
git commit -m "chore: final cleanup after file index smoke test"
```
