import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";

let mockRoot: string;

beforeEach(() => {
  mockRoot = mkdtempSync(join(tmpdir(), "mink-migrate-test-"));
  process.env.MINK_ROOT_OVERRIDE = mockRoot;
});

afterEach(() => {
  delete process.env.MINK_ROOT_OVERRIDE;
  rmSync(mockRoot, { recursive: true, force: true });
});

function seedV1Project(projectId: string) {
  const projDir = join(mockRoot, "projects", projectId);
  mkdirSync(projDir, { recursive: true });

  // legacy non-sharded state
  writeFileSync(
    join(projDir, "token-ledger.json"),
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
    join(projDir, "bug-memory.json"),
    JSON.stringify({ entries: [{ id: "bug-001", errorMessage: "x", filePath: "x", rootCause: "rc", fixDescription: "fix", tags: [], occurrenceCount: 1, createdAt: "2026-04-01T00:00:00.000Z", lastSeenAt: "2026-04-01T00:00:00.000Z", relatedBugIds: [] }], nextId: 2 })
  );
  writeFileSync(join(projDir, "action-log.md"), "# Action log\n");
  writeFileSync(
    join(projDir, "learning-memory.md"),
    "# Learning Memory — proj\n\n## User Preferences\n- one\n\n## Key Learnings\n\n## Do-Not-Repeat\n\n## Decision Log\n"
  );

  // file-index with embedded counters
  writeFileSync(
    join(projDir, "file-index.json"),
    JSON.stringify({
      header: {
        lastScanTimestamp: "2026-04-01T00:00:00.000Z",
        totalFiles: 1,
        lifetimeHits: 42,
        lifetimeMisses: 7,
      },
      entries: {
        "src/a.ts": {
          filePath: "src/a.ts",
          description: "x",
          estimatedTokens: 100,
          lastModified: "2026-04-01T00:00:00.000Z",
          lastIndexed: "2026-04-01T00:00:00.000Z",
        },
      },
    })
  );

  return projDir;
}

function initBareGit() {
  // Initialise a real git repo so `git mv` works inside migrateProject.
  execSync(`git init -q "${mockRoot}"`);
  execSync(`git -C "${mockRoot}" config user.email "test@example.com"`);
  execSync(`git -C "${mockRoot}" config user.name "Test"`);
  execSync(`git -C "${mockRoot}" add -A`);
  execSync(`git -C "${mockRoot}" commit -q -m initial`);
  // Mark sync as enabled so isSyncInitialized() returns true (the `commit` step
  // inside migration is gated on it).
  const configPath = join(mockRoot, "config");
  writeFileSync(configPath, "sync.enabled=true\n");
}

describe("sync v1 → v2 migration", () => {
  test("moves legacy state files into the device shard", async () => {
    seedV1Project("proj-A");
    initBareGit();

    const { migrateSyncLayout } = await import(
      "../../src/commands/sync-migrate"
    );
    const { getOrCreateDeviceId } = await import("../../src/core/device");

    const result = migrateSyncLayout();
    expect(result.ranMigration).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(2);

    const deviceId = getOrCreateDeviceId();
    const shardDir = join(mockRoot, "projects", "proj-A", "state", deviceId);

    // Files moved into shard
    expect(existsSync(join(shardDir, "token-ledger.json"))).toBe(true);
    expect(existsSync(join(shardDir, "bug-memory.json"))).toBe(true);
    expect(existsSync(join(shardDir, "action-log.md"))).toBe(true);

    // Legacy paths gone
    expect(existsSync(join(mockRoot, "projects", "proj-A", "token-ledger.json"))).toBe(false);

    // Canonical learning memory stays put + sidecar created
    expect(existsSync(join(mockRoot, "projects", "proj-A", "learning-memory.md"))).toBe(true);
    expect(
      existsSync(join(mockRoot, "projects", "proj-A", `learning-memory.${deviceId}.md`))
    ).toBe(true);

    // Counters split out of file-index header
    const counters = JSON.parse(
      readFileSync(
        join(mockRoot, "projects", "proj-A", ".mink-state-counters.json"),
        "utf-8"
      )
    );
    expect(counters.fileIndexHits).toBe(42);
    expect(counters.fileIndexMisses).toBe(7);
    const idx = JSON.parse(
      readFileSync(join(mockRoot, "projects", "proj-A", "file-index.json"), "utf-8")
    );
    expect(idx.header.lifetimeHits).toBe(0);
    expect(idx.header.lifetimeMisses).toBe(0);

    // Version bumped
    expect(
      readFileSync(join(mockRoot, ".mink-sync-version"), "utf-8").trim()
    ).toBe("2");
  });

  test("re-running is a no-op", async () => {
    seedV1Project("proj-A");
    initBareGit();

    const { migrateSyncLayout } = await import(
      "../../src/commands/sync-migrate"
    );

    migrateSyncLayout();
    const second = migrateSyncLayout();
    expect(second.ranMigration).toBe(false);
    expect(second.message).toContain("already at v2");
  });

  test("migrates aggregator-readable state — pre-migration reads still work", async () => {
    seedV1Project("proj-A");
    initBareGit();

    const projDir = join(mockRoot, "projects", "proj-A");

    // Aggregator sees legacy data BEFORE migration.
    const { aggregateTokenLedgerAt, aggregateBugMemoryAt } = await import(
      "../../src/core/state-aggregator"
    );
    const before = aggregateTokenLedgerAt(projDir);
    expect(before.lifetime.totalTokens).toBe(5000);
    expect(aggregateBugMemoryAt(projDir).entries.length).toBe(1);

    const { migrateSyncLayout } = await import(
      "../../src/commands/sync-migrate"
    );
    migrateSyncLayout();

    // Aggregator sees the same data AFTER migration (now from shard).
    const after = aggregateTokenLedgerAt(projDir);
    expect(after.lifetime.totalTokens).toBe(5000);
    expect(aggregateBugMemoryAt(projDir).entries.length).toBe(1);
  });
});
