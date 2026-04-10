# Session Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Mink's session lifecycle — the foundation that creates ephemeral session state on start, tracks reads/writes mid-session, and consolidates data on stop.

**Architecture:** Flat JSON state files under `~/.mink/projects/<slug>/`. Each Claude Code hook invocation spawns a short-lived CLI process that reads `session.json`, updates it, and writes it back atomically. Downstream systems (token ledger, action log) are called through a `SessionFinalizer` interface that ships as a no-op stub.

**Tech Stack:** TypeScript, Bun (runtime + test runner + package manager), Node.js fallback

**Design doc:** `docs/superpowers/specs/2026-04-10-session-lifecycle-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `package.json` | Project metadata, dependencies, bin entry |
| `tsconfig.json` | TypeScript config |
| `src/types/session.ts` | All TypeScript interfaces (SessionState, FileRead, WriteEntry, SessionSummary, SessionFinalizer) |
| `src/core/project-id.ts` | Generate slug from cwd: slugified basename + 6-char hash of absolute path |
| `src/core/paths.ts` | Resolve all `~/.mink/` paths: root, project dir, session.json |
| `src/core/fs-utils.ts` | `atomicWriteJson`, `safeReadJson` — crash-safe I/O with temp+rename |
| `src/core/session.ts` | Session state CRUD: `createSession`, `readSession`, `recordRead`, `recordWrite`, `buildSummary`, `calculateSavings` |
| `src/commands/session-start.ts` | CLI handler: create fresh session state, call downstream stubs |
| `src/commands/session-stop.ts` | CLI handler: finalize session, savings calc, call downstream stubs, emit reminders |
| `src/commands/init.ts` | CLI handler: detect runtime, wire hooks into `.claude/settings.json` |
| `src/cli.ts` | Entry point: parse argv, route to command handlers |
| `tests/unit/project-id.test.ts` | Tests for slug generation |
| `tests/unit/fs-utils.test.ts` | Tests for atomic write and safe read |
| `tests/unit/session.test.ts` | Tests for session CRUD, summary, savings |
| `tests/unit/session-stop.test.ts` | Tests for stop handler logic (stopCount, zero activity, reminders) |
| `tests/unit/init.test.ts` | Tests for runtime detection and settings.json merging |
| `tests/integration/lifecycle.test.ts` | Full start → reads → writes → stop → verify |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "mink",
  "version": "0.1.0",
  "description": "A hidden presence that moves alongside the developer — token efficiency and cross-project wiki for AI coding assistants",
  "type": "module",
  "bin": {
    "mink": "./src/cli.ts"
  },
  "scripts": {
    "test": "bun test",
    "test:watch": "bun test --watch"
  },
  "files": [
    "src/**/*.ts"
  ],
  "license": "MIT"
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Install bun-types**

Run: `bun add -d bun-types`

- [ ] **Step 4: Verify setup**

Run: `bun test`
Expected: "0 tests" or similar — no errors about missing config.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json bun.lock
git commit -m "chore: scaffold mink project with Bun"
```

---

## Task 2: TypeScript Interfaces

**Files:**
- Create: `src/types/session.ts`

- [ ] **Step 1: Write all type definitions**

```typescript
export interface FileRead {
  readCount: number;
  estimatedTokens: number;
  firstReadAt: string; // ISO 8601 UTC
}

export interface WriteEntry {
  filePath: string;
  action: "create" | "edit";
  estimatedTokens: number;
  timestamp: string; // ISO 8601 UTC
}

export interface SessionCounters {
  fileIndexHits: number;
  fileIndexMisses: number;
  repeatedReadWarnings: number;
  learnedRuleWarnings: number;
}

export interface SessionState {
  sessionId: string;
  startTimestamp: string; // ISO 8601 UTC
  stopCount: number;
  reads: Record<string, FileRead>;
  writes: WriteEntry[];
  counters: SessionCounters;
}

export interface SessionSummary {
  sessionId: string;
  startTimestamp: string;
  endTimestamp: string;
  reads: Array<{ filePath: string } & FileRead>;
  writes: WriteEntry[];
  totals: {
    readCount: number;
    writeCount: number;
    estimatedTokens: number;
    repeatedReads: number;
  };
  estimatedSavings: number;
}

export interface SessionFinalizer {
  appendSession(summary: SessionSummary): void;
  updateSession(summary: SessionSummary): void;
}
```

