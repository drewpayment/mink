// Integration: the phase-2 MCP read tools driven through the full server
// against real project state — bug memory (SQLite/FTS5), the wiki vault,
// on-disk files, and merged learning memory (spec 24).

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { tmpdir } from "os";

import { McpServer } from "../../src/core/mcp/server";
import { _resetDbCacheForTests } from "../../src/storage/db";
import { projectIdFor } from "../../src/core/project-id";
import { learningMemoryPath } from "../../src/core/paths";
import { serializeLearningMemory } from "../../src/core/learning-memory";
import type { LearningMemory } from "../../src/types/learning-memory";
import { BugMemoryRepo } from "../../src/repositories/bug-memory-repo";
import { openProjectDb } from "../../src/storage/db";
import { ensureVaultStructure, vaultManifestPath } from "../../src/core/vault";
import { createNote } from "../../src/core/note-writer";
import { updateVaultIndexForFile } from "../../src/core/note-index";
import { atomicWriteJson } from "../../src/core/fs-utils";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-mcp-read-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-mcp-read-cwd-"));
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

describe("mink_recall_bugs", () => {
  test("returns matching past bugs with root cause and fix", async () => {
    BugMemoryRepo.for(cwd).add({
      errorMessage: "TypeError: cannot read properties of undefined (reading 'map')",
      filePath: "src/list.ts",
      lineNumber: 42,
      rootCause: "response was null before the fetch resolved",
      fixDescription: "guard with optional chaining and a default array",
      tags: ["async", "null-safety"],
      relatedBugIds: [],
    });

    // An exact-substring query clears the similarity threshold reliably.
    const { text, isError } = await call("mink_recall_bugs", { query: "cannot read properties of undefined" });
    expect(isError).toBe(false);
    expect(text).toContain("src/list.ts:42");
    expect(text).toContain("optional chaining");
    expect(text).toContain("root cause");
  });

  test("graceful message when nothing matches", async () => {
    const { text, isError } = await call("mink_recall_bugs", { query: "a totally unrelated phrase xyzzy" });
    expect(isError).toBe(false);
    expect(text).toContain("No past bugs found");
  });

  test("missing query → INVALID_PARAMS", async () => {
    const { errorCode } = await call("mink_recall_bugs", {});
    expect(errorCode).toBe(-32602);
  });
});

describe("mink_search_wiki", () => {
  test("reports when the wiki is disabled", async () => {
    process.env.MINK_WIKI_ENABLED = "false";
    const { text, isError } = await call("mink_search_wiki", { query: "anything" });
    expect(isError).toBe(false);
    expect(text).toContain("not enabled");
  });

  test("finds notes when the vault is enabled and populated", async () => {
    process.env.MINK_WIKI_ENABLED = "true";
    process.env.MINK_WIKI_PATH = join(tmpRoot, "wiki");
    ensureVaultStructure();
    atomicWriteJson(vaultManifestPath(), { version: 1, createdAt: "2026-01-01T00:00:00.000Z" });

    const now = "2026-07-01T00:00:00.000Z";
    const note = createNote({
      title: "Kafka partitioning strategy",
      category: "resources",
      tags: ["kafka", "scaling"],
      created: now,
      updated: now,
      body: "Notes on choosing a partition key for even distribution.",
    });
    updateVaultIndexForFile(note.filePath, note.content);

    const { text, isError } = await call("mink_search_wiki", { query: "kafka" });
    expect(isError).toBe(false);
    expect(text).toContain("Kafka partitioning strategy");
    expect(text).toContain("resources");
  });
});

