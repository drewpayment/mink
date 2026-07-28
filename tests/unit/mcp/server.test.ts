import { describe, expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import { McpServer } from "../../../src/core/mcp/server";
import { JsonRpcErrorCode } from "../../../src/core/mcp/jsonrpc";
import { requireString, type McpTool } from "../../../src/core/mcp/tool-types";

const echoTool: McpTool = {
  name: "echo",
  title: "Echo",
  description: "Echoes text.",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  async handler(args) {
    return requireString(args, "text");
  },
};

function makeServer() {
  return new McpServer({ cwd: "/tmp/x", serverInfo: { name: "mink", version: "0.0.0" }, tools: [echoTool] });
}

describe("McpServer.handleLine", () => {
  test("blank lines produce no output", async () => {
    expect(await makeServer().handleLine("   ")).toBeNull();
  });

  test("notifications produce no output", async () => {
    const out = await makeServer().handleLine('{"jsonrpc":"2.0","method":"notifications/initialized"}');
    expect(out).toBeNull();
  });

  test("a parse error yields an error frame with id null", async () => {
    const out = await makeServer().handleLine("{broken");
    expect(out).not.toBeNull();
    const msg = JSON.parse(out!);
    expect(msg.id).toBeNull();
    expect(msg.error.code).toBe(JsonRpcErrorCode.PARSE_ERROR);
  });

  test("a valid request yields a serialized single-line response", async () => {
    const out = await makeServer().handleLine('{"jsonrpc":"2.0","id":1,"method":"ping"}');
    expect(out).not.toBeNull();
    expect(out!.includes("\n")).toBe(false);
    expect(JSON.parse(out!)).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  });

  test("a batch of invalid items yields an array of INVALID_REQUEST responses", async () => {
    const out = await makeServer().handleLine("[1,2,3]");
    const msg = JSON.parse(out!);
    expect(Array.isArray(msg)).toBe(true);
    expect(msg).toHaveLength(3);
    expect(msg[0].error.code).toBe(JsonRpcErrorCode.INVALID_REQUEST);
  });

  test("a batch of requests yields an array of responses, omitting notifications", async () => {
    const batch = JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    const out = await makeServer().handleLine(batch);
    const msg = JSON.parse(out!);
    expect(Array.isArray(msg)).toBe(true);
    expect(msg.map((m: { id: number }) => m.id)).toEqual([1, 2]);
  });

  test("an empty batch is INVALID_REQUEST", async () => {
    const out = await makeServer().handleLine("[]");
    expect(JSON.parse(out!).error.code).toBe(JsonRpcErrorCode.INVALID_REQUEST);
  });

  test("a batch of only notifications yields no output", async () => {
    const out = await makeServer().handleLine(
      JSON.stringify([{ jsonrpc: "2.0", method: "notifications/initialized" }])
    );
    expect(out).toBeNull();
  });
});

/** Drive serve() with an in-memory stream and collect the response frames. */
async function driveServer(frames: string[]): Promise<string[]> {
  const server = makeServer();
  const input = new PassThrough();
  const out: string[] = [];
  const done = server.serve({ input, write: (line) => out.push(line) });
  for (const f of frames) input.write(f);
  input.end();
  await done;
  return out.map((l) => l);
}

describe("McpServer.serve (framing)", () => {
  test("processes multiple newline-delimited messages in order", async () => {
    const out = await driveServer([
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
    ]);
    expect(out).toHaveLength(2);
    expect(JSON.parse(out[0]).id).toBe(1);
    expect(JSON.parse(out[1]).id).toBe(2);
    expect(JSON.parse(out[1]).result.tools[0].name).toBe("echo");
  });

  test("reassembles a message split across chunks", async () => {
    const out = await driveServer(['{"jsonrpc":"2.0","id":', '7,"method":"ping"}\n']);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]).id).toBe(7);
  });

  test("delivers multiple messages arriving in a single chunk", async () => {
    const out = await driveServer([
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
    ]);
    expect(out.map((l) => JSON.parse(l).id)).toEqual([1, 2]);
  });

  test("flushes a trailing message that has no terminating newline", async () => {
    const out = await driveServer(['{"jsonrpc":"2.0","id":9,"method":"ping"}']);
    expect(out).toHaveLength(1);
    expect(JSON.parse(out[0]).id).toBe(9);
  });

  test("a notification between requests emits no frame for itself", async () => {
    const out = await driveServer([
      '{"jsonrpc":"2.0","id":1,"method":"ping"}\n',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
      '{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
    ]);
    expect(out.map((l) => JSON.parse(l).id)).toEqual([1, 2]);
  });

  test("routes a tool call end-to-end through the transport", async () => {
    const out = await driveServer([
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo","arguments":{"text":"hey"}}}\n',
    ]);
    expect(JSON.parse(out[0]).result).toEqual({
      content: [{ type: "text", text: "hey" }],
      isError: false,
    });
  });
});