- [ ] **Step 2: Verify types compile**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/session.ts
git commit -m "feat: add session lifecycle type definitions"
```

---

## Task 3: Project ID Generation

**Files:**
- Create: `src/core/project-id.ts`
- Create: `tests/unit/project-id.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { generateProjectId } from "../../src/core/project-id";

describe("generateProjectId", () => {
  test("returns slugified basename with hash suffix", () => {
    const id = generateProjectId("/Users/drew/dev/my-project");
    // Format: <slug>-<6 hex chars>
    expect(id).toMatch(/^my-project-[a-f0-9]{6}$/);
  });

  test("is deterministic for the same path", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/dev/my-project");
    expect(a).toBe(b);
  });

  test("produces different IDs for same basename in different directories", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/work/my-project");
    expect(a).not.toBe(b);
  });

  test("handles uppercase and special characters in basename", () => {
    const id = generateProjectId("/Users/drew/dev/My Cool_Project!");
    expect(id).toMatch(/^my-cool-project-[a-f0-9]{6}$/);
  });

  test("handles trailing slashes", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/dev/my-project/");
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/project-id.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement project-id.ts**

```typescript
import { createHash } from "crypto";
import { basename } from "path";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateProjectId(absolutePath: string): string {
  const normalized = absolutePath.replace(/\/+$/, "");
  const slug = slugify(basename(normalized));
  const hash = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 6);
  return `${slug}-${hash}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/project-id.test.ts`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/project-id.ts tests/unit/project-id.test.ts
git commit -m "feat: add project ID generation (slug + path hash)"
```

---

## Task 4: Path Resolution

**Files:**
- Create: `src/core/paths.ts`

- [ ] **Step 1: Write the path resolver**

```typescript
import { join } from "path";
import { homedir } from "os";
import { generateProjectId } from "./project-id";

const MINK_ROOT = join(homedir(), ".mink");

export function minkRoot(): string {
  return MINK_ROOT;
}

export function projectDir(cwd: string): string {
  const id = generateProjectId(cwd);
  return join(MINK_ROOT, "projects", id);
}

export function sessionPath(cwd: string): string {
  return join(projectDir(cwd), "session.json");
}
```

This module is thin glue — no separate test file. It's exercised by integration tests and the tests for modules that use it.

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/core/paths.ts
git commit -m "feat: add ~/.mink path resolution"
```

---

## Task 5: Atomic File I/O

**Files:**
- Create: `src/core/fs-utils.ts`
- Create: `tests/unit/fs-utils.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";

describe("atomicWriteJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes valid JSON to file", () => {
    const filePath = join(dir, "test.json");
    atomicWriteJson(filePath, { key: "value" });
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content).toEqual({ key: "value" });
  });

  test("overwrites existing file", () => {
    const filePath = join(dir, "test.json");
    atomicWriteJson(filePath, { version: 1 });
    atomicWriteJson(filePath, { version: 2 });
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content).toEqual({ version: 2 });
  });

  test("does not leave .tmp file on success", () => {
    const filePath = join(dir, "test.json");
    atomicWriteJson(filePath, { key: "value" });
    const files = Bun.file(filePath + ".tmp");
    expect(files.size).toBe(0);
  });
});