describe("mink_file_skeleton", () => {
  test("returns a structural skeleton with bodies elided", async () => {
    const file = join(cwd, "sample.ts");
    writeFileSync(
      file,
      [
        "export function add(a: number, b: number): number {",
        "  return a + b;",
        "}",
        "export class Widget {",
        "  render(): string {",
        '    return "<div/>";',
        "  }",
        "}",
      ].join("\n")
    );

    const { text, isError } = await call("mink_file_skeleton", { path: "sample.ts" });
    expect(isError).toBe(false);
    expect(text).toContain("add");
    expect(text).toContain("Widget");
    expect(text).toContain("signature");
    // The body statement must NOT appear verbatim (it was elided).
    expect(text).not.toContain("return a + b;");
  });

  test("graceful message for a missing file", async () => {
    const { text, isError } = await call("mink_file_skeleton", { path: "does/not/exist.ts" });
    expect(isError).toBe(false);
    expect(text).toContain("File not found");
  });

  test("refuses to read a path outside the project root", async () => {
    // A traversal path and an absolute path outside cwd are both confined.
    const traversal = await call("mink_file_skeleton", { path: "../../../../etc/hosts" });
    expect(traversal.isError).toBe(false);
    expect(traversal.text).toContain("outside the project root");

    const absolute = await call("mink_file_skeleton", { path: "/etc/hosts" });
    expect(absolute.text).toContain("outside the project root");
  });

  test("refuses to skeletonize a file over the size cap", async () => {
    const big = join(cwd, "big.txt");
    writeFileSync(big, "a".repeat(2 * 1024 * 1024 + 1)); // > 2 MiB
    const { text, isError } = await call("mink_file_skeleton", { path: "big.txt" });
    expect(isError).toBe(false);
    expect(text).toContain("too large");
  });

  test("redacts secrets in the returned skeleton/description", async () => {
    const key = "AKIA" + "IOSFODNN7EXAMPLE";
    writeFileSync(join(cwd, "leak.txt"), `deploy key ${key} lives here`);
    const { text, isError } = await call("mink_file_skeleton", { path: "leak.txt" });
    expect(isError).toBe(false);
    expect(text).not.toContain(key);
    expect(text).toContain("[REDACTED:aws-access-key]");
  });
});

describe("mink_project_rules", () => {
  function seedRules() {
    const mem: LearningMemory = {
      projectName: "sample",
      sections: {
        "User Preferences": ["Prefer bun over npm for scripts"],
        "Key Learnings": ["FTS5 needs the porter tokenizer for stemming"],
        "Do-Not-Repeat": ["Do not hardcode absolute paths"],
        "Decision Log": ["Chose SQLite over JSON for the file index"],
      },
    };
    const p = learningMemoryPath(cwd);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, serializeLearningMemory(mem));
  }

  test("returns all sections with their entries", async () => {
    seedRules();
    const { text, isError } = await call("mink_project_rules", {});
    expect(isError).toBe(false);
    expect(text).toContain("User Preferences");
    expect(text).toContain("Prefer bun over npm");
    expect(text).toContain("Do not hardcode absolute paths");
  });

  test("filters to a single section (case-insensitive)", async () => {
    seedRules();
    const { text } = await call("mink_project_rules", { section: "do-not-repeat" });
    expect(text).toContain("Do not hardcode absolute paths");
    expect(text).not.toContain("Prefer bun over npm");
  });

  test("unknown section → INVALID_PARAMS", async () => {
    seedRules();
    const { errorCode } = await call("mink_project_rules", { section: "nonsense" });
    expect(errorCode).toBe(-32602);
  });

  test("graceful message when no rules recorded", async () => {
    const { text, isError } = await call("mink_project_rules", {});
    expect(isError).toBe(false);
    expect(text).toContain("No learned rules");
  });
});

describe("tools/list after phase 2", () => {
  test("advertises the phase-1/2 tools in registration order", async () => {
    const out = await server().handleLine(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    );
    const names: string[] = JSON.parse(out!).result.tools.map((t: { name: string }) => t.name);
    // Later phases append more tools; the first five are stable.
    expect(names.slice(0, 5)).toEqual([
      "mink_retrieve",
      "mink_recall_bugs",
      "mink_search_wiki",
      "mink_file_skeleton",
      "mink_project_rules",
    ]);
  });
});
