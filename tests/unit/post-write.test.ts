import { describe, expect, test } from "bun:test";
import { analyzePostWrite } from "../../src/commands/post-write";
import { createEmptyIndex, upsertEntry, indexAsLookup } from "../../src/core/index-store";
import type { FileIndexEntry } from "../../src/types/file-index";

function makeEntry(filePath: string, description: string, estimatedTokens: number): FileIndexEntry {
  return {
    filePath,
    description,
    estimatedTokens,
    lastModified: new Date().toISOString(),
    lastIndexed: new Date().toISOString(),
  };
}

describe("analyzePostWrite", () => {
  test("new file (not in index) has action 'create'", () => {
    const index = createEmptyIndex();
    const content = "export function hello() { return 'world'; }";

    const result = analyzePostWrite("src/utils/format.ts", content, indexAsLookup(index));

    expect(result.excluded).toBe(false);
    expect(result.action).toBe("create");
    expect(result.estimatedTokens).toBeGreaterThan(0);
    expect(result.description.length).toBeGreaterThan(0);
    expect(result.indexEntry).not.toBeNull();
    expect(result.indexEntry!.filePath).toBe("src/utils/format.ts");
  });

  test("existing file (in index) has action 'edit'", () => {
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/app.ts", "App entry", 200));
    const content = "export function main() { console.log('updated'); }";

    const result = analyzePostWrite("src/app.ts", content, indexAsLookup(index));

    expect(result.excluded).toBe(false);
    expect(result.action).toBe("edit");
    expect(result.indexEntry).not.toBeNull();
  });

  test(".env file is excluded", () => {
    const result = analyzePostWrite(".env", "SECRET=abc123", null);

    expect(result.excluded).toBe(true);
    expect(result.indexEntry).toBeNull();
  });

  test(".env.local file is excluded", () => {
    const result = analyzePostWrite(".env.local", "DB_HOST=localhost", null);

    expect(result.excluded).toBe(true);
  });

  test(".mink/session.json is excluded", () => {
    const result = analyzePostWrite(".mink/session.json", "{}", null);

    expect(result.excluded).toBe(true);
  });

  test("non-excluded file has excluded false", () => {
    const result = analyzePostWrite("src/app.ts", "const x = 1;", null);

    expect(result.excluded).toBe(false);
  });

  test("empty file content produces entry with 0 tokens", () => {
    const index = createEmptyIndex();
    const result = analyzePostWrite("src/empty.ts", "", indexAsLookup(index));

    expect(result.excluded).toBe(false);
    expect(result.action).toBe("create");
    expect(result.description).toContain("empty file");
    expect(result.estimatedTokens).toBe(0);
    // extractDescription returns "empty.ts — empty file" for empty content
    // estimateTokens returns 0 for empty content
    expect(result.indexEntry).not.toBeNull();
    expect(result.indexEntry!.estimatedTokens).toBe(0);
  });

  test("binary file by extension returns 0 tokens and no entry", () => {
    const result = analyzePostWrite("assets/logo.png", "fake binary", null);

    expect(result.excluded).toBe(false);
    expect(result.estimatedTokens).toBe(0);
    expect(result.indexEntry).toBeNull();
  });

  test("binary file by null byte content returns 0 tokens", () => {
    const content = "hello\0world";
    const result = analyzePostWrite("src/data.bin", content, null);

    expect(result.estimatedTokens).toBe(0);
    expect(result.indexEntry).toBeNull();
  });

  test("null content (unreadable file) returns 0 tokens", () => {
    const result = analyzePostWrite("src/app.ts", null, null);

    expect(result.excluded).toBe(false);
    expect(result.estimatedTokens).toBe(0);
    expect(result.indexEntry).toBeNull();
  });

  test("null index treats file as new (create action)", () => {
    const content = "export const x = 1;";
    const result = analyzePostWrite("src/new.ts", content, null);

    expect(result.action).toBe("create");
    expect(result.indexEntry).not.toBeNull();
  });

  test("token estimation uses correct ratio for code files", () => {
    const content = "a".repeat(3500);
    const result = analyzePostWrite("src/app.ts", content, null);

    // 3500 / 3.5 = 1000 tokens
    expect(result.estimatedTokens).toBe(1000);
  });

  test("token estimation uses correct ratio for prose files", () => {
    const content = "a".repeat(4000);
    const result = analyzePostWrite("docs/readme.md", content, null);

    // 4000 / 4.0 = 1000 tokens
    expect(result.estimatedTokens).toBe(1000);
  });
});
