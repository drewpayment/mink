// Integration: the phase-3 MCP write tools through the full server — capturing
// notes into the vault and logging bugs into bug memory, with secret redaction
// enforced on the write path (spec 24 × spec 28 seed).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { McpServer } from "../../src/core/mcp/server";
import { _resetDbCacheForTests } from "../../src/storage/db";
import { projectIdFor } from "../../src/core/project-id";
import { BugMemoryRepo } from "../../src/repositories/bug-memory-repo";
import {
  ensureVaultStructure,
  resolveVaultPath,
  vaultManifestPath,
} from "../../src/core/vault";
import { searchVaultIndex } from "../../src/core/note-index";
import { atomicWriteJson } from "../../src/core/fs-utils";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-mcp-write-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-mcp-write-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  delete process.env.MINK_WIKI_ENABLED;
  delete process.env.MINK_WIKI_PATH;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function server() {
  return new McpServer({ cwd, serverInfo: { name: "mink", version: "test" } });
}

async function call(name: string, args: Record<string, unknown>): Promise<{
  text?: string;
  isError?: boolean;
  errorCode?: number;
}> {
  const out = await server().handleLine(
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })
  );
  const msg = JSON.parse(out!);
  if (msg.error) return { errorCode: msg.error.code };
  return { text: msg.result.content[0].text, isError: msg.result.isError };
}

function enableVault() {
  process.env.MINK_WIKI_ENABLED = "true";
  process.env.MINK_WIKI_PATH = join(tmpRoot, "wiki");
  ensureVaultStructure();
  atomicWriteJson(vaultManifestPath(), { version: 1, createdAt: "2026-01-01T00:00:00.000Z" });
}

describe("mink_capture_note", () => {
  test("captures a note and indexes it", async () => {
    enableVault();
    const { text, isError } = await call("mink_capture_note", {
      body: "Remember to checkpoint the WAL before sync.",
      title: "WAL checkpoint before sync",
      tags: ["sqlite", "sync"],
      category: "resources",
    });
    expect(isError).toBe(false);
    expect(text).toContain("Captured note");

    const found = searchVaultIndex("WAL checkpoint");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].title).toContain("WAL checkpoint");
  });

  test("redacts secrets in the note body before writing to disk", async () => {
    enableVault();
    const { text } = await call("mink_capture_note", {
      body: "deploy key: AKIAIOSFODNN7EXAMPLE — do not lose it",
      title: "deploy notes",
    });
    expect(text).toContain("redacted");

    // The secret must not exist anywhere in the vault on disk.
    const found = searchVaultIndex("deploy notes");
    expect(found.length).toBeGreaterThan(0);
    const onDisk = readFileSync(join(resolveVaultPath(), found[0].filePath), "utf-8");
    expect(onDisk).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(onDisk).toContain("[REDACTED:aws-access-key]");
  });

  test("derives a title from the first line when omitted", async () => {
    enableVault();
    const { text, isError } = await call("mink_capture_note", {
      body: "First line becomes the title\nmore detail here",
    });
    expect(isError).toBe(false);
    expect(text).toContain("First line becomes the title");
  });

  test("reports gracefully when the wiki is disabled", async () => {
    process.env.MINK_WIKI_ENABLED = "false";
    const { text, isError } = await call("mink_capture_note", { body: "x" });
    expect(isError).toBe(false);
    expect(text).toContain("not enabled");
  });

  test("unknown category → INVALID_PARAMS", async () => {
    enableVault();
    const { errorCode } = await call("mink_capture_note", { body: "x", category: "bogus" });
    expect(errorCode).toBe(-32602);
  });

  test("missing body → INVALID_PARAMS", async () => {
    enableVault();
    const { errorCode } = await call("mink_capture_note", {});
    expect(errorCode).toBe(-32602);
  });
});

describe("mink_log_bug", () => {
  test("logs a bug that is then persisted and searchable", async () => {
    const { text, isError } = await call("mink_log_bug", {
      error: "RangeError: Maximum call stack size exceeded",
      file: "src/walk.ts",
      line: 88,
      rootCause: "recursion without a base case on cyclic input",
      fix: "track visited nodes and short-circuit",
      tags: ["recursion"],
    });
    expect(isError).toBe(false);
    expect(text).toContain("Bug logged");
    expect(text).toContain("src/walk.ts:88");

    _resetDbCacheForTests();
    const found = BugMemoryRepo.for(cwd).lookupForFile("src/walk.ts");
    expect(found.length).toBe(1);
    expect(found[0].rootCause).toContain("base case");
  });

  test("re-logging the same error bumps the occurrence count", async () => {
    const args = {
      error: "ECONNREFUSED",
      file: "src/net.ts",
      rootCause: "server not started",
      fix: "await readiness probe",
    };
    const first = await call("mink_log_bug", args);
    expect(first.text).toContain("Bug logged");
    const second = await call("mink_log_bug", args);
    expect(second.text).toContain("updated (occurrence 2)");
  });

  test("redacts secrets in bug fields before storage", async () => {
    await call("mink_log_bug", {
      error: "auth failed",
      file: "src/auth.ts",
      rootCause: "used token=ghp_" + "b".repeat(36) + " in the request",
      fix: "read the token from the environment",
    });
    _resetDbCacheForTests();
    const found = BugMemoryRepo.for(cwd).lookupForFile("src/auth.ts");
    expect(found[0].rootCause).not.toContain("ghp_");
    expect(found[0].rootCause).toContain("[REDACTED:github-token]");
  });

  test("missing required fields → INVALID_PARAMS", async () => {
    const { errorCode } = await call("mink_log_bug", { error: "x", file: "y" });
    expect(errorCode).toBe(-32602);
  });
});

describe("tools/list after phase 3", () => {
  test("advertises all eight tools", async () => {
    const out = await server().handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    );
    const names = JSON.parse(out!).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual([
      "mink_retrieve",
      "mink_recall_bugs",
      "mink_search_wiki",
      "mink_file_skeleton",
      "mink_project_rules",
      "mink_capture_note",
      "mink_log_bug",
      "mink_context_pack",
    ]);
  });
});
