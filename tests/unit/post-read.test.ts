import { describe, expect, test } from "bun:test";
import { analyzePostRead, extractContent } from "../../src/commands/post-read";
import { createEmptyIndex, upsertEntry, indexAsLookup } from "../../src/core/index-store";
import type { FileIndexEntry } from "../../src/types/file-index";
import type { PostToolUseInput } from "../../src/types/hook-input";

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

  test("index miss with content produces an indexEntry for lazy seeding", () => {
    const index = createEmptyIndex();

    const content = "export function hello() { return 'world'; }";
    const result = analyzePostRead(
      "src/utils/hello.ts",
      content,
      indexAsLookup(index)
    );

    expect(result.indexHit).toBe(false);
    expect(result.indexEntry).not.toBeNull();
    expect(result.indexEntry!.filePath).toBe("src/utils/hello.ts");
    expect(result.indexEntry!.estimatedTokens).toBeGreaterThan(0);
    expect(result.indexEntry!.lastModified.length).toBeGreaterThan(0);
    expect(result.indexEntry!.lastIndexed.length).toBeGreaterThan(0);
  });

  test("index hit with content does NOT produce a duplicate indexEntry", () => {
    const index = createEmptyIndex();
    upsertEntry(index, makeEntry("src/app.ts", 500));

    const content = "a".repeat(1000);
    const result = analyzePostRead("src/app.ts", content, indexAsLookup(index));

    expect(result.indexHit).toBe(true);
    expect(result.indexEntry).toBeNull();
  });

  test("no content + index miss produces no indexEntry (nothing to seed with)", () => {
    const index = createEmptyIndex();

    const result = analyzePostRead("src/missing.ts", null, indexAsLookup(index));

    expect(result.indexHit).toBe(false);
    expect(result.indexEntry).toBeNull();
  });

  test("binary file with content does NOT produce an indexEntry", () => {
    const index = createEmptyIndex();

    const result = analyzePostRead(
      "assets/logo.png",
      "fake binary content",
      indexAsLookup(index)
    );

    expect(result.indexEntry).toBeNull();
  });
});

describe("extractContent — payload-shape compatibility", () => {
  function payload(rest: Partial<PostToolUseInput>): PostToolUseInput {
    return {
      tool_name: "Read",
      tool_input: { file_path: "src/x.ts" },
      ...rest,
    };
  }

  test("reads legacy tool_output.content string", () => {
    const input = payload({ tool_output: { content: "hello world" } });
    expect(extractContent(input)).toBe("hello world");
  });

  test("reads modern tool_response.content string", () => {
    const input = payload({ tool_response: { content: "hello world" } });
    expect(extractContent(input)).toBe("hello world");
  });

  test("reads tool_response.content array of text parts", () => {
    const input = payload({
      tool_response: {
        content: [
          { type: "text", text: "alpha " },
          { type: "text", text: "beta" },
        ],
      },
    });
    expect(extractContent(input)).toBe("alpha beta");
  });

  test("reads tool_response.file.content nested string", () => {
    const input = payload({
      tool_response: { file: { content: "nested body" } },
    });
    expect(extractContent(input)).toBe("nested body");
  });

  test("reads tool_response.text fallback", () => {
    const input = payload({ tool_response: { text: "body" } });
    expect(extractContent(input)).toBe("body");
  });

  test("returns null when neither tool_output nor tool_response carries content", () => {
    expect(extractContent(payload({}))).toBeNull();
    expect(extractContent(payload({ tool_response: {} }))).toBeNull();
    expect(
      extractContent(payload({ tool_output: { other: "x" } as unknown as { content?: string } }))
    ).toBeNull();
  });

  test("prefers tool_response over legacy tool_output when both are present", () => {
    const input = payload({
      tool_output: { content: "old" },
      tool_response: { content: "new" },
    });
    expect(extractContent(input)).toBe("new");
  });
});
