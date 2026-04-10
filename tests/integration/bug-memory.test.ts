import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import {
  createEmptyBugMemory,
  loadBugMemory,
  saveBugMemory,
  addBugEntry,
  lookupBugsForFile,
  formatBugSummary,
  searchBugs,
  hasBugForFileInSession,
} from "../../src/core/bug-memory";
import { createSessionState, recordWrite } from "../../src/core/session";
import { sessionStop } from "../../src/commands/session-stop";
import { analyzePreWrite } from "../../src/commands/pre-write";
import type { SessionState } from "../../src/types/session";

describe("bug memory integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-bugmem-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("save and load round-trip", () => {
    const path = join(dir, "bug-memory.json");
    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "TypeError: null ref",
      filePath: "src/api.ts",
      rootCause: "API returned null",
      fixDescription: "Added null check",
      tags: ["null-check"],
      relatedBugIds: [],
    });
    saveBugMemory(path, mem);

    const loaded = loadBugMemory(path);
    expect(loaded.entries).toHaveLength(1);
    expect(loaded.entries[0].id).toBe("bug-001");
    expect(loaded.entries[0].errorMessage).toBe("TypeError: null ref");
    expect(loaded.nextId).toBe(2);
  });

  test("load returns empty memory when file does not exist", () => {
    const path = join(dir, "nonexistent.json");
    const mem = loadBugMemory(path);
    expect(mem.entries).toEqual([]);
    expect(mem.nextId).toBe(1);
  });

  test("load returns empty memory when file is corrupt", () => {
    const path = join(dir, "bug-memory.json");
    atomicWriteJson(path, "not valid bug memory");
    const mem = loadBugMemory(path);
    expect(mem.entries).toEqual([]);
    expect(mem.nextId).toBe(1);
  });

  test("AI fixes bug → logs entry → edits same file → entry surfaced", () => {
    const bugPath = join(dir, "bug-memory.json");

    // Step 1: AI logs a bug after fixing it
    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "TypeError: Cannot read property 'name' of null",
      filePath: "src/api.ts",
      rootCause: "API response was null",
      fixDescription: "Added null check before accessing response.name",
      tags: ["null-check", "api-response"],
      relatedBugIds: [],
    });
    saveBugMemory(bugPath, mem);

    // Step 2: AI begins editing the same file later
    const loaded = loadBugMemory(bugPath);
    const entries = lookupBugsForFile(loaded, "src/api.ts");
    const summary = formatBugSummary(entries);

    expect(entries).toHaveLength(1);
    expect(summary).not.toBeNull();
    expect(summary).toContain("bug-001");
    expect(summary).toContain("null check");
  });

  test("analyzePreWrite surfaces bug summary when bug memory provided", () => {
    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "ReferenceError: x is not defined",
      filePath: "src/utils.ts",
      rootCause: "Variable declared in wrong scope",
      fixDescription: "Moved declaration to outer scope",
      tags: ["scope"],
      relatedBugIds: [],
    });

    const result = analyzePreWrite("src/utils.ts", "const y = x + 1;", [], mem);
    expect(result.bugSummary).not.toBeNull();
    expect(result.bugSummary).toContain("bug-001");
    expect(result.bugSummary).toContain("ReferenceError");
  });

  test("analyzePreWrite returns null bugSummary when no bugs for file", () => {
    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "Error in other file",
      filePath: "src/other.ts",
      rootCause: "cause",
      fixDescription: "fix",
      tags: [],
      relatedBugIds: [],
    });

    const result = analyzePreWrite(
      "src/unrelated.ts",
      "some content",
      [],
      mem
    );
    expect(result.bugSummary).toBeNull();
  });

  test("file edited 3+ times with no bug → reminder emitted", () => {
    const sessionFile = join(dir, "session.json");

    const state = createSessionState();
    recordWrite(state, "src/utils.ts", "edit", 100);
    recordWrite(state, "src/utils.ts", "edit", 100);
    recordWrite(state, "src/utils.ts", "edit", 100);
    recordWrite(state, "src/utils.ts", "edit", 100);
    atomicWriteJson(sessionFile, state);

    const reminders: string[] = [];
    const finalizer = {
      appendSession() {},
      updateSession() {},
    };

    sessionStop(sessionFile, finalizer, (msg) => reminders.push(msg));
    expect(reminders.some((r) => r.includes("src/utils.ts"))).toBe(true);
    expect(reminders.some((r) => r.includes("4 times"))).toBe(true);
  });

  test("file edited 3+ times with bug logged this session → no reminder", () => {
    const sessionFile = join(dir, "session.json");
    const bugPath = join(dir, "bug-memory.json");

    const state = createSessionState();
    recordWrite(state, "src/utils.ts", "edit", 100);
    recordWrite(state, "src/utils.ts", "edit", 100);
    recordWrite(state, "src/utils.ts", "edit", 100);
    atomicWriteJson(sessionFile, state);

    // Log a bug for this file during the current session
    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "Something broke",
      filePath: "src/utils.ts",
      rootCause: "cause",
      fixDescription: "fix",
      tags: [],
      relatedBugIds: [],
    });
    saveBugMemory(bugPath, mem);

    const reminders: string[] = [];
    const finalizer = {
      appendSession() {},
      updateSession() {},
    };

    sessionStop(sessionFile, finalizer, (msg) => reminders.push(msg));

    // No reminder about utils.ts since a bug was logged
    const utilsReminders = reminders.filter((r) => r.includes("src/utils.ts"));
    expect(utilsReminders).toHaveLength(0);
  });

  test("search across 50 entries remains functional", () => {
    let mem = createEmptyBugMemory();
    for (let i = 0; i < 50; i++) {
      mem = addBugEntry(mem, {
        errorMessage: `Error ${i}: something went wrong in module ${i}`,
        filePath: `src/module${i}.ts`,
        rootCause: `Root cause for module ${i}`,
        fixDescription: `Fix applied to module ${i}`,
        tags: [i % 2 === 0 ? "even" : "odd", `mod-${i}`],
        relatedBugIds: [],
      });
    }

    const path = join(dir, "bug-memory.json");
    saveBugMemory(path, mem);

    const loaded = loadBugMemory(path);
    expect(loaded.entries).toHaveLength(50);

    const results = searchBugs(loaded, "module 25 went wrong", {
      filePath: "src/module25.ts",
    });
    expect(results.length).toBeGreaterThan(0);
    // The exact match (module25) should be among results
    expect(results.some((r) => r.entry.filePath === "src/module25.ts")).toBe(
      true
    );
  });

  test("duplicate bug detection across save/load cycle", () => {
    const path = join(dir, "bug-memory.json");

    let mem = createEmptyBugMemory();
    mem = addBugEntry(mem, {
      errorMessage: "TypeError: null ref",
      filePath: "src/api.ts",
      rootCause: "null check missing",
      fixDescription: "added check",
      tags: ["null-check"],
      relatedBugIds: [],
    });
    saveBugMemory(path, mem);

    // Reload and add "same" bug again
    let loaded = loadBugMemory(path);
    loaded = addBugEntry(loaded, {
      errorMessage: "TypeError: null ref",
      filePath: "src/api.ts",
      rootCause: "different cause text",
      fixDescription: "different fix text",
      tags: ["other"],
      relatedBugIds: [],
    });
    saveBugMemory(path, loaded);

    const final = loadBugMemory(path);
    expect(final.entries).toHaveLength(1);
    expect(final.entries[0].occurrenceCount).toBe(2);
    expect(final.entries[0].rootCause).toBe("null check missing"); // original preserved
    expect(final.nextId).toBe(2);
  });
});