describe("safeReadJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads valid JSON file", () => {
    const filePath = join(dir, "test.json");
    writeFileSync(filePath, JSON.stringify({ key: "value" }));
    const result = safeReadJson(filePath);
    expect(result).toEqual({ key: "value" });
  });

  test("returns null for missing file", () => {
    const result = safeReadJson(join(dir, "nope.json"));
    expect(result).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    const filePath = join(dir, "bad.json");
    writeFileSync(filePath, "not json {{{");
    const result = safeReadJson(filePath);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/fs-utils.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement fs-utils.ts**

```typescript
import { writeFileSync, readFileSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";

export function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = filePath + ".tmp";
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}

export function safeReadJson(filePath: string): unknown | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/fs-utils.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/fs-utils.ts tests/unit/fs-utils.test.ts
git commit -m "feat: add atomic JSON write and safe read utilities"
```

---

## Task 6: Session State CRUD

**Files:**
- Create: `src/core/session.ts`
- Create: `tests/unit/session.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import {
  createSessionState,
  recordRead,
  recordWrite,
  buildSummary,
  calculateSavings,
  isSessionState,
} from "../../src/core/session";
import type { SessionState } from "../../src/types/session";

describe("createSessionState", () => {
  test("generates a session ID with ISO timestamp and hex suffix", () => {
    const state = createSessionState();
    // Format: YYYY-MM-DDTHH:MM:SS.sssZ-<4 hex>
    expect(state.sessionId).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z-[a-f0-9]{4}$/
    );
  });

  test("starts with zeroed counters and empty collections", () => {
    const state = createSessionState();
    expect(state.stopCount).toBe(0);
    expect(state.reads).toEqual({});
    expect(state.writes).toEqual([]);
    expect(state.counters).toEqual({
      fileIndexHits: 0,
      fileIndexMisses: 0,
      repeatedReadWarnings: 0,
      learnedRuleWarnings: 0,
    });
  });

  test("generates unique IDs on successive calls", () => {
    const a = createSessionState();
    const b = createSessionState();
    expect(a.sessionId).not.toBe(b.sessionId);
  });
});

describe("recordRead", () => {
  test("creates new entry on first read", () => {
    const state = createSessionState();
    recordRead(state, "/src/app.ts", 150, true);
    expect(state.reads["/src/app.ts"]).toBeDefined();
    expect(state.reads["/src/app.ts"].readCount).toBe(1);
    expect(state.reads["/src/app.ts"].estimatedTokens).toBe(150);
    expect(state.counters.fileIndexHits).toBe(1);
  });

  test("increments readCount on repeated read", () => {
    const state = createSessionState();
    recordRead(state, "/src/app.ts", 150, true);
    recordRead(state, "/src/app.ts", 150, true);
    expect(state.reads["/src/app.ts"].readCount).toBe(2);
  });

  test("tracks index misses", () => {
    const state = createSessionState();
    recordRead(state, "/src/app.ts", 150, false);
    expect(state.counters.fileIndexHits).toBe(0);
    expect(state.counters.fileIndexMisses).toBe(1);
  });

  test("preserves firstReadAt on repeated reads", () => {
    const state = createSessionState();
    recordRead(state, "/src/app.ts", 150, true);
    const firstReadAt = state.reads["/src/app.ts"].firstReadAt;
    recordRead(state, "/src/app.ts", 150, true);
    expect(state.reads["/src/app.ts"].firstReadAt).toBe(firstReadAt);
  });
});

describe("recordWrite", () => {
  test("appends write entry", () => {
    const state = createSessionState();
    recordWrite(state, "/src/app.ts", "edit", 200);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].filePath).toBe("/src/app.ts");
    expect(state.writes[0].action).toBe("edit");
    expect(state.writes[0].estimatedTokens).toBe(200);
  });

  test("preserves insertion order", () => {
    const state = createSessionState();
    recordWrite(state, "/src/a.ts", "create", 100);
    recordWrite(state, "/src/b.ts", "edit", 200);
    recordWrite(state, "/src/c.ts", "edit", 300);
    expect(state.writes.map((w) => w.filePath)).toEqual([
      "/src/a.ts",
      "/src/b.ts",
      "/src/c.ts",
    ]);
  });
});

describe("calculateSavings", () => {
  test("returns 0 for empty session", () => {
    const state = createSessionState();
    expect(calculateSavings(state)).toBe(0);
  });

  test("counts 200 per file index hit", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, true);
    recordRead(state, "/src/c.ts", 300, false);
    // 2 hits × 200 = 400
    expect(calculateSavings(state)).toBe(400);
  });

  test("adds repeated read token costs", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/a.ts", 100, true); // repeated, 100 tokens saved
    recordRead(state, "/src/a.ts", 100, true); // repeated again, another 100
    // 1 hit × 200 + 2 repeated × 100 = 400
    // Note: index hit counted once per unique file, not per read
    expect(calculateSavings(state)).toBe(400);
  });
});

describe("buildSummary", () => {
  test("builds correct summary from session state", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/b.ts", 200, false);
    recordWrite(state, "/src/c.ts", "create", 300);

    const summary = buildSummary(state);
    expect(summary.sessionId).toBe(state.sessionId);
    expect(summary.reads).toHaveLength(2);
    expect(summary.writes).toHaveLength(1);
    expect(summary.totals.readCount).toBe(2);
    expect(summary.totals.writeCount).toBe(1);
    expect(summary.totals.estimatedTokens).toBe(600);
    expect(summary.totals.repeatedReads).toBe(0);
  });

  test("counts repeated reads in totals", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    recordRead(state, "/src/a.ts", 100, true);
    const summary = buildSummary(state);
    expect(summary.totals.repeatedReads).toBe(1);
  });
});

describe("isSessionState", () => {
  test("returns true for valid session state", () => {
    const state = createSessionState();
    expect(isSessionState(state)).toBe(true);
  });

  test("returns false for null", () => {
    expect(isSessionState(null)).toBe(false);
  });

  test("returns false for object with missing fields", () => {
    expect(isSessionState({ sessionId: "x" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement session.ts**

```typescript
import { randomBytes } from "crypto";
import type {
  SessionState,
  SessionSummary,
  FileRead,
} from "../types/session";

export function createSessionState(): SessionState {
  const now = new Date().toISOString();
  const suffix = randomBytes(2).toString("hex");
  return {
    sessionId: `${now}-${suffix}`,
    startTimestamp: now,
    stopCount: 0,
    reads: {},
    writes: [],
    counters: {
      fileIndexHits: 0,
      fileIndexMisses: 0,
      repeatedReadWarnings: 0,
      learnedRuleWarnings: 0,
    },
  };
}

export function recordRead(
  state: SessionState,
  filePath: string,
  estimatedTokens: number,
  indexHit: boolean
): void {
  const existing = state.reads[filePath];
  if (existing) {
    existing.readCount++;
  } else {
    state.reads[filePath] = {
      readCount: 1,
      estimatedTokens,
      firstReadAt: new Date().toISOString(),
    };
  }

  if (indexHit) {
    state.counters.fileIndexHits++;
  } else {
    state.counters.fileIndexMisses++;
  }
}

export function recordWrite(
  state: SessionState,
  filePath: string,
  action: "create" | "edit",
  estimatedTokens: number
): void {
  state.writes.push({
    filePath,
    action,
    estimatedTokens,
    timestamp: new Date().toISOString(),
  });
}

export function calculateSavings(state: SessionState): number {
  const indexSavings = state.counters.fileIndexHits * 200;

  let repeatedReadSavings = 0;
  for (const read of Object.values(state.reads)) {
    if (read.readCount > 1) {
      repeatedReadSavings += (read.readCount - 1) * read.estimatedTokens;
    }
  }

  return indexSavings + repeatedReadSavings;
}

export function buildSummary(state: SessionState): SessionSummary {
  const reads = Object.entries(state.reads).map(([filePath, read]) => ({
    filePath,
    ...read,
  }));

  let totalTokens = 0;
  for (const read of Object.values(state.reads)) {
    totalTokens += read.estimatedTokens;
  }
  for (const write of state.writes) {
    totalTokens += write.estimatedTokens;
  }

  let repeatedReads = 0;
  for (const read of Object.values(state.reads)) {
    if (read.readCount > 1) {
      repeatedReads += read.readCount - 1;
    }
  }

  return {
    sessionId: state.sessionId,
    startTimestamp: state.startTimestamp,
    endTimestamp: new Date().toISOString(),
    reads,
    writes: state.writes,
    totals: {
      readCount: Object.keys(state.reads).length,
      writeCount: state.writes.length,
      estimatedTokens: totalTokens,
      repeatedReads,
    },
    estimatedSavings: calculateSavings(state),
  };
}

export function isSessionState(value: unknown): value is SessionState {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.sessionId === "string" &&
    typeof obj.startTimestamp === "string" &&
    typeof obj.stopCount === "number" &&
    typeof obj.reads === "object" &&
    obj.reads !== null &&
    Array.isArray(obj.writes) &&
    typeof obj.counters === "object" &&
    obj.counters !== null
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/session.test.ts`
Expected: All 14 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/session.ts tests/unit/session.test.ts
git commit -m "feat: add session state CRUD, summary, and savings calculation"
```

---

## Task 7: Session Start Command

**Files:**
- Create: `src/commands/session-start.ts`

- [ ] **Step 1: Implement session-start command**

```typescript
import { mkdirSync } from "fs";
import { createSessionState } from "../core/session";
import { projectDir, sessionPath } from "../core/paths";
import { atomicWriteJson } from "../core/fs-utils";

export function sessionStart(cwd: string): void {
  const dir = projectDir(cwd);
  mkdirSync(dir, { recursive: true });

  const state = createSessionState();
  atomicWriteJson(sessionPath(cwd), state);

  // Downstream stubs (specs 04, 08):
  // - Append session header to action log
  // - Increment lifetime session counter in token ledger
}
```

- [ ] **Step 2: Verify it compiles**

Run: `bunx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/session-start.ts
git commit -m "feat: add session-start command"
```

---

## Task 8: Session Stop Command

**Files:**
- Create: `src/commands/session-stop.ts`
- Create: `tests/unit/session-stop.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import {
  createSessionState,
  recordRead,
  recordWrite,
} from "../../src/core/session";
import { sessionStop } from "../../src/commands/session-stop";
import type { SessionState, SessionSummary } from "../../src/types/session";

// Helper: write session state to a temp dir and return paths
function setupSession(dir: string, state: SessionState) {
  const sessionFile = join(dir, "session.json");
  atomicWriteJson(sessionFile, state);
  return sessionFile;
}

describe("sessionStop", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("increments stopCount on first stop", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    sessionStop(sessionFile);

    const updated = safeReadJson(sessionFile) as SessionState;
    expect(updated.stopCount).toBe(1);
  });

  test("calls finalizer on first stop with activity", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    let captured: SessionSummary | null = null;
    const finalizer = {
      appendSession(summary: SessionSummary) {
        captured = summary;
      },
      updateSession() {},
    };

    sessionStop(sessionFile, finalizer);

    expect(captured).not.toBeNull();
    expect(captured!.totals.readCount).toBe(1);
  });

  test("calls updateSession on second stop", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    state.stopCount = 1; // simulate first stop already happened
    const sessionFile = setupSession(dir, state);

    let updateCalled = false;
    const finalizer = {
      appendSession() {},
      updateSession() {
        updateCalled = true;
      },
    };

    sessionStop(sessionFile, finalizer);

    expect(updateCalled).toBe(true);
    const updated = safeReadJson(sessionFile) as SessionState;
    expect(updated.stopCount).toBe(2);
  });

  test("skips finalization on zero activity", () => {
    const state = createSessionState();
    const sessionFile = setupSession(dir, state);

    let finalizerCalled = false;
    const finalizer = {
      appendSession() {
        finalizerCalled = true;
      },
      updateSession() {
        finalizerCalled = true;
      },
    };

    sessionStop(sessionFile, finalizer);

    expect(finalizerCalled).toBe(false);
    const updated = safeReadJson(sessionFile) as SessionState;
    expect(updated.stopCount).toBe(1);
  });

  test("handles missing session file gracefully", () => {
    const sessionFile = join(dir, "nope.json");
    // Should not throw
    expect(() => sessionStop(sessionFile)).not.toThrow();
  });

  test("handles corrupt session file gracefully", () => {
    const sessionFile = join(dir, "session.json");
    Bun.write(sessionFile, "not json {{{");
    expect(() => sessionStop(sessionFile)).not.toThrow();
  });

  test("emits reminder for files edited 3+ times", () => {
    const state = createSessionState();
    recordWrite(state, "/src/a.ts", "edit", 100);
    recordWrite(state, "/src/a.ts", "edit", 100);
    recordWrite(state, "/src/a.ts", "edit", 100);
    const sessionFile = setupSession(dir, state);

    const reminders: string[] = [];
    sessionStop(sessionFile, undefined, (msg: string) => reminders.push(msg));

    expect(reminders.length).toBeGreaterThanOrEqual(1);
    expect(reminders[0]).toContain("/src/a.ts");
    expect(reminders[0]).toContain("3");
  });

  test("emits reminder when learning memory is stale", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    // Create a stale learning-memory.md (mtime > 24h ago)
    const memoryPath = join(dir, "learning-memory.md");
    writeFileSync(memoryPath, "# Learning Memory");
    const past = Date.now() - 25 * 60 * 60 * 1000;
    utimesSync(memoryPath, new Date(past), new Date(past));

    const reminders: string[] = [];
    sessionStop(sessionFile, undefined, (msg: string) => reminders.push(msg));

    expect(reminders.some((r) => r.includes("learning memory"))).toBe(true);
  });

  test("does not emit learning memory reminder when recently updated", () => {
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    const sessionFile = setupSession(dir, state);

    // Create a fresh learning-memory.md
    const memoryPath = join(dir, "learning-memory.md");
    writeFileSync(memoryPath, "# Learning Memory");

    const reminders: string[] = [];
    sessionStop(sessionFile, undefined, (msg: string) => reminders.push(msg));

    expect(reminders.some((r) => r.includes("learning memory"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/session-stop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement session-stop.ts**

```typescript
import { statSync } from "fs";
import { join, dirname } from "path";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import {
  isSessionState,
  buildSummary,
} from "../core/session";
import type { SessionState, SessionFinalizer } from "../types/session";

const noopFinalizer: SessionFinalizer = {
  appendSession() {},
  updateSession() {},
};

function hasActivity(state: SessionState): boolean {
  return (
    Object.keys(state.reads).length > 0 || state.writes.length > 0
  );
}

function getEditCounts(state: SessionState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const write of state.writes) {
    counts[write.filePath] = (counts[write.filePath] || 0) + 1;
  }
  return counts;
}

function isLearningMemoryStale(projectDir: string): boolean {
  const memoryPath = join(projectDir, "learning-memory.md");
  try {
    const stat = statSync(memoryPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return ageMs > twentyFourHours;
  } catch {
    // File doesn't exist yet — not stale, just absent
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

  // Check if learning memory is stale (>24h since last update)
  const projectDir = dirname(sessionFile);
  if (isLearningMemoryStale(projectDir)) {
    onReminder(
      "[mink] learning memory hasn't been updated in 24+ hours — consider reviewing it"
    );
  }

  atomicWriteJson(sessionFile, state);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/session-stop.test.ts`
Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/session-stop.ts tests/unit/session-stop.test.ts
git commit -m "feat: add session-stop command with finalization and reminders"
```

---

## Task 9: CLI Entry Point

**Files:**
- Create: `src/cli.ts`

- [ ] **Step 1: Implement CLI router**

```typescript
#!/usr/bin/env bun
import { sessionStart } from "./commands/session-start";
import { sessionStop } from "./commands/session-stop";
import { sessionPath } from "./core/paths";

const command = process.argv[2];
const cwd = process.cwd();

switch (command) {
  case "session-start":
    sessionStart(cwd);
    break;

  case "session-stop":
    sessionStop(sessionPath(cwd));
    break;

  case "init":
    // Task 10
    console.error("[mink] init not yet implemented");
    process.exit(1);
    break;

  default:
    console.error(`[mink] unknown command: ${command}`);
    console.error("Usage: mink <session-start|session-stop|init>");
    process.exit(1);
}
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x src/cli.ts`

- [ ] **Step 3: Smoke test**

Run: `bun src/cli.ts session-start && cat ~/.mink/projects/*/session.json | head -5`
Expected: Fresh session.json with a valid sessionId.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI entry point with command routing"
```

---

## Task 10: `mink init` Command

**Files:**
- Create: `src/commands/init.ts`
- Create: `tests/unit/init.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { safeReadJson } from "../../src/core/fs-utils";
import { buildHooksConfig, mergeHooksIntoSettings } from "../../src/commands/init";

describe("buildHooksConfig", () => {
  test("uses bun when bun is the detected runtime", () => {
    const hooks = buildHooksConfig("bun", "/usr/local/bin/mink/cli.js");
    expect(hooks.SessionStart[0].command).toContain("bun run");
    expect(hooks.Stop[0].command).toContain("bun run");
  });

  test("uses node when node is the detected runtime", () => {
    const hooks = buildHooksConfig("node", "/usr/local/bin/mink/cli.js");
    expect(hooks.SessionStart[0].command).toContain("node ");
    expect(hooks.Stop[0].command).toContain("node ");
  });

  test("includes correct commands", () => {
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    expect(hooks.SessionStart[0].command).toContain("session-start");
    expect(hooks.Stop[0].command).toContain("session-stop");
  });
});

describe("mergeHooksIntoSettings", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates settings.json if it does not exist", () => {
    const settingsDir = join(dir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");

    mergeHooksIntoSettings(settingsPath, hooks);

    const settings = safeReadJson(settingsPath) as Record<string, unknown>;
    expect(settings).not.toBeNull();
    expect(settings.hooks).toBeDefined();
  });

  test("merges hooks into existing settings without overwriting", () => {
    const settingsDir = join(dir, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "", command: "existing-hook" }],
        },
        otherSetting: true,
      })
    );

    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    mergeHooksIntoSettings(settingsPath, hooks);

    const settings = safeReadJson(settingsPath) as Record<string, unknown>;
    const allHooks = settings.hooks as Record<string, unknown[]>;
    expect(allHooks.PreToolUse).toHaveLength(1);
    expect(allHooks.SessionStart).toBeDefined();
    expect(allHooks.Stop).toBeDefined();
    expect(settings.otherSetting).toBe(true);
  });

  test("replaces existing mink hooks on re-init", () => {
    const settingsDir = join(dir, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { matcher: "", command: "bun run /old/path/cli.js session-start" },
          ],
        },
      })
    );

    const hooks = buildHooksConfig("bun", "/new/path/cli.js");
    mergeHooksIntoSettings(settingsPath, hooks);

    const settings = safeReadJson(settingsPath) as Record<string, unknown>;
    const allHooks = settings.hooks as Record<string, Array<{ command: string }>>;
    const sessionStartHooks = allHooks.SessionStart;
    expect(sessionStartHooks).toHaveLength(1);
    expect(sessionStartHooks[0].command).toContain("/new/path/cli.js");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/unit/init.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement init.ts**

