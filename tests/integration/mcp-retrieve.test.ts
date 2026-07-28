// Integration: the mink_retrieve tool, driven through the full MCP server
// against a real per-project SQLite compression cache (spec 22 × spec 24).
// Proves the reversibility contract survives the protocol boundary: what the
// hook stored is what the tool returns, byte-for-byte.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { McpServer } from "../../src/core/mcp/server";
import { CompressionCacheRepo } from "../../src/repositories/compression-cache-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../src/storage/db";
import { projectIdFor } from "../../src/core/project-id";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-mcp-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-mcp-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function server() {
  return new McpServer({ cwd, serverInfo: { name: "mink", version: "test" } });
}

async function callRetrieve(token: string): Promise<{ text: string; isError: boolean }> {
  const frame = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "mink_retrieve", arguments: { token } },
  });
  const out = await server().handleLine(frame);
  const result = JSON.parse(out!).result;
  return { text: result.content[0].text, isError: result.isError };
}

describe("mink_retrieve over MCP", () => {
  test("returns the byte-exact original for a valid token", async () => {
    const original = "match 1\nmatch 2\n\ttab and unicode: ééé 🚀\nend";
    const token = new CompressionCacheRepo(openProjectDb(cwd)).store({
      toolName: "Grep",
      contentKind: "search",
      content: original,
      retentionHours: 168,
    }, "dev-a");

    const { text, isError } = await callRetrieve(token);
    expect(isError).toBe(false);
    expect(text).toBe(original);
  });

  test("an unknown token is a graceful miss, not an error", async () => {
    const { text, isError } = await callRetrieve("mc-deadbeef");
    expect(isError).toBe(false);
    expect(text).toContain("unknown or expired");
  });

  test("an expired token is a graceful miss", async () => {
    const past = new Date("2026-01-01T00:00:00.000Z");
    const token = new CompressionCacheRepo(openProjectDb(cwd)).store({
      toolName: "Bash",
      contentKind: "log",
      content: "stale output",
      retentionHours: 1,
      now: past,
    }, "dev-a");
    _resetDbCacheForTests(); // simulate a fresh process reading later

    const { text, isError } = await callRetrieve(token);
    expect(isError).toBe(false);
    expect(text).toContain("unknown or expired");
  });

  test("mink_retrieve is advertised in tools/list", async () => {
    const out = await server().handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    );
    const names = JSON.parse(out!).result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("mink_retrieve");
  });

  test("initialize handshake reports server info and tools capability", async () => {
    const out = await server().handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "initialize", params: { protocolVersion: "2025-06-18" } })
    );
    const result = JSON.parse(out!).result;
    expect(result.serverInfo.name).toBe("mink");
    expect(result.capabilities).toHaveProperty("tools");
    expect(result.protocolVersion).toBe("2025-06-18");
  });
});
