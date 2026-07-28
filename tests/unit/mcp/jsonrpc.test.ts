import { describe, expect, test } from "bun:test";
import {
  JsonRpcErrorCode,
  asJsonRpcRequest,
  extractId,
  isNotification,
  isValidId,
  makeError,
  makeResult,
  parseJson,
  serialize,
} from "../../../src/core/mcp/jsonrpc";

describe("jsonrpc.parseJson", () => {
  test("parses a valid object frame", () => {
    const out = parseJson('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
  });

  test("returns PARSE_ERROR on malformed JSON, never throws", () => {
    const out = parseJson("{not json");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe(JsonRpcErrorCode.PARSE_ERROR);
  });

  test("parses non-object JSON values without error (validation is separate)", () => {
    const out = parseJson("42");
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value).toBe(42);
  });
});

describe("jsonrpc.isValidId", () => {
  test("accepts string, number, and null", () => {
    expect(isValidId("a")).toBe(true);
    expect(isValidId(7)).toBe(true);
    expect(isValidId(null)).toBe(true);
  });
  test("rejects objects, arrays, booleans, undefined", () => {
    expect(isValidId({})).toBe(false);
    expect(isValidId([])).toBe(false);
    expect(isValidId(true)).toBe(false);
    expect(isValidId(undefined)).toBe(false);
  });
});

describe("jsonrpc.asJsonRpcRequest", () => {
  test("narrows a well-formed request", () => {
    const req = asJsonRpcRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(req).not.toBeNull();
    expect(req!.method).toBe("tools/list");
  });

  test("narrows a well-formed notification (no id)", () => {
    const req = asJsonRpcRequest({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(req).not.toBeNull();
    expect(isNotification(req!)).toBe(true);
  });

  test.each([
    ["wrong version", { jsonrpc: "1.0", id: 1, method: "x" }],
    ["missing method", { jsonrpc: "2.0", id: 1 }],
    ["non-string method", { jsonrpc: "2.0", id: 1, method: 5 }],
    ["invalid id type", { jsonrpc: "2.0", id: {}, method: "x" }],
    ["array", [1, 2, 3]],
    ["null", null],
    ["primitive", 42],
  ])("rejects %s", (_label, value) => {
    expect(asJsonRpcRequest(value)).toBeNull();
  });
});

describe("jsonrpc.isNotification", () => {
  test("true when id is absent", () => {
    expect(isNotification({ jsonrpc: "2.0", method: "x" })).toBe(true);
  });
  test("false when id is present (including id null)", () => {
    expect(isNotification({ jsonrpc: "2.0", id: null, method: "x" })).toBe(false);
    expect(isNotification({ jsonrpc: "2.0", id: 0, method: "x" })).toBe(false);
  });
});

describe("jsonrpc.extractId", () => {
  test("returns a valid id when present", () => {
    expect(extractId({ id: "abc" })).toBe("abc");
    expect(extractId({ id: 9 })).toBe(9);
  });
  test("returns null for missing/invalid id or non-objects", () => {
    expect(extractId({})).toBeNull();
    expect(extractId({ id: {} })).toBeNull();
    expect(extractId(null)).toBeNull();
    expect(extractId([1])).toBeNull();
  });
});

describe("jsonrpc builders + serialize", () => {
  test("makeResult echoes the id and carries the result", () => {
    expect(makeResult(3, { ok: true })).toEqual({ jsonrpc: "2.0", id: 3, result: { ok: true } });
  });

  test("makeError includes code/message and optional data", () => {
    expect(makeError(1, -32601, "nope")).toEqual({
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32601, message: "nope" },
    });
    const withData = makeError(1, -32700, "bad", { detail: "x" });
    expect((withData.error as { data?: unknown }).data).toEqual({ detail: "x" });
  });

  test("serialize produces a single line (no embedded newlines)", () => {
    const line = serialize(makeResult(1, { text: "a\nb" }));
    // The newline inside the string is escaped by JSON.stringify.
    expect(line.includes("\n")).toBe(false);
    expect(JSON.parse(line).result.text).toBe("a\nb");
  });

  test("round-trip: id is preserved for all valid id kinds", () => {
    for (const id of ["s", 0, -1, 12345, null] as const) {
      const line = serialize(makeResult(id, {}));
      expect(JSON.parse(line).id).toBe(id);
    }
  });
});