```typescript
import { execSync } from "child_process";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { projectDir } from "../core/paths";
import { generateProjectId } from "../core/project-id";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";

interface HookEntry {
  matcher: string;
  command: string;
}

type HooksConfig = Record<string, HookEntry[]>;

export function detectRuntime(): "bun" | "node" {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return "bun";
  } catch {
    return "node";
  }
}

export function buildHooksConfig(
  runtime: "bun" | "node",
  cliPath: string
): HooksConfig {
  const prefix = runtime === "bun" ? `bun run ${cliPath}` : `node ${cliPath}`;
  return {
    SessionStart: [{ matcher: "", command: `${prefix} session-start` }],
    Stop: [{ matcher: "", command: `${prefix} session-stop` }],
  };
}

function isMinkHook(entry: HookEntry): boolean {
  return entry.command.includes("mink") && entry.command.includes("cli.js");
}

export function mergeHooksIntoSettings(
  settingsPath: string,
  newHooks: HooksConfig
): void {
  mkdirSync(dirname(settingsPath), { recursive: true });

  const existing = (safeReadJson(settingsPath) as Record<string, unknown>) ?? {};
  const existingHooks = (existing.hooks ?? {}) as HooksConfig;

  // For each hook type mink manages, remove old mink entries then add new ones
  for (const [event, entries] of Object.entries(newHooks)) {
    const current = existingHooks[event] ?? [];
    const withoutMink = current.filter((e) => !isMinkHook(e));
    existingHooks[event] = [...withoutMink, ...entries];
  }

  existing.hooks = existingHooks;
  atomicWriteJson(settingsPath, existing);
}

export function init(cwd: string): void {
  const runtime = detectRuntime();
  const cliPath = resolve(dirname(new URL(import.meta.url).pathname), "../cli.ts");
  const hooks = buildHooksConfig(runtime, cliPath);
  const settingsPath = resolve(cwd, ".claude", "settings.json");

  mergeHooksIntoSettings(settingsPath, hooks);

  const dir = projectDir(cwd);
  mkdirSync(dir, { recursive: true });

  const projectId = generateProjectId(cwd);
  console.log(`[mink] initialized`);
  console.log(`  project:  ${projectId}`);
  console.log(`  state:    ${dir}`);
  console.log(`  runtime:  ${runtime}`);
  console.log(`  hooks:    ${settingsPath}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/unit/init.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Wire init into CLI**

