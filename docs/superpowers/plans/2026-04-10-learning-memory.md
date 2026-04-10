# Learning Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent markdown-based learning memory with four structured sections, a pattern engine for Do-Not-Repeat enforcement, multi-ecosystem initialization seeding, and a reflection command for pruning to token budget.

**Architecture:** Pure markdown storage (`learning-memory.md`) parsed and serialized by `learning-memory.ts`. Pattern extraction and matching are isolated in `pattern-engine.ts`. Initialization seeding inspects `package.json`, `pyproject.toml`, `Cargo.toml`, and `go.mod`. A `mink reflect` CLI command prunes the memory (merge duplicates, then trim oldest) and is also called from session-stop.

**Tech Stack:** TypeScript, Bun (test runner + runtime), no external dependencies

---

## File Structure

| File | Responsibility |
|------|---------------|
| **Create:** `src/types/learning-memory.ts` | Interfaces for sections, entries, patterns, match results |
| **Create:** `src/core/learning-memory.ts` | Parse markdown → structure, serialize structure → markdown, add/remove entries per section |
| **Create:** `src/core/pattern-engine.ts` | Extract enforceable patterns from Do-Not-Repeat entries, match patterns against content |
| **Create:** `src/core/seed.ts` | Parse project metadata files, detect frameworks, generate seed learning memory |
| **Create:** `src/core/reflection.ts` | Token budget check, duplicate merge, oldest-first trim |
| **Create:** `src/commands/reflect.ts` | CLI handler: load memory, run reflection, save, print summary |
| **Modify:** `src/core/fs-utils.ts` | Add `atomicWriteText()` for markdown files |
| **Modify:** `src/core/paths.ts` | Add `learningMemoryPath()` |
| **Modify:** `src/types/file-index.ts` | Add `learningMemoryTokenBudget` to `ProjectConfig` |
| **Modify:** `src/cli.ts` | Add `reflect` command route |
| **Modify:** `src/commands/session-stop.ts` | Call reflect after finalization, replace hardcoded path |
| **Modify:** `src/commands/init.ts` | Seed learning memory on init |
| **Create:** `tests/unit/learning-memory.test.ts` | Parse/serialize/CRUD tests |
| **Create:** `tests/unit/pattern-engine.test.ts` | Pattern extraction and matching tests |
| **Create:** `tests/unit/seed.test.ts` | Metadata parsing and framework detection tests |
| **Create:** `tests/unit/reflection.test.ts` | Merge, trim, budget enforcement tests |
| **Create:** `tests/unit/reflect-command.test.ts` | CLI reflect command tests |
| **Create:** `tests/integration/learning-memory.test.ts` | End-to-end: init → seed → add entries → reflect → verify |

---

### Task 1: Types and Interfaces

**Files:**
- Create: `src/types/learning-memory.ts`
- Test: `tests/unit/learning-memory.test.ts` (started, expanded in Task 2)

- [ ] **Step 1: Create the types file**

```typescript
// src/types/learning-memory.ts

export type SectionName =
  | "User Preferences"
  | "Key Learnings"
  | "Do-Not-Repeat"
  | "Decision Log";

export interface LearningMemory {
  projectName: string;
  sections: Record<SectionName, string[]>;
}

export interface ExtractedPattern {
  type: "literal" | "word-boundary";
  pattern: string;
  sourceEntry: string;
}

export interface PatternMatch {
  pattern: ExtractedPattern;
  matchedText: string;
  index: number;
}

export interface ReflectionResult {
  beforeTokens: number;
  afterTokens: number;
  mergedCount: number;
  trimmedCount: number;
  withinBudget: boolean;
}

export interface SeedInfo {
  projectName: string;
  description: string;
  frameworks: string[];
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `bun build src/types/learning-memory.ts --no-bundle`
Expected: No errors

- [ ] **Step 3: Add `learningMemoryTokenBudget` to `ProjectConfig`**

In `src/types/file-index.ts`, add the optional field to the existing `ProjectConfig` interface:

```typescript
export interface ProjectConfig {
  excludePatterns?: string[];
  maxFiles?: number;
  learningMemoryTokenBudget?: number;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/types/learning-memory.ts src/types/file-index.ts
git commit -m "feat(learning-memory): add types and interfaces"
```

---

### Task 2: Learning Memory Parse and Serialize

**Files:**
- Create: `src/core/learning-memory.ts`
- Test: `tests/unit/learning-memory.test.ts`

- [ ] **Step 1: Write failing tests for parsing**

```typescript
// tests/unit/learning-memory.test.ts
import { describe, expect, test } from "bun:test";
import {
  parseLearningMemory,
  serializeLearningMemory,
  createEmptyLearningMemory,
} from "../../src/core/learning-memory";
import type { LearningMemory } from "../../src/types/learning-memory";

describe("learning-memory", () => {
  describe("createEmptyLearningMemory", () => {
    test("creates memory with project name and empty sections", () => {
      const mem = createEmptyLearningMemory("my-project");
      expect(mem.projectName).toBe("my-project");
      expect(mem.sections["User Preferences"]).toEqual([]);
      expect(mem.sections["Key Learnings"]).toEqual([]);
      expect(mem.sections["Do-Not-Repeat"]).toEqual([]);
      expect(mem.sections["Decision Log"]).toEqual([]);
    });
  });

  describe("parseLearningMemory", () => {
    test("parses well-formed markdown into sections", () => {
      const md = [
        "# Learning Memory — my-project",
        "",
        "## User Preferences",
        "",
        "- Use named exports",
        "- Prefer const over let",
        "",
        "## Key Learnings",
        "",
        "- API uses sliding window rate limiting",
        "",
        "## Do-Not-Repeat",
        "",
        '- [2026-04-10] Never use "var"',
        "",
        "## Decision Log",
        "",
        "- [2026-04-10] Chose Bun as runtime",
      ].join("\n");

      const mem = parseLearningMemory(md);
      expect(mem.projectName).toBe("my-project");
      expect(mem.sections["User Preferences"]).toEqual([
        "Use named exports",
        "Prefer const over let",
      ]);
      expect(mem.sections["Key Learnings"]).toEqual([
        "API uses sliding window rate limiting",
      ]);
      expect(mem.sections["Do-Not-Repeat"]).toEqual([
        '[2026-04-10] Never use "var"',
      ]);
      expect(mem.sections["Decision Log"]).toEqual([
        "[2026-04-10] Chose Bun as runtime",
      ]);
    });

    test("handles empty sections", () => {
      const md = [
        "# Learning Memory — test",
        "",
        "## User Preferences",
        "",
        "## Key Learnings",
        "",
        "## Do-Not-Repeat",
        "",
        "## Decision Log",
      ].join("\n");

      const mem = parseLearningMemory(md);
      expect(mem.sections["User Preferences"]).toEqual([]);
      expect(mem.sections["Key Learnings"]).toEqual([]);
      expect(mem.sections["Do-Not-Repeat"]).toEqual([]);
      expect(mem.sections["Decision Log"]).toEqual([]);
    });

    test("handles missing title — uses fallback name", () => {
      const md = [
        "## User Preferences",
        "",
        "- Something",
      ].join("\n");

      const mem = parseLearningMemory(md);
      expect(mem.projectName).toBe("unknown");
      expect(mem.sections["User Preferences"]).toEqual(["Something"]);
    });

    test("ignores content outside recognized sections", () => {
      const md = [
        "# Learning Memory — test",
        "",
        "Some random text here",
        "",
        "## User Preferences",
        "",
        "- Real entry",
        "",
        "## Unknown Section",
        "",
        "- Should be ignored",
        "",
        "## Key Learnings",
        "",
        "## Do-Not-Repeat",
        "",
        "## Decision Log",
      ].join("\n");

      const mem = parseLearningMemory(md);
      expect(mem.sections["User Preferences"]).toEqual(["Real entry"]);
    });

    test("returns empty memory for empty string", () => {
      const mem = parseLearningMemory("");
      expect(mem.projectName).toBe("unknown");
      expect(mem.sections["User Preferences"]).toEqual([]);
    });
  });

  describe("serializeLearningMemory", () => {
    test("produces well-formed markdown", () => {
      const mem: LearningMemory = {
        projectName: "my-project",
        sections: {
          "User Preferences": ["Use named exports"],
          "Key Learnings": ["API uses rate limiting"],
          "Do-Not-Repeat": ['[2026-04-10] Never use "var"'],
          "Decision Log": ["[2026-04-10] Chose Bun"],
        },
      };

      const md = serializeLearningMemory(mem);
      expect(md).toContain("# Learning Memory — my-project");
      expect(md).toContain("## User Preferences");
      expect(md).toContain("- Use named exports");
      expect(md).toContain("## Key Learnings");
      expect(md).toContain("- API uses rate limiting");
      expect(md).toContain("## Do-Not-Repeat");
      expect(md).toContain('- [2026-04-10] Never use "var"');
      expect(md).toContain("## Decision Log");
      expect(md).toContain("- [2026-04-10] Chose Bun");
    });

    test("round-trips: parse → serialize → parse produces identical structure", () => {
      const original: LearningMemory = {
        projectName: "roundtrip",
        sections: {
          "User Preferences": ["Pref A", "Pref B"],
          "Key Learnings": ["Learning 1"],
          "Do-Not-Repeat": ['[2026-01-01] Avoid "any" type'],
          "Decision Log": ["[2026-01-01] Use monorepo"],
        },
      };

      const md = serializeLearningMemory(original);
      const parsed = parseLearningMemory(md);
      expect(parsed).toEqual(original);
    });

    test("empty sections are rendered with heading only", () => {
      const mem = createEmptyLearningMemory("empty-project");
      const md = serializeLearningMemory(mem);
      expect(md).toContain("## User Preferences");
      expect(md).toContain("## Do-Not-Repeat");
      // No "- " entries between sections
      const lines = md.split("\n");
      const prefIdx = lines.findIndex((l) => l === "## User Preferences");
      const nextSection = lines.findIndex(
        (l, i) => i > prefIdx && l.startsWith("## ")
      );
      const between = lines.slice(prefIdx + 1, nextSection).filter((l) => l.startsWith("- "));
      expect(between).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/learning-memory.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the learning memory module**

```typescript
// src/core/learning-memory.ts
import type { LearningMemory, SectionName } from "../types/learning-memory";

const SECTION_ORDER: SectionName[] = [
  "User Preferences",
  "Key Learnings",
  "Do-Not-Repeat",
  "Decision Log",
];

const SECTION_NAMES = new Set<string>(SECTION_ORDER);

export function createEmptyLearningMemory(projectName: string): LearningMemory {
  return {
    projectName,
    sections: {
      "User Preferences": [],
      "Key Learnings": [],
      "Do-Not-Repeat": [],
      "Decision Log": [],
    },
  };
}

export function parseLearningMemory(markdown: string): LearningMemory {
  const lines = markdown.split("\n");

  // Extract project name from title
  let projectName = "unknown";
  const titleLine = lines.find((l) => l.startsWith("# Learning Memory"));
  if (titleLine) {
    const match = titleLine.match(/^# Learning Memory\s*—\s*(.+)$/);
    if (match) {
      projectName = match[1].trim();
    }
  }

  const mem = createEmptyLearningMemory(projectName);

  let currentSection: SectionName | null = null;

  for (const line of lines) {
    // Check for section heading
    const headingMatch = line.match(/^## (.+)$/);
    if (headingMatch) {
      const name = headingMatch[1].trim();
      if (SECTION_NAMES.has(name)) {
        currentSection = name as SectionName;
      } else {
        currentSection = null;
      }
      continue;
    }

    // Check for entry
    if (currentSection && line.startsWith("- ")) {
      const entry = line.slice(2).trim();
      if (entry.length > 0) {
        mem.sections[currentSection].push(entry);
      }
    }
  }

  return mem;
}

export function serializeLearningMemory(mem: LearningMemory): string {
  const lines: string[] = [`# Learning Memory — ${mem.projectName}`, ""];

  for (const section of SECTION_ORDER) {
    lines.push(`## ${section}`, "");
    for (const entry of mem.sections[section]) {
      lines.push(`- ${entry}`);
    }
    lines.push("");
  }

  // Remove trailing blank line to end with single newline
  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n") + "\n";
}

export function addEntry(
  mem: LearningMemory,
  section: SectionName,
  entry: string
): void {
  mem.sections[section].push(entry);
}

export function removeEntry(
  mem: LearningMemory,
  section: SectionName,
  index: number
): void {
  if (index >= 0 && index < mem.sections[section].length) {
    mem.sections[section].splice(index, 1);
  }
}

export function getEntries(mem: LearningMemory, section: SectionName): string[] {
  return mem.sections[section];
}

export function totalEntryCount(mem: LearningMemory): number {
  return SECTION_ORDER.reduce(
    (sum, section) => sum + mem.sections[section].length,
    0
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/learning-memory.test.ts`
Expected: All PASS

- [ ] **Step 5: Add tests for addEntry, removeEntry, getEntries, totalEntryCount**

Append to the test file:

```typescript
  describe("addEntry", () => {
    test("appends entry to specified section", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "Use semicolons");
      expect(mem.sections["User Preferences"]).toEqual(["Use semicolons"]);
    });

    test("appends multiple entries in order", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "Key Learnings", "First");
      addEntry(mem, "Key Learnings", "Second");
      expect(mem.sections["Key Learnings"]).toEqual(["First", "Second"]);
    });
  });

  describe("removeEntry", () => {
    test("removes entry at given index", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");
      addEntry(mem, "User Preferences", "B");
      addEntry(mem, "User Preferences", "C");
      removeEntry(mem, "User Preferences", 1);
      expect(mem.sections["User Preferences"]).toEqual(["A", "C"]);
    });

    test("no-ops for out-of-bounds index", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");
      removeEntry(mem, "User Preferences", 5);
      expect(mem.sections["User Preferences"]).toEqual(["A"]);
    });

    test("no-ops for negative index", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");
      removeEntry(mem, "User Preferences", -1);
      expect(mem.sections["User Preferences"]).toEqual(["A"]);
    });
  });

