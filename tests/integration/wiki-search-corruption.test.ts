// End-to-end coverage for corruption recovery in the wiki search index CLI
// surface (`mink recall`, `mink wiki backlinks/related`): a thrown SQLite
// error (corrupted .mink-search.db) must never reach the user as a raw
// uncaught stack trace. core/wiki-search.ts's withCorruptionRecovery()
// already covers the "recovers and returns correct results" case at the
// unit level (tests/unit/core/wiki-search.test.ts); this file proves the
// CLI process itself behaves — spawning the real binary is the only way to
// observe what an uncaught exception actually prints to stderr and what
// exit code the process gets, which unit-testing the exported functions
// directly cannot show.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";

const CLI_TS = resolve(import.meta.dir, "../../src/cli.ts");

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: Record<string, string>): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const proc = spawn("bun", [CLI_TS, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    proc.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    proc.on("exit", (code) => resolveRun({ exitCode: code ?? -1, stdout, stderr }));
  });
}

let minkRoot: string;
let vaultPath: string;
let env: Record<string, string>;

beforeEach(() => {
  minkRoot = mkdtempSync(join(tmpdir(), "mink-corrupt-root-"));
  vaultPath = join(minkRoot, "wiki");
  mkdirSync(vaultPath, { recursive: true });
  writeFileSync(join(vaultPath, ".mink-vault.json"), "{}");
  mkdirSync(join(vaultPath, "inbox"), { recursive: true });
  writeFileSync(
    join(vaultPath, "inbox", "note.md"),
    "---\ntags: []\ncategory: inbox\n---\n\n# Flywheel Notes\n\na fact about flywheels\n"
  );
  env = {
    MINK_ROOT_OVERRIDE: minkRoot,
    MINK_WIKI_PATH: vaultPath,
    MINK_WIKI_ENABLED: "true",
  };
});

afterEach(() => {
  rmSync(minkRoot, { recursive: true, force: true });
});

describe("corruption recovery — spawned CLI", () => {
  test("mink recall self-heals from a corrupted .mink-search.db and returns correct results", async () => {
    // Prime a valid index first.
    await run(["wiki", "reindex"], env);

    // Corrupt it.
    writeFileSync(join(vaultPath, ".mink-search.db"), "not a valid sqlite file at all");

    const result = await run(["recall", "flywheels", "--json"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("SQLiteError");
    expect(result.stderr).not.toContain("at prepare");
    const parsed = JSON.parse(result.stdout);
    expect(parsed.results.length).toBe(1);
    expect(parsed.results[0].path).toBe("inbox/note.md");
  });

  test("mink wiki backlinks self-heals from a corrupted .mink-search.db", async () => {
    await run(["wiki", "reindex"], env);
    writeFileSync(join(vaultPath, ".mink-search.db"), "not a valid sqlite file at all");

    const result = await run(["wiki", "backlinks", "Flywheel Notes", "--json"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("SQLiteError");
    const parsed = JSON.parse(result.stdout);
    expect(parsed.note).toBe("inbox/note.md");
  });

  test("mink wiki reindex itself self-heals from a corrupted database", async () => {
    await run(["wiki", "reindex"], env);
    writeFileSync(join(vaultPath, ".mink-search.db"), "not a valid sqlite file at all");

    const result = await run(["wiki", "reindex"], env);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("SQLiteError");
    expect(result.stdout).toContain("indexed 1 notes");
  });
});
