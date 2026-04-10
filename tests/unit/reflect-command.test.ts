import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { reflect } from "../../src/commands/reflect";
import { createEmptyLearningMemory, addEntry, serializeLearningMemory } from "../../src/core/learning-memory";
import { atomicWriteJson, atomicWriteText } from "../../src/core/fs-utils";
import { estimateTokens } from "../../src/core/token-estimate";
import type { ProjectConfig } from "../../src/types/file-index";

let tmpDir: string;

beforeEach(() => {
  tmpDir = join("/tmp", `mink-reflect-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function memoryPath(): string {
  return join(tmpDir, "learning-memory.md");
}

function confPath(): string {
  return join(tmpDir, "config.json");
}

describe("reflect command", () => {
  test("returns null when learning memory file does not exist", () => {
    const result = reflect(tmpDir, memoryPath(), confPath());
    expect(result).toBeNull();
  });

  test("prunes duplicates and saves file", () => {
    const mem = createEmptyLearningMemory("proj");
    const dupEntry = "always check for null before accessing properties";
    for (let i = 0; i < 10; i++) {
      addEntry(mem, "Key Learnings", dupEntry);
    }
    const content = serializeLearningMemory(mem);
    atomicWriteText(memoryPath(), content);

    // Use a config budget that forces dedup (tight budget, but single copy fits)
    // 10 copies create ~155 tokens; set budget to 30 so single copy (~15 tokens base + entry) passes
    const singleMem = createEmptyLearningMemory("proj");
    addEntry(singleMem, "Key Learnings", dupEntry);
    const singleTokens = estimateTokens(serializeLearningMemory(singleMem), "learning-memory.md");
    const config: ProjectConfig = { learningMemoryTokenBudget: singleTokens + 5 };
    atomicWriteJson(confPath(), config);

    const result = reflect(tmpDir, memoryPath(), confPath());
    expect(result).not.toBeNull();
    expect(result!.mergedCount).toBeGreaterThan(0);

    const savedContent = readFileSync(memoryPath(), "utf-8");
    // After dedup, only 1 copy should exist
    const occurrences = (savedContent.match(new RegExp(dupEntry, "g")) || []).length;
    expect(occurrences).toBe(1);
  });

  test("uses default budget of 2000 when no config file", () => {
    // Create a small memory well under the default 2000 token budget
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "Key Learnings", "entry one");
    addEntry(mem, "Key Learnings", "entry two");
    const content = serializeLearningMemory(mem);
    atomicWriteText(memoryPath(), content);

    const result = reflect(tmpDir, memoryPath(), confPath());
    expect(result).not.toBeNull();
    expect(result!.withinBudget).toBe(true);
    expect(result!.trimmedCount).toBe(0);
  });

  test("reads custom budget from config file", () => {
    // Create a memory that exceeds the custom budget
    const mem = createEmptyLearningMemory("proj");
    for (let i = 0; i < 100; i++) {
      addEntry(mem, "Decision Log", `Decision ${i}: we selected approach A because it is more maintainable`);
    }
    atomicWriteText(memoryPath(), serializeLearningMemory(mem));

    // Set a very small budget
    const config: ProjectConfig = { learningMemoryTokenBudget: 50 };
    atomicWriteJson(confPath(), config);

    const result = reflect(tmpDir, memoryPath(), confPath());
    expect(result).not.toBeNull();
    expect(result!.trimmedCount).toBeGreaterThan(0);
    expect(result!.afterTokens).toBeLessThanOrEqual(50);
  });

  test("does not modify file if already within budget and no duplicates", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "Key Learnings", "unique entry one");
    addEntry(mem, "Key Learnings", "unique entry two");
    const content = serializeLearningMemory(mem);
    atomicWriteText(memoryPath(), content);

    // Record modification time before reflect
    const statBefore = Bun.file(memoryPath()).lastModified;

    // Small delay to ensure mtime would change if file were written
    // Using sync approach: check content is same
    const result = reflect(tmpDir, memoryPath(), confPath());
    expect(result).not.toBeNull();
    expect(result!.mergedCount).toBe(0);
    expect(result!.trimmedCount).toBe(0);

    const contentAfter = readFileSync(memoryPath(), "utf-8");
    expect(contentAfter).toBe(content);
  });

  test("returns ReflectionResult with correct stats", () => {
    const mem = createEmptyLearningMemory("proj");
    addEntry(mem, "Key Learnings", "entry");
    const content = serializeLearningMemory(mem);
    atomicWriteText(memoryPath(), content);

    const result = reflect(tmpDir, memoryPath(), confPath());
    expect(result).not.toBeNull();
    expect(typeof result!.beforeTokens).toBe("number");
    expect(typeof result!.afterTokens).toBe("number");
    expect(result!.beforeTokens).toBeGreaterThan(0);
  });
});
