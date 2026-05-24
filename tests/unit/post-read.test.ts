import { describe, expect, test } from "bun:test";
import { analyzePostRead } from "../../src/commands/post-read";
import { createEmptyIndex, upsertEntry, indexAsLookup } from "../../src/core/index-store";
import type { FileIndexEntry } from "../../src/types/file-index";

function makeEntry(filePath: string, estimatedTokens: number): FileIndexEntry {
  return {
    filePath,
    description: "test file",
    estimatedTokens,
    lastModified: new Date().toISOString(),
    lastIndexed: new Date().toISOString(),
  };
}

describe("analyzePostRead", () => {
  test("code file with content estimates tokens at 3.5 ratio", () => {
    // 2000 chars / 3.5 = ~571 tokens
    const content = "a".repeat(2000);
    const result = analyzePostRead("src/app.ts", content, null);

    expect(result.estimatedTokens).toBe(Math.ceil(2000 / 3.5));
    expect(result.source).toBe("content");
  });

  test("prose file with content estimates tokens at 4.0 ratio", () => {
    const content = "a".repeat(2000);
    const result = analyzePostRead("docs/readme.md", content, null);

    expect(result.estimatedTokens).toBe(Math.ceil(2000 / 4.0));
    expect(result.source).toBe("content");
  });

  test("mixed file with content estimates tokens at 3.75 ratio", () => {
    const content = "a".repeat(2000);
    const result = analyzePostRead("config.yaml", content, null);

    expect(result.estimatedTokens).toBe(Math.ceil(2000 / 3.75));
    expect(result.source).toBe("content");
  });

  test("empty file returns 0 tokens", () => {
    const result = analyzePostRead("src/empty.ts", "", null);

    expect(result.estimatedTokens).toBe(0);
    expect(result.source).toBe("none");
  });

  test("content unavailable falls back to file index estimate", () => {
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/app.ts", 500));

    const result = analyzePostRead("src/app.ts", null, indexAsLookup(index));

    expect(result.estimatedTokens).toBe(500);
    expect(result.indexHit).toBe(true);
    expect(result.source).toBe("index-fallback");
  });

  test("content unavailable and no index entry returns 0", () => {
    const result = analyzePostRead("src/unknown.ts", null, null);

    expect(result.estimatedTokens).toBe(0);
    expect(result.indexHit).toBe(false);
    expect(result.source).toBe("none");
  });

  test("content unavailable and file not in index returns 0", () => {
    const index = createEmptyIndex();

    const result = analyzePostRead("src/unknown.ts", null, indexAsLookup(index));

    expect(result.estimatedTokens).toBe(0);
    expect(result.indexHit).toBe(false);
    expect(result.source).toBe("none");
  });

  test("binary file by extension returns 0 tokens", () => {
    const result = analyzePostRead("assets/logo.png", "fake binary content", null);

    expect(result.estimatedTokens).toBe(0);
    expect(result.source).toBe("none");
  });

  test("binary file by null byte content returns 0 tokens", () => {
    const content = "hello\0world";
    const result = analyzePostRead("src/data.bin", content, null);

    expect(result.estimatedTokens).toBe(0);
    expect(result.source).toBe("none");
  });

  test("index hit is determined correctly when content available", () => {
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/app.ts", 500));

    const content = "a".repeat(1000);
    const result = analyzePostRead("src/app.ts", content, indexAsLookup(index));

    expect(result.indexHit).toBe(true);
    expect(result.source).toBe("content");
  });

  test("index miss is determined correctly when content available", () => {
    const index = createEmptyIndex();

    const content = "a".repeat(1000);
    const result = analyzePostRead("src/unknown.ts", content, indexAsLookup(index));

    expect(result.indexHit).toBe(false);
    expect(result.source).toBe("content");
  });
});