In `src/cli.ts`, replace the init placeholder:

```typescript
case "init":
  const { init } = await import("./commands/init");
  init(cwd);
  break;
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/init.ts tests/unit/init.test.ts src/cli.ts
git commit -m "feat: add mink init — runtime detection and hook wiring"
```

---

## Task 11: Integration Test

**Files:**
- Create: `tests/integration/lifecycle.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { createSessionState, recordRead, recordWrite } from "../../src/core/session";
import { sessionStart } from "../../src/commands/session-start";
import { sessionStop } from "../../src/commands/session-stop";
import type { SessionState, SessionSummary } from "../../src/types/session";

// Override MINK_ROOT for testing by using session-stop with direct file paths

describe("full session lifecycle", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-lifecycle-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("start → reads → writes → stop produces correct summary", () => {
    const sessionFile = join(dir, "session.json");

    // Simulate session start
    const state = createSessionState();
    atomicWriteJson(sessionFile, state);

    // Simulate hook calls mid-session
    const loaded = safeReadJson(sessionFile) as SessionState;
    recordRead(loaded, "/src/app.ts", 150, true);
    recordRead(loaded, "/src/config.ts", 200, false);
    recordRead(loaded, "/src/app.ts", 150, true); // repeated read
    recordWrite(loaded, "/src/app.ts", "edit", 300);
    recordWrite(loaded, "/src/utils.ts", "create", 100);
    atomicWriteJson(sessionFile, loaded);

    // Simulate session stop
    let captured: SessionSummary | null = null;
    const finalizer = {
      appendSession(summary: SessionSummary) {
        captured = summary;
      },
      updateSession() {},
    };

    sessionStop(sessionFile, finalizer);

    // Verify summary
    expect(captured).not.toBeNull();
    expect(captured!.totals.readCount).toBe(2); // 2 unique files
    expect(captured!.totals.writeCount).toBe(2);
    expect(captured!.totals.repeatedReads).toBe(1); // app.ts read twice
    expect(captured!.totals.estimatedTokens).toBe(750); // 150+200+300+100
    // Savings: 1 index hit × 200 + 1 repeated read × 150 = 350
    // Wait — 2 index hits (both app.ts reads were indexHit=true)
    // But fileIndexHits counts each call, not unique files: 2 hits
    // Savings: 2 × 200 + 1 × 150 = 550
    expect(captured!.estimatedSavings).toBe(550);

    // Verify session.json updated
    const final = safeReadJson(sessionFile) as SessionState;
    expect(final.stopCount).toBe(1);
  });

  test("multiple stops do not duplicate finalization", () => {
    const sessionFile = join(dir, "session.json");
    const state = createSessionState();
    recordRead(state, "/src/a.ts", 100, true);
    atomicWriteJson(sessionFile, state);

    let appendCount = 0;
    let updateCount = 0;
    const finalizer = {
      appendSession() {
        appendCount++;
      },
      updateSession() {
        updateCount++;
      },
    };

    sessionStop(sessionFile, finalizer);
    sessionStop(sessionFile, finalizer);
    sessionStop(sessionFile, finalizer);

    expect(appendCount).toBe(1);
    expect(updateCount).toBe(2);

    const final = safeReadJson(sessionFile) as SessionState;
    expect(final.stopCount).toBe(3);
  });

  test("zero-activity session skips finalization", () => {
    const sessionFile = join(dir, "session.json");
    const state = createSessionState();
    atomicWriteJson(sessionFile, state);

    let finalizerCalled = false;
    const finalizer = {
      appendSession() {
        finalizerCalled = true;
      },
      updateSession() {
        finalizerCalled = true;
      },
    };

    sessionStop(sessionFile, finalizer);
    expect(finalizerCalled).toBe(false);
  });

  test("session start overwrites stale state", () => {
    const sessionFile = join(dir, "session.json");

    // Write stale state
    const stale = createSessionState();
    recordRead(stale, "/old/file.ts", 500, true);
    stale.stopCount = 5;
    atomicWriteJson(sessionFile, stale);

    // Overwrite with fresh state
    const fresh = createSessionState();
    atomicWriteJson(sessionFile, fresh);

    const loaded = safeReadJson(sessionFile) as SessionState;
    expect(loaded.stopCount).toBe(0);
    expect(Object.keys(loaded.reads)).toHaveLength(0);
    expect(loaded.writes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `bun test tests/integration/lifecycle.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: All tests across all files PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/lifecycle.test.ts
git commit -m "test: add integration tests for full session lifecycle"
```

---

## Task 12: End-to-End Smoke Test

**Files:** None created — manual verification.

- [ ] **Step 1: Run mink init in this project**

Run: `bun src/cli.ts init`
Expected output:
```
[mink] initialized
  project:  mink-<hash>
  state:    /Users/<you>/.mink/projects/mink-<hash>
  runtime:  bun
  hooks:    /Users/<you>/dev/mink/.claude/settings.json
```

- [ ] **Step 2: Verify hooks were written**

Run: `cat .claude/settings.json`
Expected: JSON with `hooks.SessionStart` and `hooks.Stop` entries pointing to mink CLI.

- [ ] **Step 3: Run session-start**

Run: `bun src/cli.ts session-start`
Then: `cat ~/.mink/projects/mink-*/session.json`
Expected: Fresh session.json with valid sessionId, zeroed counters.

- [ ] **Step 4: Run session-stop**

Run: `bun src/cli.ts session-stop`
Then: `cat ~/.mink/projects/mink-*/session.json`
Expected: `stopCount` is 1. No errors on stderr (zero activity session).

- [ ] **Step 5: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: final adjustments from smoke test"
```
