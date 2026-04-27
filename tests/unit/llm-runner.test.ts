import { describe, test, expect } from "bun:test";
import { safeJsonExtract } from "../../src/core/llm-runner";

describe("safeJsonExtract", () => {
  test("parses raw JSON object", () => {
    const result = safeJsonExtract<{ a: number }>('{"a":1}');
    expect(result).toEqual({ a: 1 });
  });

  test("parses raw JSON array", () => {
    const result = safeJsonExtract<number[]>("[1,2,3]");
    expect(result).toEqual([1, 2, 3]);
  });

  test("strips fenced code block", () => {
    const result = safeJsonExtract<{ a: number }>(
      '```json\n{"a":1}\n```'
    );
    expect(result).toEqual({ a: 1 });
  });

  test("strips fenced code block without language tag", () => {
    const result = safeJsonExtract<{ a: number }>(
      '```\n{"a":1}\n```'
    );
    expect(result).toEqual({ a: 1 });
  });

  test("recovers JSON from surrounding prose", () => {
    const result = safeJsonExtract<{ ok: boolean }>(
      'Here you go:\n{"ok":true}\nHope that helps!'
    );
    expect(result).toEqual({ ok: true });
  });

  test("handles nested braces and string-escaped braces", () => {
    const raw = '{"x":{"y":"a}b"},"z":[1,2]}';
    const result = safeJsonExtract<{ x: { y: string }; z: number[] }>(raw);
    expect(result?.x.y).toBe("a}b");
    expect(result?.z).toEqual([1, 2]);
  });

  test("returns null on totally malformed input", () => {
    expect(safeJsonExtract("nope nope nope")).toBeNull();
  });

  test("returns null on empty input", () => {
    expect(safeJsonExtract("")).toBeNull();
  });

  test("returns null when JSON is unterminated", () => {
    expect(safeJsonExtract('{"a":1')).toBeNull();
  });
});