  describe("getEntries", () => {
    test("returns entries for a section", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "Do-Not-Repeat", "[2026-04-10] Rule");
      expect(getEntries(mem, "Do-Not-Repeat")).toEqual(["[2026-04-10] Rule"]);
    });

    test("returns empty array for empty section", () => {
      const mem = createEmptyLearningMemory("test");
      expect(getEntries(mem, "Decision Log")).toEqual([]);
    });
  });

  describe("totalEntryCount", () => {
    test("counts entries across all sections", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");
      addEntry(mem, "Key Learnings", "B");
      addEntry(mem, "Do-Not-Repeat", "C");
      expect(totalEntryCount(mem)).toBe(3);
    });

    test("returns 0 for empty memory", () => {
      const mem = createEmptyLearningMemory("test");
      expect(totalEntryCount(mem)).toBe(0);
    });
  });
```

Import `addEntry`, `removeEntry`, `getEntries`, `totalEntryCount` at the top of the test file.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/unit/learning-memory.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/learning-memory.ts tests/unit/learning-memory.test.ts
git commit -m "feat(learning-memory): add parse, serialize, and CRUD functions"
```

---

### Task 3: `atomicWriteText` and `learningMemoryPath`

**Files:**
- Modify: `src/core/fs-utils.ts`
- Modify: `src/core/paths.ts`
- Test: `tests/unit/fs-utils.test.ts` (existing)

- [ ] **Step 1: Write failing test for `atomicWriteText`**

Append to `tests/unit/fs-utils.test.ts`:

```typescript
import { atomicWriteText } from "../../src/core/fs-utils";

describe("atomicWriteText", () => {
  test("writes text content to file", () => {
    const filePath = join(dir, "test.md");
    atomicWriteText(filePath, "# Hello\n\nWorld\n");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("# Hello\n\nWorld\n");
  });

  test("overwrites existing file atomically", () => {
    const filePath = join(dir, "test.md");
    atomicWriteText(filePath, "first");
    atomicWriteText(filePath, "second");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("second");
  });

  test("creates parent directories", () => {
    const filePath = join(dir, "nested", "deep", "test.md");
    atomicWriteText(filePath, "content");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("content");
  });
});
```

