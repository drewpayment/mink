import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { projectDir } from "../../src/core/paths";
import { status } from "../../src/commands/status";

function createTempProject(): string {
  const name = `mink-status-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("status command", () => {
  let testCwd: string;
  let logs: string[];

  const originalLog = console.log;
  const originalWarn = console.warn;

  beforeEach(() => {
    testCwd = createTempProject();
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.warn = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    rmSync(testCwd, { recursive: true, force: true });
    try {
      rmSync(projectDir(testCwd), { recursive: true, force: true });
    } catch {}
  });

  test("shows status for initialized project", () => {
    const stateDir = projectDir(testCwd);
    mkdirSync(stateDir, { recursive: true });

    // Create all required state files
    writeFileSync(
      join(stateDir, "session.json"),
      JSON.stringify({ sessionId: "test", reads: {}, writes: [] })
    );
    writeFileSync(
      join(stateDir, "file-index.json"),
      JSON.stringify({
        header: {
          lastScanTimestamp: "2024-01-01T00:00:00.000Z",
          totalFiles: 42,
          lifetimeHits: 100,
          lifetimeMisses: 10,
        },
        entries: {},
      })
    );
    writeFileSync(join(stateDir, "config.json"), "{}");
    writeFileSync(
      join(stateDir, "learning-memory.md"),
      "# Learning Memory — test\n\n## User Preferences\n- pref1\n\n## Key Learnings\n- learn1\n- learn2\n\n## Do-Not-Repeat\n\n## Decision Log\n- dec1\n"
    );
    writeFileSync(
      join(stateDir, "token-ledger.json"),
      JSON.stringify({
        lifetime: {
          totalTokens: 5000,
          totalReads: 100,
          totalWrites: 50,
          totalSessions: 3,
          totalFileIndexHits: 80,
          totalFileIndexMisses: 20,
          totalRepeatedReads: 5,
          totalEstimatedSavings: 1500,
        },
        sessions: [],
      })
    );
    writeFileSync(
      join(stateDir, "bug-memory.json"),
      JSON.stringify({ entries: [{ id: "bug-001" }], nextId: 2 })
    );
    writeFileSync(join(stateDir, "action-log.md"), "# Action Log\n");

    status(testCwd);

    const output = logs.join("\n");
    expect(output).toContain("[mink] project status");
    expect(output).toContain("session.json: ok");
    // Spec 17 (Phase 2): file_index moved into mink.db. The state-file
    // integrity check reports the DB instead of file-index.json.
    expect(output).toContain("mink.db: ok");
    // The seeded file-index.json had an empty entries map, so post-
    // migration the file_index table has 0 rows. Status reports the
    // file index as "not available" when there are no entries.
    expect(output).toContain("File index: not available");
    expect(output).toContain("Sessions: 3");
    expect(output).toContain("5,000");
    expect(output).toContain("1,500");
    expect(output).toContain("User Preferences: 1");
    expect(output).toContain("Key Learnings: 2");
    expect(output).toContain("Decision Log: 1");
    expect(output).toContain("1 entries");
    expect(output).toContain("Daemon: stopped");
  });

  test("handles missing state files gracefully", () => {
    const stateDir = projectDir(testCwd);
    mkdirSync(stateDir, { recursive: true });
    // Don't create any files

    status(testCwd);

    const output = logs.join("\n");
    expect(output).toContain("[mink] project status");
    expect(output).toContain("missing");
  });

  test("handles corrupt files gracefully", () => {
    const stateDir = projectDir(testCwd);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "file-index.json"), "not json{{{");
    writeFileSync(join(stateDir, "token-ledger.json"), "corrupt");

    status(testCwd);

    const output = logs.join("\n");
    expect(output).toContain("corrupt");
  });
});
