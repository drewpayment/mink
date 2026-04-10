import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteText, atomicWriteJson } from "../../src/core/fs-utils";
import { seedLearningMemory } from "../../src/core/seed";
import {
  parseLearningMemory,
  serializeLearningMemory,
  addEntry,
  createEmptyLearningMemory,
} from "../../src/core/learning-memory";
import { extractPatterns, matchPatterns } from "../../src/core/pattern-engine";
import { reflect } from "../../src/commands/reflect";

describe("learning memory integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-lm-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // ─── Test 1: Full lifecycle ──────────────────────────────────────────────────

  test("full lifecycle: seed → add entries → reflect → verify round-trip", () => {
    // Write a package.json with name, description, and express+typescript deps
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "my-api",
        description: "A REST API built with Express",
        dependencies: {
          express: "^4.18.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
        },
      })
    );

    // Seed learning memory from project metadata
    const mem = seedLearningMemory(dir);

    expect(mem.projectName).toBe("my-api");
    const klEntries = mem.sections["Key Learnings"];
    // Should have detected Express and TypeScript frameworks
    const frameworkEntry = klEntries.find((e) => e.includes("Detected frameworks"));
    expect(frameworkEntry).toBeDefined();
    expect(frameworkEntry).toContain("Express");
    expect(frameworkEntry).toContain("TypeScript");

    // Add entries across different sections
    addEntry(mem, "User Preferences", "Always use async/await over callbacks");
    addEntry(
      mem,
      "Do-Not-Repeat",
      '[2026-04-10] Never use "var" — always use const or let'
    );
    addEntry(
      mem,
      "Decision Log",
      "[2026-04-10] Chose Express over Fastify for ecosystem familiarity"
    );

    // Serialize and write to file atomically
    const memPath = join(dir, "learning-memory.md");
    atomicWriteText(memPath, serializeLearningMemory(mem));

    expect(existsSync(memPath)).toBe(true);

    // Read back and parse
    const raw = readFileSync(memPath, "utf-8");
    const parsed = parseLearningMemory(raw);

    // Verify round-trip integrity
    expect(parsed.projectName).toBe("my-api");
    expect(parsed.sections["User Preferences"]).toContain(
      "Always use async/await over callbacks"
    );
    expect(parsed.sections["Do-Not-Repeat"]).toContain(
      '[2026-04-10] Never use "var" — always use const or let'
    );
    expect(parsed.sections["Decision Log"]).toContain(
      "[2026-04-10] Chose Express over Fastify for ecosystem familiarity"
    );
    // Key Learnings should still have seeded entries
    expect(parsed.sections["Key Learnings"].length).toBeGreaterThan(0);
  });

  // ─── Test 2: Pattern extraction → matching end-to-end ───────────────────────

  test("pattern extraction → matching end-to-end", () => {
    const mem = createEmptyLearningMemory("test-project");

    // Add Do-Not-Repeat entries with quoted patterns and phrase triggers
    addEntry(
      mem,
      "Do-Not-Repeat",
      '[2026-04-10] Never use "var" — always const'
    );
    addEntry(
      mem,
      "Do-Not-Repeat",
      "[2026-04-10] Avoid mocking the database in integration tests"
    );

    const entries = mem.sections["Do-Not-Repeat"];
    const patterns = extractPatterns(entries);

    expect(patterns.length).toBeGreaterThan(0);

    // Match against code containing "var"
    const codeWithVar = `function hello() {\n  var x = 1;\n  return x;\n}`;
    const varMatches = matchPatterns(patterns, codeWithVar);
    expect(varMatches.length).toBeGreaterThan(0);
    const varMatch = varMatches.find((m) => m.matchedText === "var");
    expect(varMatch).toBeDefined();

    // Match against test code with "mocking the database"
    const testCode = `describe('auth', () => {\n  // mocking the database here\n  it('works', () => {});\n})`;
    const dbMatches = matchPatterns(patterns, testCode);
    expect(dbMatches.length).toBeGreaterThan(0);

    // Match against clean code → no matches
    const cleanCode = `const x = 5;\nconst db = connectReal();`;
    const cleanMatches = matchPatterns(patterns, cleanCode);
    expect(cleanMatches).toHaveLength(0);
  });

  // ─── Test 3: Reflect prunes bloated memory via file ─────────────────────────

  test("reflect command prunes bloated memory via file", () => {
    const mem = createEmptyLearningMemory("big-project");

    // Add 30 Decision Log entries
    for (let i = 0; i < 30; i++) {
      addEntry(
        mem,
        "Decision Log",
        `[2026-04-${String(i + 1).padStart(2, "0")}] Decision number ${i + 1} regarding architecture choice for module ${i + 1}`
      );
    }

    // Add a single Do-Not-Repeat entry (should survive trimming — trimmed last)
    addEntry(
      mem,
      "Do-Not-Repeat",
      '[2026-04-10] Never use "eval" in production code'
    );

    // Write memory to file
    const memPath = join(dir, "learning-memory.md");
    atomicWriteText(memPath, serializeLearningMemory(mem));

    // Write config with a very low token budget to force trimming
    const configPath = join(dir, "config.json");
    atomicWriteJson(configPath, { learningMemoryTokenBudget: 200 });

    // Call reflect
    const result = reflect(dir, memPath, configPath);

    expect(result).not.toBeNull();
    expect(result!.withinBudget).toBe(true);
    expect(result!.trimmedCount).toBeGreaterThan(0);

    // Verify Do-Not-Repeat survived (trimmed last)
    const raw = readFileSync(memPath, "utf-8");
    const updated = parseLearningMemory(raw);
    expect(updated.sections["Do-Not-Repeat"]).toContain(
      '[2026-04-10] Never use "eval" in production code'
    );
  });

  // ─── Test 4: Corrupted learning memory handled gracefully ───────────────────

  test("corrupted learning memory handled gracefully", () => {
    const garbled = `{{{not markdown at all}}}\x00\x01\x02binary garbage here!!!`;

    // Write corrupted content directly
    writeFileSync(join(dir, "learning-memory.md"), garbled);
    const raw = readFileSync(join(dir, "learning-memory.md"), "utf-8");

    // parseLearningMemory should not throw
    let parsed: ReturnType<typeof parseLearningMemory> | undefined;
    expect(() => {
      parsed = parseLearningMemory(raw);
    }).not.toThrow();

    // Should return projectName "unknown" with empty sections
    expect(parsed!.projectName).toBe("unknown");
    expect(parsed!.sections["User Preferences"]).toHaveLength(0);
    expect(parsed!.sections["Key Learnings"]).toHaveLength(0);
    expect(parsed!.sections["Do-Not-Repeat"]).toHaveLength(0);
    expect(parsed!.sections["Decision Log"]).toHaveLength(0);
  });

  // ─── Test 5: Empty project seeds with directory name only ───────────────────

  test("empty project seeds with directory name only", () => {
    // No package.json or other metadata files in dir
    const mem = seedLearningMemory(dir);

    // projectName should be the basename of the temp dir (truthy)
    expect(mem.projectName).toBeTruthy();
    expect(mem.projectName).toBe(require("path").basename(dir));

    // Key Learnings should have at least the project line but no framework entry
    const klEntries = mem.sections["Key Learnings"];
    const frameworkEntry = klEntries.find((e) => e.includes("Detected frameworks"));
    expect(frameworkEntry).toBeUndefined();

    // Do-Not-Repeat, User Preferences, Decision Log should be empty
    expect(mem.sections["Do-Not-Repeat"]).toHaveLength(0);
    expect(mem.sections["User Preferences"]).toHaveLength(0);
    expect(mem.sections["Decision Log"]).toHaveLength(0);
  });
});