Note: The existing `fs-utils.test.ts` already has a `dir` variable with `beforeEach`/`afterEach` for temp dirs and imports `readFileSync`. Add the `atomicWriteText` import at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/fs-utils.test.ts`
Expected: FAIL — `atomicWriteText` not found

- [ ] **Step 3: Implement `atomicWriteText`**

Add to `src/core/fs-utils.ts`:

```typescript
export function atomicWriteText(filePath: string, content: string): void {
  const tmp = filePath + ".tmp";
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/fs-utils.test.ts`
Expected: All PASS

- [ ] **Step 5: Add `learningMemoryPath` to paths.ts**

Add to `src/core/paths.ts`:

```typescript
export function learningMemoryPath(cwd: string): string {
  return join(projectDir(cwd), "learning-memory.md");
}
```

- [ ] **Step 6: Commit**

```bash
git add src/core/fs-utils.ts src/core/paths.ts tests/unit/fs-utils.test.ts
git commit -m "feat(learning-memory): add atomicWriteText and learningMemoryPath"
```

---

### Task 4: Pattern Engine

**Files:**
- Create: `src/core/pattern-engine.ts`
- Test: `tests/unit/pattern-engine.test.ts`

- [ ] **Step 1: Write failing tests for pattern extraction**

```typescript
// tests/unit/pattern-engine.test.ts
import { describe, expect, test } from "bun:test";
import { extractPatterns, matchPatterns } from "../../src/core/pattern-engine";

describe("pattern-engine", () => {
  describe("extractPatterns", () => {
    test("extracts double-quoted strings as literal patterns", () => {
      const patterns = extractPatterns(['[2026-04-10] Never use "var"']);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe("literal");
      expect(patterns[0].pattern).toBe("var");
      expect(patterns[0].sourceEntry).toBe('[2026-04-10] Never use "var"');
    });

    test("extracts single-quoted strings as literal patterns", () => {
      const patterns = extractPatterns(["[2026-04-10] Avoid 'export default'"]);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe("literal");
      expect(patterns[0].pattern).toBe("export default");
    });

    test("extracts 'never use' phrases as word-boundary patterns", () => {
      const patterns = extractPatterns([
        "[2026-04-10] Never use default exports",
      ]);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe("word-boundary");
      expect(patterns[0].pattern).toBe("default exports");
    });

    test("extracts 'avoid' phrases as word-boundary patterns", () => {
      const patterns = extractPatterns([
        "[2026-04-10] Avoid mocking the database in integration tests",
      ]);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].type).toBe("word-boundary");
      expect(patterns[0].pattern).toBe("mocking the database");
    });

    test("'avoid' phrase stops at dash", () => {
      const patterns = extractPatterns([
        "[2026-04-10] Avoid mocking — use real fixtures instead",
      ]);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toBe("mocking");
    });

    test("extracts both quoted and phrase patterns from one entry", () => {
      const patterns = extractPatterns([
        '[2026-04-10] Never use "var" — avoid global scope pollution',
      ]);
      expect(patterns.length).toBeGreaterThanOrEqual(2);
      const types = patterns.map((p) => p.type);
      expect(types).toContain("literal");
      expect(types).toContain("word-boundary");
    });

    test("returns empty array for entry with no extractable pattern", () => {
      const patterns = extractPatterns([
        "[2026-04-10] Be careful with auth",
      ]);
      expect(patterns).toHaveLength(0);
    });

    test("handles multiple entries", () => {
      const patterns = extractPatterns([
        '[2026-04-10] Never use "var"',
        "[2026-04-11] Avoid default exports",
      ]);
      expect(patterns).toHaveLength(2);
    });

    test("returns empty array for empty input", () => {
      const patterns = extractPatterns([]);
      expect(patterns).toHaveLength(0);
    });

    test("extracts multiple quoted strings from one entry", () => {
      const patterns = extractPatterns([
        '[2026-04-10] Never use "var" or "any"',
      ]);
      const literals = patterns.filter((p) => p.type === "literal");
      expect(literals).toHaveLength(2);
      expect(literals.map((p) => p.pattern)).toContain("var");
      expect(literals.map((p) => p.pattern)).toContain("any");
    });
  });

  describe("matchPatterns", () => {
    test("matches literal pattern in content", () => {
      const patterns = extractPatterns(['[2026-04-10] Never use "var"']);
      const matches = matchPatterns(patterns, "var x = 5;");
      expect(matches).toHaveLength(1);
      expect(matches[0].matchedText).toBe("var");
    });

    test("literal match is case-sensitive", () => {
      const patterns = extractPatterns(['[2026-04-10] Never use "var"']);
      const matches = matchPatterns(patterns, "VAR x = 5;");
      expect(matches).toHaveLength(0);
    });

    test("matches word-boundary pattern in content", () => {
      const patterns = extractPatterns([
        "[2026-04-10] Avoid default exports",
      ]);
      const matches = matchPatterns(patterns, "export default function foo() {}");
      expect(matches).toHaveLength(1);
    });

    test("word-boundary match is case-insensitive", () => {
      const patterns = extractPatterns([
        "[2026-04-10] Avoid Default Exports",
      ]);
      const matches = matchPatterns(patterns, "export default function foo() {}");
      expect(matches).toHaveLength(1);
    });

    test("no match when content does not contain pattern", () => {
      const patterns = extractPatterns(['[2026-04-10] Never use "var"']);
      const matches = matchPatterns(patterns, "const x = 5;");
      expect(matches).toHaveLength(0);
    });

    test("multiple patterns can match same content", () => {
      const patterns = extractPatterns([
        '[2026-04-10] Never use "var"',
        '[2026-04-11] Avoid "let" — prefer const',
      ]);
      const matches = matchPatterns(patterns, "var x = 5; let y = 10;");
      expect(matches).toHaveLength(2);
    });

    test("returns empty for empty content", () => {
      const patterns = extractPatterns(['[2026-04-10] Never use "var"']);
      const matches = matchPatterns(patterns, "");
      expect(matches).toHaveLength(0);
    });

    test("returns empty for empty patterns", () => {
      const matches = matchPatterns([], "var x = 5;");
      expect(matches).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/pattern-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the pattern engine**

```typescript
// src/core/pattern-engine.ts
import type { ExtractedPattern, PatternMatch } from "../types/learning-memory";

function stripDatePrefix(entry: string): string {
  return entry.replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, "");
}

export function extractPatterns(entries: string[]): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];

  for (const entry of entries) {
    const text = stripDatePrefix(entry);

    // Extract quoted strings (double or single quotes)
    const quoteRegex = /["']([^"']+)["']/g;
    let quoteMatch: RegExpExecArray | null;
    while ((quoteMatch = quoteRegex.exec(text)) !== null) {
      patterns.push({
        type: "literal",
        pattern: quoteMatch[1],
        sourceEntry: entry,
      });
    }

    // Extract "never use" phrases
    const neverUseMatch = text.match(/\bnever use\s+(.+?)(?:\s*[—\-–.]|$)/i);
    if (neverUseMatch) {
      // Remove any quoted portions from the phrase (already extracted above)
      let phrase = neverUseMatch[1].replace(/["'][^"']+["']/g, "").trim();
      // Clean up leftover connectors
      phrase = phrase.replace(/^\s*(or|and)\s+/i, "").trim();
      if (phrase.length > 0) {
        patterns.push({
          type: "word-boundary",
          pattern: phrase,
          sourceEntry: entry,
        });
      }
    }

    // Extract "avoid" phrases
    const avoidMatch = text.match(/\bavoid\s+(.+?)(?:\s*[—\-–.]|$)/i);
    if (avoidMatch) {
      let phrase = avoidMatch[1].replace(/["'][^"']+["']/g, "").trim();
      phrase = phrase.replace(/^\s*(or|and)\s+/i, "").trim();
      if (phrase.length > 0) {
        patterns.push({
          type: "word-boundary",
          pattern: phrase,
          sourceEntry: entry,
        });
      }
    }
  }

  return patterns;
}

export function matchPatterns(
  patterns: ExtractedPattern[],
  content: string
): PatternMatch[] {
  if (content.length === 0 || patterns.length === 0) return [];

  const matches: PatternMatch[] = [];

  for (const pattern of patterns) {
    if (pattern.type === "literal") {
      const idx = content.indexOf(pattern.pattern);
      if (idx !== -1) {
        matches.push({
          pattern,
          matchedText: pattern.pattern,
          index: idx,
        });
      }
    } else {
      // Word-boundary match, case-insensitive
      const escaped = pattern.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");
      const match = regex.exec(content);
      if (match) {
        matches.push({
          pattern,
          matchedText: match[0],
          index: match.index,
        });
      }
    }
  }

  return matches;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/pattern-engine.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/pattern-engine.ts tests/unit/pattern-engine.test.ts
git commit -m "feat(learning-memory): add pattern extraction and matching engine"
```

---

### Task 5: Initialization Seeding

**Files:**
- Create: `src/core/seed.ts`
- Test: `tests/unit/seed.test.ts`

- [ ] **Step 1: Write failing tests for metadata parsing**

```typescript
// tests/unit/seed.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { seedLearningMemory, parsePackageJson, parsePyprojectToml, parseCargoToml, parseGoMod } from "../../src/core/seed";
import type { SeedInfo } from "../../src/types/learning-memory";

describe("seed", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-seed-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("parsePackageJson", () => {
    test("extracts name, description, and frameworks from dependencies", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "my-app",
          description: "A cool app",
          dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
          devDependencies: { typescript: "^5.0.0", jest: "^29.0.0" },
        })
      );

      const info = parsePackageJson(join(dir, "package.json"));
      expect(info).not.toBeNull();
      expect(info!.projectName).toBe("my-app");
      expect(info!.description).toBe("A cool app");
      expect(info!.frameworks).toContain("React");
      expect(info!.frameworks).toContain("TypeScript");
      expect(info!.frameworks).toContain("Jest");
    });

    test("returns null for missing file", () => {
      const info = parsePackageJson(join(dir, "package.json"));
      expect(info).toBeNull();
    });

    test("returns null for malformed JSON", () => {
      writeFileSync(join(dir, "package.json"), "not json {{{");
      const info = parsePackageJson(join(dir, "package.json"));
      expect(info).toBeNull();
    });

    test("handles missing description", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "bare-project" })
      );
      const info = parsePackageJson(join(dir, "package.json"));
      expect(info!.description).toBe("");
      expect(info!.frameworks).toEqual([]);
    });
  });

  describe("parsePyprojectToml", () => {
    test("extracts name and description from [project] section", () => {
      writeFileSync(
        join(dir, "pyproject.toml"),
        [
          "[project]",
          'name = "my-api"',
          'description = "A REST API"',
          "dependencies = [",
          '  "fastapi>=0.100.0",',
          '  "sqlalchemy>=2.0",',
          "]",
        ].join("\n")
      );

      const info = parsePyprojectToml(join(dir, "pyproject.toml"));
      expect(info).not.toBeNull();
      expect(info!.projectName).toBe("my-api");
      expect(info!.description).toBe("A REST API");
      expect(info!.frameworks).toContain("FastAPI");
      expect(info!.frameworks).toContain("SQLAlchemy");
    });

    test("returns null for missing file", () => {
      const info = parsePyprojectToml(join(dir, "pyproject.toml"));
      expect(info).toBeNull();
    });
  });

  describe("parseCargoToml", () => {
    test("extracts name and description from [package] section", () => {
      writeFileSync(
        join(dir, "Cargo.toml"),
        [
          "[package]",
          'name = "my-service"',
          'description = "A Rust service"',
          "",
          "[dependencies]",
          'actix-web = "4"',
          'serde = { version = "1", features = ["derive"] }',
        ].join("\n")
      );

      const info = parseCargoToml(join(dir, "Cargo.toml"));
      expect(info).not.toBeNull();
      expect(info!.projectName).toBe("my-service");
      expect(info!.description).toBe("A Rust service");
      expect(info!.frameworks).toContain("Actix Web");
      expect(info!.frameworks).toContain("Serde");
    });

    test("returns null for missing file", () => {
      const info = parseCargoToml(join(dir, "Cargo.toml"));
      expect(info).toBeNull();
    });
  });

  describe("parseGoMod", () => {
    test("extracts module name and detects frameworks", () => {
      writeFileSync(
        join(dir, "go.mod"),
        [
          "module github.com/user/my-server",
          "",
          "go 1.21",
          "",
          "require (",
          "\tgithub.com/gin-gonic/gin v1.9.1",
          "\tgorm.io/gorm v1.25.0",
          ")",
        ].join("\n")
      );

      const info = parseGoMod(join(dir, "go.mod"));
      expect(info).not.toBeNull();
      expect(info!.projectName).toBe("my-server");
      expect(info!.description).toBe("");
      expect(info!.frameworks).toContain("Gin");
      expect(info!.frameworks).toContain("GORM");
    });

    test("returns null for missing file", () => {
      const info = parseGoMod(join(dir, "go.mod"));
      expect(info).toBeNull();
    });
  });

  describe("seedLearningMemory", () => {
    test("seeds from package.json", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({
          name: "my-app",
          description: "A web app",
          dependencies: { react: "^18.0.0" },
        })
      );

      const mem = seedLearningMemory(dir);
      expect(mem.projectName).toBe("my-app");
      expect(mem.sections["Key Learnings"].join(" ")).toContain("my-app");
      expect(mem.sections["Key Learnings"].join(" ")).toContain("React");
    });

    test("seeds from multiple metadata files", () => {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ name: "mono", dependencies: { typescript: "^5.0" } })
      );
      writeFileSync(
        join(dir, "pyproject.toml"),
        ['[project]', 'name = "mono-py"', 'dependencies = ["flask"]'].join("\n")
      );

      const mem = seedLearningMemory(dir);
      const learnings = mem.sections["Key Learnings"].join(" ");
      expect(learnings).toContain("TypeScript");
      expect(learnings).toContain("Flask");
    });

    test("falls back to directory name when no metadata found", () => {
      const mem = seedLearningMemory(dir);
      // dir is a temp path, project name should be the basename
      expect(mem.projectName).toBeTruthy();
      expect(mem.sections["Key Learnings"]).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/seed.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the seed module**

```typescript
// src/core/seed.ts
import { readFileSync } from "fs";
import { basename, join } from "path";
import {
  createEmptyLearningMemory,
  addEntry,
} from "./learning-memory";
import type { LearningMemory, SeedInfo } from "../types/learning-memory";

// Framework detection maps
const NPM_FRAMEWORKS: Record<string, string> = {
  react: "React",
  "react-dom": "React",
  next: "Next.js",
  vue: "Vue",
  nuxt: "Nuxt",
  svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit",
  angular: "Angular",
  "@angular/core": "Angular",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  koa: "Koa",
  nestjs: "NestJS",
  "@nestjs/core": "NestJS",
  typescript: "TypeScript",
  jest: "Jest",
  vitest: "Vitest",
  mocha: "Mocha",
  tailwindcss: "Tailwind CSS",
  prisma: "Prisma",
  "@prisma/client": "Prisma",
  drizzle: "Drizzle",
  "drizzle-orm": "Drizzle",
};

const PYTHON_FRAMEWORKS: Record<string, string> = {
  fastapi: "FastAPI",
  flask: "Flask",
  django: "Django",
  sqlalchemy: "SQLAlchemy",
  pytest: "pytest",
  pydantic: "Pydantic",
  celery: "Celery",
  httpx: "HTTPX",
  uvicorn: "Uvicorn",
};

const CARGO_FRAMEWORKS: Record<string, string> = {
  "actix-web": "Actix Web",
  axum: "Axum",
  tokio: "Tokio",
  serde: "Serde",
  diesel: "Diesel",
  sqlx: "SQLx",
  warp: "Warp",
  rocket: "Rocket",
};

const GO_FRAMEWORKS: Record<string, string> = {
  "github.com/gin-gonic/gin": "Gin",
  "github.com/gofiber/fiber": "Fiber",
  "github.com/labstack/echo": "Echo",
  "gorm.io/gorm": "GORM",
  "github.com/gorilla/mux": "Gorilla Mux",
};

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function parsePackageJson(filePath: string): SeedInfo | null {
  const raw = safeReadFile(filePath);
  if (raw === null) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const projectName = (parsed.name as string) || "";
  const description = (parsed.description as string) || "";

  const deps = {
    ...(parsed.dependencies as Record<string, string> ?? {}),
    ...(parsed.devDependencies as Record<string, string> ?? {}),
  };

  const frameworks = new Set<string>();
  for (const dep of Object.keys(deps)) {
    const fw = NPM_FRAMEWORKS[dep];
    if (fw) frameworks.add(fw);
  }

  return { projectName, description, frameworks: [...frameworks] };
}

export function parsePyprojectToml(filePath: string): SeedInfo | null {
  const raw = safeReadFile(filePath);
  if (raw === null) return null;

  // Simple TOML parsing for [project] section
  let projectName = "";
  let description = "";
  const frameworks = new Set<string>();

  const nameMatch = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (nameMatch) projectName = nameMatch[1];

  const descMatch = raw.match(/^\s*description\s*=\s*"([^"]+)"/m);
  if (descMatch) description = descMatch[1];

  // Check dependencies list
  for (const [pkg, fw] of Object.entries(PYTHON_FRAMEWORKS)) {
    if (raw.includes(pkg)) {
      frameworks.add(fw);
    }
  }

  return { projectName, description, frameworks: [...frameworks] };
}

export function parseCargoToml(filePath: string): SeedInfo | null {
  const raw = safeReadFile(filePath);
  if (raw === null) return null;

  let projectName = "";
  let description = "";
  const frameworks = new Set<string>();

  const nameMatch = raw.match(/^\s*name\s*=\s*"([^"]+)"/m);
  if (nameMatch) projectName = nameMatch[1];

  const descMatch = raw.match(/^\s*description\s*=\s*"([^"]+)"/m);
  if (descMatch) description = descMatch[1];

  for (const [pkg, fw] of Object.entries(CARGO_FRAMEWORKS)) {
    if (raw.includes(pkg)) {
      frameworks.add(fw);
    }
  }

  return { projectName, description, frameworks: [...frameworks] };
}

export function parseGoMod(filePath: string): SeedInfo | null {
  const raw = safeReadFile(filePath);
  if (raw === null) return null;

  let projectName = "";
  const frameworks = new Set<string>();

  // Module name is the last path segment
  const moduleMatch = raw.match(/^module\s+(.+)$/m);
  if (moduleMatch) {
    const modulePath = moduleMatch[1].trim();
    const parts = modulePath.split("/");
    projectName = parts[parts.length - 1];
  }

  for (const [pkg, fw] of Object.entries(GO_FRAMEWORKS)) {
    if (raw.includes(pkg)) {
      frameworks.add(fw);
    }
  }

  return { projectName, description: "", frameworks: [...frameworks] };
}

export function seedLearningMemory(projectRoot: string): LearningMemory {
  const infos: SeedInfo[] = [];

  const pkg = parsePackageJson(join(projectRoot, "package.json"));
  if (pkg) infos.push(pkg);

  const pyproject = parsePyprojectToml(join(projectRoot, "pyproject.toml"));
  if (pyproject) infos.push(pyproject);

  const cargo = parseCargoToml(join(projectRoot, "Cargo.toml"));
  if (cargo) infos.push(cargo);

  const goMod = parseGoMod(join(projectRoot, "go.mod"));
  if (goMod) infos.push(goMod);

  // Pick project name from first metadata file with a name, or fallback to dirname
  const projectName =
    infos.find((i) => i.projectName)?.projectName || basename(projectRoot);

  const mem = createEmptyLearningMemory(projectName);

  // Add project info to Key Learnings
  const firstDesc = infos.find((i) => i.description)?.description;
  if (firstDesc) {
    addEntry(mem, "Key Learnings", `Project: ${projectName} — ${firstDesc}`);
  }

  // Collect all unique frameworks
  const allFrameworks = new Set<string>();
  for (const info of infos) {
    for (const fw of info.frameworks) {
      allFrameworks.add(fw);
    }
  }

  if (allFrameworks.size > 0) {
    addEntry(
      mem,
      "Key Learnings",
      `Detected frameworks: ${[...allFrameworks].sort().join(", ")}`
    );
  }

  return mem;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/seed.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/seed.ts tests/unit/seed.test.ts
git commit -m "feat(learning-memory): add multi-ecosystem initialization seeding"
```

---

### Task 6: Reflection (Pruning)

**Files:**
- Create: `src/core/reflection.ts`
- Test: `tests/unit/reflection.test.ts`

- [ ] **Step 1: Write failing tests for reflection**

```typescript
// tests/unit/reflection.test.ts
import { describe, expect, test } from "bun:test";
import { reflectMemory, mergeDuplicates, trimOldest } from "../../src/core/reflection";
import {
  createEmptyLearningMemory,
  addEntry,
  serializeLearningMemory,
  totalEntryCount,
} from "../../src/core/learning-memory";
import type { LearningMemory } from "../../src/types/learning-memory";

describe("reflection", () => {
  describe("mergeDuplicates", () => {
    test("removes exact duplicate entries within a section", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "Use semicolons");
      addEntry(mem, "User Preferences", "Use semicolons");
      addEntry(mem, "User Preferences", "Prefer const");

      const merged = mergeDuplicates(mem);
      expect(merged.sections["User Preferences"]).toEqual([
        "Use semicolons",
        "Prefer const",
      ]);
    });

    test("removes duplicates with whitespace differences", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "Key Learnings", "API uses rate limiting");
      addEntry(mem, "Key Learnings", "API  uses  rate  limiting");

      const merged = mergeDuplicates(mem);
      expect(merged.sections["Key Learnings"]).toHaveLength(1);
    });

    test("merges Do-Not-Repeat entries with same quoted pattern — keeps newer date", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "Do-Not-Repeat", '[2026-01-01] Never use "var"');
      addEntry(mem, "Do-Not-Repeat", '[2026-04-10] Avoid "var" — always use const');

      const merged = mergeDuplicates(mem);
      expect(merged.sections["Do-Not-Repeat"]).toHaveLength(1);
      expect(merged.sections["Do-Not-Repeat"][0]).toContain("2026-04-10");
    });

    test("does not merge entries with different quoted patterns", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "Do-Not-Repeat", '[2026-01-01] Never use "var"');
      addEntry(mem, "Do-Not-Repeat", '[2026-01-02] Never use "any"');

      const merged = mergeDuplicates(mem);
      expect(merged.sections["Do-Not-Repeat"]).toHaveLength(2);
    });

    test("no-ops when there are no duplicates", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");
      addEntry(mem, "User Preferences", "B");

      const merged = mergeDuplicates(mem);
      expect(merged.sections["User Preferences"]).toEqual(["A", "B"]);
    });

    test("preserves entries across different sections", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "Same text");
      addEntry(mem, "Key Learnings", "Same text");

      const merged = mergeDuplicates(mem);
      expect(merged.sections["User Preferences"]).toEqual(["Same text"]);
      expect(merged.sections["Key Learnings"]).toEqual(["Same text"]);
    });
  });

  describe("trimOldest", () => {
    test("trims Decision Log entries first", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "Decision Log", "[2026-01-01] Old decision");
      addEntry(mem, "Decision Log", "[2026-02-01] Newer decision");
      addEntry(mem, "User Preferences", "Pref A");
      addEntry(mem, "Do-Not-Repeat", "[2026-01-01] Important rule");

      // Trim 1 entry
      const trimmed = trimOldest(mem, 1);
      expect(trimmed.sections["Decision Log"]).toHaveLength(1);
      expect(trimmed.sections["Decision Log"][0]).toContain("Newer decision");
      expect(trimmed.sections["Do-Not-Repeat"]).toHaveLength(1);
      expect(trimmed.sections["User Preferences"]).toHaveLength(1);
    });

    test("trims Key Learnings and User Preferences after Decision Log is empty", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "Key Learnings", "Learning A");
      addEntry(mem, "Key Learnings", "Learning B");
      addEntry(mem, "User Preferences", "Pref A");
      addEntry(mem, "Do-Not-Repeat", "[2026-01-01] Rule");

      // Trim 2 entries — no Decision Log to trim, so goes to Key Learnings then User Preferences
      const trimmed = trimOldest(mem, 2);
      expect(trimmed.sections["Key Learnings"]).toHaveLength(1);
      expect(trimmed.sections["Key Learnings"][0]).toBe("Learning B");
      expect(trimmed.sections["User Preferences"]).toHaveLength(0);
      expect(trimmed.sections["Do-Not-Repeat"]).toHaveLength(1);
    });

    test("trims Do-Not-Repeat last", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "Do-Not-Repeat", "[2026-01-01] Rule A");
      addEntry(mem, "Do-Not-Repeat", "[2026-02-01] Rule B");

      // Trim 1 — only DNR entries available
      const trimmed = trimOldest(mem, 1);
      expect(trimmed.sections["Do-Not-Repeat"]).toHaveLength(1);
      expect(trimmed.sections["Do-Not-Repeat"][0]).toContain("Rule B");
    });

    test("no-ops when trimCount is 0", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");

      const trimmed = trimOldest(mem, 0);
      expect(trimmed.sections["User Preferences"]).toEqual(["A"]);
    });

    test("handles trimming more entries than exist", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");

      const trimmed = trimOldest(mem, 10);
      expect(totalEntryCount(trimmed)).toBe(0);
    });
  });

  describe("reflectMemory", () => {
    test("returns no-op result when under budget", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A short entry");

      const result = reflectMemory(mem, 2000);
      expect(result.result.mergedCount).toBe(0);
      expect(result.result.trimmedCount).toBe(0);
      expect(result.result.withinBudget).toBe(true);
    });

    test("merges duplicates to get under budget", () => {
      const mem = createEmptyLearningMemory("test");
      // Add many duplicate entries to push over a low budget
      for (let i = 0; i < 20; i++) {
        addEntry(mem, "User Preferences", "Duplicate entry content");
      }

      const result = reflectMemory(mem, 2000);
      expect(result.result.mergedCount).toBeGreaterThan(0);
      expect(result.result.withinBudget).toBe(true);
    });

    test("trims oldest when merging is insufficient", () => {
      const mem = createEmptyLearningMemory("test");
      // Add many unique entries to push over a very low budget
      for (let i = 0; i < 50; i++) {
        addEntry(mem, "Decision Log", `[2026-01-${String(i + 1).padStart(2, "0")}] Unique decision number ${i}`);
      }

      const result = reflectMemory(mem, 200);
      expect(result.result.trimmedCount).toBeGreaterThan(0);
      expect(result.result.withinBudget).toBe(true);
    });

    test("returns updated memory", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "Same");
      addEntry(mem, "User Preferences", "Same");

      const { memory } = reflectMemory(mem, 2000);
      expect(memory.sections["User Preferences"]).toHaveLength(1);
    });

    test("handles zero budget — skips pruning", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");

      const result = reflectMemory(mem, 0);
      expect(result.result.withinBudget).toBe(true);
      expect(result.memory.sections["User Preferences"]).toEqual(["A"]);
    });

    test("handles negative budget — skips pruning", () => {
      const mem = createEmptyLearningMemory("test");
      addEntry(mem, "User Preferences", "A");

      const result = reflectMemory(mem, -1);
      expect(result.result.withinBudget).toBe(true);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/reflection.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the reflection module**

```typescript
// src/core/reflection.ts
import type {
  LearningMemory,
  SectionName,
  ReflectionResult,
} from "../types/learning-memory";
import {
  createEmptyLearningMemory,
  serializeLearningMemory,
  totalEntryCount,
} from "./learning-memory";
import { estimateTokens } from "./token-estimate";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractQuoted(entry: string): string | null {
  const match = entry.match(/["']([^"']+)["']/);
  return match ? match[1] : null;
}

function parseDate(entry: string): string {
  const match = entry.match(/^\[(\d{4}-\d{2}-\d{2})\]/);
  return match ? match[1] : "0000-00-00";
}

function estimateMemoryTokens(mem: LearningMemory): number {
  const content = serializeLearningMemory(mem);
  return estimateTokens(content, "learning-memory.md");
}

export function mergeDuplicates(mem: LearningMemory): LearningMemory {
  const merged = createEmptyLearningMemory(mem.projectName);

  const sectionNames: SectionName[] = [
    "User Preferences",
    "Key Learnings",
    "Do-Not-Repeat",
    "Decision Log",
  ];

  for (const section of sectionNames) {
    const entries = mem.sections[section];

    if (section === "Do-Not-Repeat") {
      // Group by quoted pattern, keep the entry with the newest date
      const byPattern = new Map<string, string>();
      const noPattern: string[] = [];

      for (const entry of entries) {
        const quoted = extractQuoted(entry);
        if (quoted) {
          const existing = byPattern.get(quoted);
          if (existing) {
            // Keep the one with the newer date
            if (parseDate(entry) > parseDate(existing)) {
              byPattern.set(quoted, entry);
            }
          } else {
            byPattern.set(quoted, entry);
          }
        } else {
          // No quoted pattern — deduplicate by normalized text
          const norm = normalize(entry);
          if (!noPattern.some((e) => normalize(e) === norm)) {
            noPattern.push(entry);
          }
        }
      }

      merged.sections[section] = [...byPattern.values(), ...noPattern];
    } else {
      // Deduplicate by normalized text
      const seen = new Set<string>();
      for (const entry of entries) {
        const norm = normalize(entry);
        if (!seen.has(norm)) {
          seen.add(norm);
          merged.sections[section].push(entry);
        }
      }
    }
  }

  return merged;
}

// Trim order: Decision Log first, then Key Learnings, then User Preferences, then Do-Not-Repeat last
const TRIM_ORDER: SectionName[] = [
  "Decision Log",
  "Key Learnings",
  "User Preferences",
  "Do-Not-Repeat",
];

export function trimOldest(mem: LearningMemory, trimCount: number): LearningMemory {
  const trimmed = createEmptyLearningMemory(mem.projectName);

  // Deep copy sections
  for (const section of TRIM_ORDER) {
    trimmed.sections[section] = [...mem.sections[section]];
  }

  let remaining = trimCount;

  for (const section of TRIM_ORDER) {
    if (remaining <= 0) break;

    const entries = trimmed.sections[section];
    const toRemove = Math.min(remaining, entries.length);

    if (toRemove > 0) {
      // Remove oldest (first) entries
      trimmed.sections[section] = entries.slice(toRemove);
      remaining -= toRemove;
    }
  }

  return trimmed;
}

export function reflectMemory(
  mem: LearningMemory,
  tokenBudget: number
): { memory: LearningMemory; result: ReflectionResult } {
  // Skip pruning for zero or negative budget
  if (tokenBudget <= 0) {
    const tokens = estimateMemoryTokens(mem);
    return {
      memory: mem,
      result: {
        beforeTokens: tokens,
        afterTokens: tokens,
        mergedCount: 0,
        trimmedCount: 0,
        withinBudget: true,
      },
    };
  }

  const beforeTokens = estimateMemoryTokens(mem);

  if (beforeTokens <= tokenBudget) {
    return {
      memory: mem,
      result: {
        beforeTokens,
        afterTokens: beforeTokens,
        mergedCount: 0,
        trimmedCount: 0,
        withinBudget: true,
      },
    };
  }

  // Step 1: Merge duplicates
  const beforeMergeCount = totalEntryCount(mem);
  let current = mergeDuplicates(mem);
  const afterMergeCount = totalEntryCount(current);
  const mergedCount = beforeMergeCount - afterMergeCount;

  let afterTokens = estimateMemoryTokens(current);

  if (afterTokens <= tokenBudget) {
    return {
      memory: current,
      result: {
        beforeTokens,
        afterTokens,
        mergedCount,
        trimmedCount: 0,
        withinBudget: true,
      },
    };
  }

  // Step 2: Trim oldest, one at a time
  let trimmedCount = 0;

  while (afterTokens > tokenBudget && totalEntryCount(current) > 0) {
    current = trimOldest(current, 1);
    trimmedCount++;
    afterTokens = estimateMemoryTokens(current);
  }

  return {
    memory: current,
    result: {
      beforeTokens,
      afterTokens,
      mergedCount,
      trimmedCount,
      withinBudget: afterTokens <= tokenBudget,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/reflection.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/reflection.ts tests/unit/reflection.test.ts
git commit -m "feat(learning-memory): add reflection with merge and trim pruning"
```

---

### Task 7: Reflect CLI Command

**Files:**
- Create: `src/commands/reflect.ts`
- Create: `tests/unit/reflect-command.test.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write failing tests for the reflect command**

```typescript
// tests/unit/reflect-command.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteText } from "../../src/core/fs-utils";
import {
  createEmptyLearningMemory,
  addEntry,
  serializeLearningMemory,
  parseLearningMemory,
} from "../../src/core/learning-memory";
import { reflect } from "../../src/commands/reflect";

describe("reflect command", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-reflect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns without error when learning memory is missing", () => {
    const result = reflect(dir, join(dir, "learning-memory.md"), join(dir, "config.json"));
    expect(result).toBeNull();
  });

  test("prunes duplicates and saves", () => {
    const mem = createEmptyLearningMemory("test");
    addEntry(mem, "User Preferences", "Duplicate");
    addEntry(mem, "User Preferences", "Duplicate");
    addEntry(mem, "User Preferences", "Unique");

    const memPath = join(dir, "learning-memory.md");
    atomicWriteText(memPath, serializeLearningMemory(mem));

    const result = reflect(dir, memPath, join(dir, "config.json"));
    expect(result).not.toBeNull();

    // Read back the file
    const saved = readFileSync(memPath, "utf-8");
    const parsed = parseLearningMemory(saved);
    expect(parsed.sections["User Preferences"]).toEqual(["Duplicate", "Unique"]);
  });

  test("uses default budget of 2000 when no config", () => {
    const mem = createEmptyLearningMemory("test");
    addEntry(mem, "User Preferences", "Short entry");

    const memPath = join(dir, "learning-memory.md");
    atomicWriteText(memPath, serializeLearningMemory(mem));

    const result = reflect(dir, memPath, join(dir, "config.json"));
    expect(result).not.toBeNull();
    expect(result!.withinBudget).toBe(true);
  });

  test("reads custom budget from config", () => {
    const mem = createEmptyLearningMemory("test");
    for (let i = 0; i < 30; i++) {
      addEntry(mem, "Decision Log", `[2026-01-${String(i + 1).padStart(2, "0")}] Decision ${i} with some extra text to take up space`);
    }

    const memPath = join(dir, "learning-memory.md");
    atomicWriteText(memPath, serializeLearningMemory(mem));

    // Write a config with a very low budget
    const configPath = join(dir, "config.json");
    const { atomicWriteJson } = require("../../src/core/fs-utils");
    atomicWriteJson(configPath, { learningMemoryTokenBudget: 100 });

    const result = reflect(dir, memPath, configPath);
    expect(result).not.toBeNull();
    expect(result!.trimmedCount).toBeGreaterThan(0);
    expect(result!.withinBudget).toBe(true);
  });

  test("does not modify file if already within budget and no duplicates", () => {
    const mem = createEmptyLearningMemory("test");
    addEntry(mem, "User Preferences", "Unique entry");

    const memPath = join(dir, "learning-memory.md");
    const content = serializeLearningMemory(mem);
    atomicWriteText(memPath, content);

    reflect(dir, memPath, join(dir, "config.json"));

    const saved = readFileSync(memPath, "utf-8");
    expect(saved).toBe(content);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/reflect-command.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the reflect command**

```typescript
// src/commands/reflect.ts
import { readFileSync, existsSync } from "fs";
import { atomicWriteText } from "../core/fs-utils";
import { safeReadJson } from "../core/fs-utils";
import {
  parseLearningMemory,
  serializeLearningMemory,
} from "../core/learning-memory";
import { reflectMemory } from "../core/reflection";
import type { ProjectConfig } from "../types/file-index";
import type { ReflectionResult } from "../types/learning-memory";

const DEFAULT_TOKEN_BUDGET = 2000;

export function reflect(
  projectDir: string,
  memoryPath: string,
  configPath: string
): ReflectionResult | null {
  if (!existsSync(memoryPath)) {
    console.log("[mink] no learning memory found");
    return null;
  }

  const content = readFileSync(memoryPath, "utf-8");
  const mem = parseLearningMemory(content);

  // Load token budget from config
  const config = (safeReadJson(configPath) as ProjectConfig) ?? {};
  const budget = config.learningMemoryTokenBudget ?? DEFAULT_TOKEN_BUDGET;

  const { memory, result } = reflectMemory(mem, budget);

  // Only write if something changed
  if (result.mergedCount > 0 || result.trimmedCount > 0) {
    atomicWriteText(memoryPath, serializeLearningMemory(memory));
  }

  console.log("[mink] reflect");
  console.log(
    `  tokens: ${result.beforeTokens} → ${result.afterTokens} (${result.withinBudget ? "within" : "over"} ${budget} budget)`
  );
  if (result.mergedCount > 0) {
    console.log(`  merged: ${result.mergedCount} duplicate entries`);
  }
  if (result.trimmedCount > 0) {
    console.log(`  trimmed: ${result.trimmedCount} stale entries`);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/reflect-command.test.ts`
Expected: All PASS

- [ ] **Step 5: Add `reflect` to CLI routing**

In `src/cli.ts`, add a new case before the `default` case:

```typescript
  case "reflect": {
    const { reflect } = await import("./commands/reflect");
    const { learningMemoryPath, configPath } = await import("./core/paths");
    reflect(cwd, learningMemoryPath(cwd), configPath(cwd));
    break;
  }
```

Also update the usage string:

```typescript
    console.error("Usage: mink <session-start|session-stop|init|scan|reflect>");
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/reflect.ts tests/unit/reflect-command.test.ts src/cli.ts
git commit -m "feat(learning-memory): add mink reflect command with CLI routing"
```

---

### Task 8: Session-Stop Integration

**Files:**
- Modify: `src/commands/session-stop.ts`
- Modify: `tests/unit/session-stop.test.ts`

- [ ] **Step 1: Write failing test for reflect-on-stop behavior**

Add to `tests/unit/session-stop.test.ts`:

```typescript
  test("calls reflect on session stop", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    // Create a learning memory with duplicates
    const memPath = join(dir, "learning-memory.md");
    writeFileSync(
      memPath,
      [
        "# Learning Memory — test",
        "",
        "## User Preferences",
        "",
        "- Duplicate",
        "- Duplicate",
        "",
        "## Key Learnings",
        "",
        "## Do-Not-Repeat",
        "",
        "## Decision Log",
        "",
      ].join("\n")
    );

    sessionStop(sessionFile);

    // Verify duplicates were merged
    const saved = readFileSync(memPath, "utf-8");
    const occurrences = saved.split("- Duplicate").length - 1;
    expect(occurrences).toBe(1);
  });
```

Add `readFileSync` to the imports at the top of the file if not already present.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/session-stop.test.ts`
Expected: FAIL — duplicate not merged (reflect not wired yet)

- [ ] **Step 3: Update session-stop to call reflect and use learningMemoryPath**

Replace the `isLearningMemoryStale` function and its usage in `src/commands/session-stop.ts`:

```typescript
import { statSync, existsSync } from "fs";
import { join, dirname } from "path";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { isSessionState, buildSummary } from "../core/session";
import { reflect } from "./reflect";
import type { SessionState, SessionFinalizer } from "../types/session";

const noopFinalizer: SessionFinalizer = {
  appendSession() {},
  updateSession() {},
};

function hasActivity(state: SessionState): boolean {
  return Object.keys(state.reads).length > 0 || state.writes.length > 0;
}

function getEditCounts(state: SessionState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const write of state.writes) {
    counts[write.filePath] = (counts[write.filePath] || 0) + 1;
  }
  return counts;
}

function isLearningMemoryStale(memoryPath: string): boolean {
  try {
    const stat = statSync(memoryPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return ageMs > twentyFourHours;
  } catch {
    return false;
  }
}

export function sessionStop(
  sessionFile: string,
  finalizer: SessionFinalizer = noopFinalizer,
  onReminder: (msg: string) => void = (msg) => console.error(msg)
): void {
  const raw = safeReadJson(sessionFile);
  if (!isSessionState(raw)) {
    if (raw !== null) {
      console.error("[mink] session.json is corrupt — skipping finalization");
    }
    return;
  }

  const state: SessionState = raw;
  state.stopCount++;

  if (hasActivity(state)) {
    const summary = buildSummary(state);

    if (state.stopCount === 1) {
      finalizer.appendSession(summary);
    } else {
      finalizer.updateSession(summary);
    }
  }

  // Check for files edited 3+ times
  const editCounts = getEditCounts(state);
  for (const [filePath, count] of Object.entries(editCounts)) {
    if (count >= 3) {
      onReminder(
        `[mink] ${filePath} was edited ${count} times — consider logging a bug`
      );
    }
  }

  // Run reflection on learning memory
  const projDir = dirname(sessionFile);
  const memoryPath = join(projDir, "learning-memory.md");
  const cfgPath = join(projDir, "config.json");

  if (existsSync(memoryPath)) {
    reflect(projDir, memoryPath, cfgPath);
  }

  // Check if learning memory is stale (>24h since last update)
  if (isLearningMemoryStale(memoryPath)) {
    onReminder(
      "[mink] learning memory hasn't been updated in 24+ hours — consider reviewing it"
    );
  }

  atomicWriteJson(sessionFile, state);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/session-stop.test.ts`
Expected: All PASS

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `bun test`
Expected: All existing tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/session-stop.ts tests/unit/session-stop.test.ts
git commit -m "feat(learning-memory): wire reflect into session-stop"
```

---

### Task 9: Init Integration

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `tests/unit/init.test.ts`

- [ ] **Step 1: Write failing test for seed-on-init**

Add to `tests/unit/init.test.ts`:

```typescript
  test("creates learning memory on init", async () => {
    // After init, learning-memory.md should exist in project dir
    // We need to verify init calls seedLearningMemory
    // Use a temp project directory with a package.json

    const projectDir = mkdtempSync(join(tmpdir(), "mink-init-seed-"));
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "test-project", description: "A test", dependencies: { react: "^18" } })
    );

    await init(projectDir);

    const memPath = join(dir, "learning-memory.md");
    // Note: the actual path is in ~/.mink/projects/<slug>/
    // We need to check the project dir — use paths helper
    const { learningMemoryPath } = await import("../../src/core/paths");
    const actualPath = learningMemoryPath(projectDir);
    expect(existsSync(actualPath)).toBe(true);

    const content = readFileSync(actualPath, "utf-8");
    expect(content).toContain("test-project");
    expect(content).toContain("React");

    rmSync(projectDir, { recursive: true, force: true });
  });
```

Add `existsSync, readFileSync` to imports. Adjust based on existing test patterns in `init.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/unit/init.test.ts`
Expected: FAIL — learning-memory.md not created

- [ ] **Step 3: Update init.ts to seed learning memory**

Add to `src/commands/init.ts`, in the `init` function, after the scan call:

```typescript
  // Seed learning memory if it doesn't exist
  const { learningMemoryPath } = await import("../core/paths");
  const memPath = learningMemoryPath(cwd);
  if (!existsSync(memPath)) {
    const { seedLearningMemory } = await import("../core/seed");
    const { serializeLearningMemory } = await import("../core/learning-memory");
    const { atomicWriteText } = await import("../core/fs-utils");
    const mem = seedLearningMemory(cwd);
    atomicWriteText(memPath, serializeLearningMemory(mem));
  }
```

Add `existsSync` to the `fs` import at the top of the file.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/unit/init.test.ts`
Expected: All PASS

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `bun test`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/commands/init.ts tests/unit/init.test.ts
git commit -m "feat(learning-memory): seed learning memory on mink init"
```

---

### Task 10: Integration Tests

**Files:**
- Create: `tests/integration/learning-memory.test.ts`

- [ ] **Step 1: Write integration tests**

```typescript
// tests/integration/learning-memory.test.ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteText } from "../../src/core/fs-utils";
import { seedLearningMemory } from "../../src/core/seed";
import {
  parseLearningMemory,
  serializeLearningMemory,
  addEntry,
  createEmptyLearningMemory,
} from "../../src/core/learning-memory";
import { extractPatterns, matchPatterns } from "../../src/core/pattern-engine";
import { reflectMemory } from "../../src/core/reflection";
import { reflect } from "../../src/commands/reflect";

describe("learning memory integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-lm-int-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("full lifecycle: seed → add entries → reflect → verify", () => {
    // Seed
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "lifecycle-test",
        description: "Integration test project",
        dependencies: { express: "^4.0", typescript: "^5.0" },
      })
    );

    const mem = seedLearningMemory(dir);
    expect(mem.projectName).toBe("lifecycle-test");
    expect(mem.sections["Key Learnings"].join(" ")).toContain("Express");

    // Add entries
    addEntry(mem, "User Preferences", "Prefer named exports");
    addEntry(mem, "Do-Not-Repeat", '[2026-04-10] Never use "var" — always const');
    addEntry(mem, "Decision Log", "[2026-04-10] Use Express over Koa");

    // Save
    const memPath = join(dir, "learning-memory.md");
    atomicWriteText(memPath, serializeLearningMemory(mem));

    // Read back and verify round-trip
    const saved = readFileSync(memPath, "utf-8");
    const parsed = parseLearningMemory(saved);
    expect(parsed.projectName).toBe("lifecycle-test");
    expect(parsed.sections["User Preferences"]).toContain("Prefer named exports");
    expect(parsed.sections["Do-Not-Repeat"]).toHaveLength(1);
  });

  test("pattern extraction → matching end-to-end", () => {
    const mem = createEmptyLearningMemory("test");
    addEntry(mem, "Do-Not-Repeat", '[2026-04-10] Never use "var" — always const');
    addEntry(mem, "Do-Not-Repeat", "[2026-04-10] Avoid mocking the database in integration tests");

    const patterns = extractPatterns(mem.sections["Do-Not-Repeat"]);

    // Should match "var" in code
    const codeWithVar = 'function foo() { var x = 5; return x; }';
    const varMatches = matchPatterns(patterns, codeWithVar);
    expect(varMatches.length).toBeGreaterThan(0);
    expect(varMatches.some((m) => m.matchedText === "var")).toBe(true);

    // Should match "mocking the database" in test code
    const testCode = 'describe("api", () => { mocking the database for speed });';
    const mockMatches = matchPatterns(patterns, testCode);
    expect(mockMatches.length).toBeGreaterThan(0);

    // Should NOT match clean code
    const cleanCode = 'const x = 5; const db = connectReal();';
    const noMatches = matchPatterns(patterns, cleanCode);
    expect(noMatches).toHaveLength(0);
  });

  test("reflect command prunes bloated memory via file", () => {
    const mem = createEmptyLearningMemory("test");
    // Add many entries to exceed a low budget
    for (let i = 0; i < 30; i++) {
      addEntry(mem, "Decision Log", `[2026-01-${String(i + 1).padStart(2, "0")}] Decision ${i} with padding text`);
    }
    addEntry(mem, "Do-Not-Repeat", '[2026-04-10] Never use "eval"');

    const memPath = join(dir, "learning-memory.md");
    atomicWriteText(memPath, serializeLearningMemory(mem));

    // Config with low budget
    const configPath = join(dir, "config.json");
    writeFileSync(configPath, JSON.stringify({ learningMemoryTokenBudget: 200 }));

    const result = reflect(dir, memPath, configPath);
    expect(result).not.toBeNull();
    expect(result!.withinBudget).toBe(true);
    expect(result!.trimmedCount).toBeGreaterThan(0);

    // Do-Not-Repeat should survive (trimmed last)
    const saved = readFileSync(memPath, "utf-8");
    const parsed = parseLearningMemory(saved);
    expect(parsed.sections["Do-Not-Repeat"].length).toBeGreaterThanOrEqual(1);
  });

  test("corrupted learning memory file is handled gracefully", () => {
    const memPath = join(dir, "learning-memory.md");
    writeFileSync(memPath, "completely garbled \x00\x01\x02 content");

    // parseLearningMemory should not throw
    const content = readFileSync(memPath, "utf-8");
    const parsed = parseLearningMemory(content);
    expect(parsed.projectName).toBe("unknown");
    expect(parsed.sections["User Preferences"]).toEqual([]);
  });

  test("empty project seeds with directory name only", () => {
    const mem = seedLearningMemory(dir);
    expect(mem.projectName).toBeTruthy();
    expect(mem.sections["Key Learnings"]).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bun test tests/integration/learning-memory.test.ts`
Expected: All PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All PASS across all test files

- [ ] **Step 4: Commit**

```bash
git add tests/integration/learning-memory.test.ts
git commit -m "test(learning-memory): add integration tests for full lifecycle"
```

---

### Task 11: E2E Smoke Test

**Files:** None (manual verification)

- [ ] **Step 1: Run `mink init` in a test project**

```bash
cd /tmp && mkdir smoke-lm && cd smoke-lm
echo '{"name":"smoke","description":"Smoke test","dependencies":{"express":"^4"}}' > package.json
bun /Users/drewpayment/dev/mink/src/cli.ts init
```

Expected: Output shows initialized, learning memory file created.

- [ ] **Step 2: Verify learning memory was created with seed content**

```bash
cat ~/.mink/projects/smoke-*/learning-memory.md
```

Expected: Contains `# Learning Memory — smoke`, Key Learnings with Express detected, all 4 sections present.

- [ ] **Step 3: Run `mink reflect`**

```bash
bun /Users/drewpayment/dev/mink/src/cli.ts reflect
```

Expected: Output shows token count, within budget, no merges or trims needed.

- [ ] **Step 4: Clean up**

```bash
rm -rf /tmp/smoke-lm ~/.mink/projects/smoke-*
```

---

## Self-Review

**Spec coverage check:**

| Spec Requirement | Task |
|-----------------|------|
| Four-section structure | Task 1 (types), Task 2 (parse/serialize) |
| Initialization seeding from metadata | Task 5 (seed), Task 9 (init integration) |
| Manual updates (add/remove entries) | Task 2 (CRUD functions) |
| Pattern extraction from Do-Not-Repeat | Task 4 (pattern engine) |
| Pattern matching against content | Task 4 (matchPatterns) |
| Non-blocking warnings only | Task 4 (returns matches, never blocks) |
| Token budget enforcement | Task 6 (reflection) |
| Merge duplicates, then trim oldest | Task 6 (mergeDuplicates, trimOldest) |
| `mink reflect` CLI command | Task 7 |
| Session-stop calls reflect | Task 8 |
| Staleness reminder (>24h) | Task 8 (preserved from existing code) |
| Init seeds learning memory | Task 9 |
| Corrupted file recovery | Task 2 (parseLearningMemory handles any input), Task 10 (edge test) |
| Multiple matching warnings | Task 4 (matchPatterns returns all matches), Task 10 (integration test) |

**Placeholder scan:** No TBD, TODO, or vague instructions found.

**Type consistency:** `LearningMemory`, `SectionName`, `ExtractedPattern`, `PatternMatch`, `ReflectionResult`, `SeedInfo` — all used consistently across tasks 1-10. Function signatures match between implementation and test code.
