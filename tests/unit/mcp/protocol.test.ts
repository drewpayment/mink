import { describe, expect, test } from "bun:test";
import {
  LATEST_PROTOCOL_VERSION,
  McpProtocol,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ServerInfo,
} from "../../../src/core/mcp/protocol";
import { JsonRpcErrorCode } from "../../../src/core/mcp/jsonrpc";
import {
  McpToolError,
  ToolInputError,
  requireString,
  type McpTool,
} from "../../../src/core/mcp/tool-types";

const serverInfo: ServerInfo = { name: "mink", version: "9.9.9" };

// A trio of fake tools to exercise routing without touching the DB.
const echoTool: McpTool = {
  name: "echo",
  title: "Echo",
  description: "Echoes the text argument.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true },
  async handler(args) {
    return `echo:${requireString(args, "text")}`;
  },
};

const boomTool: McpTool = {
  name: "boom",
  title: "Boom",
  description: "Always fails at runtime.",
  inputSchema: { type: "object", properties: {} },
  async handler() {
    throw new McpToolError("kaboom");
  },
};

const badInputTool: McpTool = {
  name: "picky",
  title: "Picky",
  description: "Requires a specific argument.",
  inputSchema: { type: "object", properties: { n: {} }, required: ["n"] },
  async handler(args) {
    if (typeof args.n !== "number") throw new ToolInputError("n must be a number");
    return String(args.n);
  },
};

function proto() {
  return new McpProtocol(serverInfo, { cwd: "/tmp/x" }, [echoTool, boomTool, badInputTool]);
}

describe("initialize", () => {
  test("echoes a supported requested protocol version", async () => {
    const p = proto();
    const res = await p.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {} },
    });
    const result = (res as { result: { protocolVersion: string; serverInfo: ServerInfo; capabilities: unknown } }).result;
    expect(result.protocolVersion).toBe("2024-11-05");
    expect(result.serverInfo).toEqual(serverInfo);
    expect(result.capabilities).toHaveProperty("tools");
  });

  test("falls back to latest for an unknown requested version", async () => {
    const p = proto();
    const res = await p.dispatch({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    });
    const version = (res as { result: { protocolVersion: string } }).result.protocolVersion;
    expect(version).toBe(LATEST_PROTOCOL_VERSION);
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(version);
  });

  test("handles initialize with no params", async () => {
    const p = proto();
    const res = await p.dispatch({ jsonrpc: "2.0", id: 1, method: "initialize" });
    expect((res as { result: { protocolVersion: string } }).result.protocolVersion).toBe(
      LATEST_PROTOCOL_VERSION
    );
  });
});

describe("lifecycle notifications", () => {
  test("notifications/initialized yields no response", async () => {
    const p = proto();
    expect(await p.dispatch({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });

  test("a request-shaped method sent as a notification yields no response", async () => {
    const p = proto();
    expect(await p.dispatch({ jsonrpc: "2.0", method: "tools/list" })).toBeNull();
  });

  test("unknown notification is ignored", async () => {
    const p = proto();
    expect(await p.dispatch({ jsonrpc: "2.0", method: "notifications/whatever" })).toBeNull();
  });
});

describe("ping", () => {
  test("returns an empty result", async () => {
    const p = proto();
    const res = await p.dispatch({ jsonrpc: "2.0", id: 2, method: "ping" });
    expect(res).toEqual({ jsonrpc: "2.0", id: 2, result: {} });
  });
});

describe("tools/list", () => {
  test("returns wire descriptors for every registered tool", async () => {
    const p = proto();
    const res = await p.dispatch({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const tools = (res as { result: { tools: Array<{ name: string; inputSchema: unknown }> } }).result.tools;
    expect(tools.map((t) => t.name)).toEqual(["echo", "boom", "picky"]);
    expect(tools[0]).toHaveProperty("description");
    expect(tools[0]).toHaveProperty("inputSchema");
    expect(tools[0]).toHaveProperty("annotations");
  });
});

describe("tools/call", () => {
  test("routes to the tool and wraps text content", async () => {
    const p = proto();
    const res = await p.dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "echo", arguments: { text: "hi" } },
    });
    expect((res as { result: unknown }).result).toEqual({
      content: [{ type: "text", text: "echo:hi" }],
      isError: false,
    });
  });

  test("a runtime tool failure becomes an isError result (not a protocol error)", async () => {
    const p = proto();
    const res = await p.dispatch({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "boom", arguments: {} },
    });
    const result = (res as { result: { isError: boolean; content: Array<{ text: string }> } }).result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe("kaboom");
  });

  test("a ToolInputError becomes INVALID_PARAMS", async () => {
    const p = proto();
    const res = await p.dispatch({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "picky", arguments: { n: "not-a-number" } },
    });
    expect((res as { error: { code: number } }).error.code).toBe(JsonRpcErrorCode.INVALID_PARAMS);
  });

  test("missing arguments defaults to an empty object", async () => {
    const p = proto();
    const res = await p.dispatch({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "echo" }, // no arguments → echo's requireString throws INVALID_PARAMS
    });
    expect((res as { error: { code: number } }).error.code).toBe(JsonRpcErrorCode.INVALID_PARAMS);
  });

  test("unknown tool name → INVALID_PARAMS", async () => {
    const p = proto();
    const res = await p.dispatch({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: { name: "does-not-exist", arguments: {} },
    });
    expect((res as { error: { code: number } }).error.code).toBe(JsonRpcErrorCode.INVALID_PARAMS);
  });

  test("non-object params → INVALID_PARAMS", async () => {
    const p = proto();
    const res = await p.dispatch({ jsonrpc: "2.0", id: 9, method: "tools/call", params: 5 });
    expect((res as { error: { code: number } }).error.code).toBe(JsonRpcErrorCode.INVALID_PARAMS);
  });
});

describe("error routing", () => {
  test("unknown method → METHOD_NOT_FOUND", async () => {
    const p = proto();
    const res = await p.dispatch({ jsonrpc: "2.0", id: 10, method: "no/such" });
    expect((res as { error: { code: number } }).error.code).toBe(JsonRpcErrorCode.METHOD_NOT_FOUND);
  });

  test("malformed message → INVALID_REQUEST with best-effort id", async () => {
    const p = proto();
    const res = await p.dispatch({ jsonrpc: "2.0", id: 11 }); // no method
    expect((res as { id: number }).id).toBe(11);
    expect((res as { error: { code: number } }).error.code).toBe(JsonRpcErrorCode.INVALID_REQUEST);
  });

  test("id is echoed exactly on every response", async () => {
    const p = proto();
    for (const id of ["s", 0, 42, null] as const) {
      const res = await p.dispatch({ jsonrpc: "2.0", id, method: "ping" });
      expect((res as { id: unknown }).id).toBe(id);
    }
  });
});
