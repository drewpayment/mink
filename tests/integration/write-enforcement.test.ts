import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { atomicWriteText } from "../../src/core/fs-utils";
import { createSessionState } from "../../src/core/session";
import { isSessionState, recordWrite } from "../../src/core/session";
import { createEmptyIndex, upsertEntry, indexAsLookup } from "../../src/core/index-store";
import { serializeLearningMemory, createEmptyLearningMemory, addEntry } from "../../src/core/learning-memory";
import { analyzePreWrite } from "../../src/commands/pre-write";
import { analyzePostWrite } from "../../src/commands/post-write";
import { getEntries, parseLearningMemory } from "../../src/core/learning-memory";
import type { SessionState } from "../../src/types/session";
import type { FileIndex, FileIndexEntry } from "../../src/types/file-index";

function makeEntry(filePath: string, description: string, estimatedTokens: number): FileIndexEntry {
  return {
    filePath,
    description,
    estimatedTokens,
    lastModified: new Date().toISOString(),
    lastIndexed: new Date().toISOString(),
  };
}

describe("write enforcement integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-write-enforce-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("pre-write detects DNR violation from learning memory", () => {
    // Set up learning memory with a DNR entry
    const mem = createEmptyLearningMemory("test-project");
    addEntry(mem, "Do-Not-Repeat", '[2026-03-10] Never use "var"');
    const memPath = join(dir, "learning-memory.md");
    atomicWriteText(memPath, serializeLearningMemory(mem));

    // Load DNR entries as the pre-write hook would
    const markdown = serializeLearningMemory(mem);
    const parsed = parseLearningMemory(markdown);
    const dnrEntries = getEntries(parsed, "Do-Not-Repeat");

    // Simulate pre-write with matching content
    const result = analyzePreWrite("src/app.ts", "var x = 1;", dnrEntries);

    expect(result.patternMatches).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("var");
    expect(result.warnings[0]).toContain("Do-Not-Repeat");
  });

  test("pre-write with no DNR entries emits no warnings", () => {
    const mem = createEmptyLearningMemory("test-project");
    const markdown = serializeLearningMemory(mem);
    const parsed = parseLearningMemory(markdown);
    const dnrEntries = getEntries(parsed, "Do-Not-Repeat");

    const result = analyzePreWrite("src/app.ts", "const x = 1;", dnrEntries);

    expect(result.patternMatches).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test("post-write creates new file index entry for new file", () => {
    const sessionFile = join(dir, "session.json");
    const indexFile = join(dir, "file-index.json");

    // Setup empty state
    const state = createSessionState();
    atomicWriteJson(sessionFile, state);
    const index = createEmptyIndex();
    atomicWriteJson(indexFile, index);

    // Simulate post-write for a new file
    const fileContent = "export function format(s: string) { return s.trim(); }";
    const result = analyzePostWrite("src/utils/format.ts", fileContent, indexAsLookup(index));

    expect(result.excluded).toBe(false);
    expect(result.action).toBe("create");
    expect(result.indexEntry).not.toBeNull();
    expect(result.indexEntry!.filePath).toBe("src/utils/format.ts");
    expect(result.indexEntry!.estimatedTokens).toBeGreaterThan(0);

    // Persist as the hook would
    upsertEntry(index, result.indexEntry!);
    recordWrite(state, "src/utils/format.ts", result.action, result.estimatedTokens);
    atomicWriteJson(sessionFile, state);
    atomicWriteJson(indexFile, index);

    // Verify persisted state
    const finalState = safeReadJson(sessionFile) as SessionState;
    expect(finalState.writes).toHaveLength(1);
    expect(finalState.writes[0].filePath).toBe("src/utils/format.ts");
    expect(finalState.writes[0].action).toBe("create");

    const finalIndex = safeReadJson(indexFile) as FileIndex;
    expect(finalIndex.entries["src/utils/format.ts"]).toBeDefined();
    expect(finalIndex.header.totalFiles).toBe(1);
  });

  test("post-write updates existing file index entry for edited file", () => {
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/app.ts", "Old description", 100));

    // Simulate edit with new content
    const newContent = "export function main() { console.log('updated'); }";
    const result = analyzePostWrite("src/app.ts", newContent, indexAsLookup(index));

    expect(result.action).toBe("edit");
    expect(result.indexEntry).not.toBeNull();
    expect(result.indexEntry!.description).not.toBe("Old description");

    // Persist
    upsertEntry(index, result.indexEntry!);
    expect(index.entries["src/app.ts"].description).toBe(result.description);
    expect(index.header.totalFiles).toBe(1); // still just 1 file
  });

  test("excluded files skip all tracking", () => {
    const state = createSessionState();
    const index = createEmptyIndex();

    const result = analyzePostWrite(".env.local", "SECRET=abc", indexAsLookup(index));

    expect(result.excluded).toBe(true);

    // Verify nothing was mutated
    expect(Object.keys(index.entries)).toHaveLength(0);
    expect(state.writes).toHaveLength(0);
  });

  test("missing learning memory does not crash pre-write", () => {
    // No learning memory file — dnrEntries would be empty
    const result = analyzePreWrite("src/app.ts", "const x = 1;", []);

    expect(result.patternMatches).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  test("multiple writes accumulate in session state", () => {
    const state = createSessionState();
    const index = createEmptyIndex();

    // First write (new file)
    const result1 = analyzePostWrite("src/a.ts", "export const a = 1;", indexAsLookup(index));
    if (result1.indexEntry) upsertEntry(index, result1.indexEntry);
    recordWrite(state, "src/a.ts", result1.action, result1.estimatedTokens);

    // Second write (another new file)
    const result2 = analyzePostWrite("src/b.ts", "export const b = 2;", indexAsLookup(index));
    if (result2.indexEntry) upsertEntry(index, result2.indexEntry);
    recordWrite(state, "src/b.ts", result2.action, result2.estimatedTokens);

    // Third write (edit first file)
    const result3 = analyzePostWrite("src/a.ts", "export const a = 'updated';", indexAsLookup(index));
    if (result3.indexEntry) upsertEntry(index, result3.indexEntry);
    recordWrite(state, "src/a.ts", result3.action, result3.estimatedTokens);

    expect(state.writes).toHaveLength(3);
    expect(state.writes[0].action).toBe("create");
    expect(state.writes[1].action).toBe("create");
    expect(state.writes[2].action).toBe("edit"); // now in index
    expect(index.header.totalFiles).toBe(2);
  });

  test("performance: post-write on 500-entry index completes quickly", () => {
    const index = createEmptyIndex();
    for (let i = 0; i < 500; i++) {
      upsertEntry(index, makeEntry(`src/file-${i}.ts`, `File ${i}`, 100 + i));
    }

    const content = "export function newFunc() { return 42; }";
    const start = performance.now();
    const result = analyzePostWrite("src/new-file.ts", content, indexAsLookup(index));
    const elapsed = performance.now() - start;

    expect(result.action).toBe("create");
    expect(elapsed).toBeLessThan(10000); // well under 10 seconds
  });
});
