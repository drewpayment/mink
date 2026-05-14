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
    expect(result.toVersion).toBeGreaterThanOrEqual(2);

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

    // Version bumped to the current sync version (>=2)
    const stamped = parseInt(
      readFileSync(join(mockRoot, ".mink-sync-version"), "utf-8").trim(),
      10
    );
    expect(stamped).toBeGreaterThanOrEqual(2);
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
    expect(second.message).toMatch(/already at v\d+/);
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

describe("sync v2 → v3 identity migration", () => {
  test("is a no-op when projects.identity is not git-remote", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mink-v3-noflag-"));
    try {
      execSync(`git init -q "${cwd}"`);
      execSync(`git -C "${cwd}" remote add origin git@github.com:owner/repo.git`);

      const { generateProjectId } = await import("../../src/core/project-id");
      const oldId = generateProjectId(cwd);
      const projDir = join(mockRoot, "projects", oldId);
      mkdirSync(projDir, { recursive: true });
      writeFileSync(
        join(projDir, "project-meta.json"),
        JSON.stringify({ cwd, name: "repo", initTimestamp: "x", version: "0.1.0" })
      );

      delete process.env.MINK_PROJECTS_IDENTITY;
      const { migrateSyncLayout } = await import(
        "../../src/commands/sync-migrate"
      );
      migrateSyncLayout();

      // Directory unchanged because the flag was not set.
      expect(existsSync(projDir)).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("renames project directory and records the prior id as an alias", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mink-v3-rename-"));
    try {
      execSync(`git init -q "${cwd}"`);
      execSync(`git -C "${cwd}" remote add origin git@github.com:owner/repo.git`);

      const { generateProjectId, resolveProjectIdentity } = await import(
        "../../src/core/project-id"
      );

      const oldId = generateProjectId(cwd);
      const projDir = join(mockRoot, "projects", oldId);
      mkdirSync(projDir, { recursive: true });
      writeFileSync(
        join(projDir, "project-meta.json"),
        JSON.stringify({ cwd, name: "repo", initTimestamp: "x", version: "0.1.0" })
      );

      process.env.MINK_PROJECTS_IDENTITY = "git-remote";
      try {
        const newId = resolveProjectIdentity(cwd).id;
        expect(newId).not.toBe(oldId);

        const { migrateSyncLayout } = await import(
          "../../src/commands/sync-migrate"
        );
        migrateSyncLayout();

        const newProjDir = join(mockRoot, "projects", newId);
        expect(existsSync(newProjDir)).toBe(true);
        expect(existsSync(projDir)).toBe(false);

        const raw = JSON.parse(
          readFileSync(join(newProjDir, "project-meta.json"), "utf-8")
        );
        expect(raw.aliases).toContain(oldId);
        expect(raw.pathsByDevice).toBeDefined();
        const pathValues = Object.values(raw.pathsByDevice) as string[];
        expect(pathValues).toContain(cwd);
      } finally {
        delete process.env.MINK_PROJECTS_IDENTITY;
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("is idempotent — re-running after a successful migration is a no-op", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mink-v3-idem-"));
    try {
      execSync(`git init -q "${cwd}"`);
      execSync(`git -C "${cwd}" remote add origin git@github.com:owner/repo.git`);

      const { generateProjectId } = await import("../../src/core/project-id");
      const oldId = generateProjectId(cwd);
      const projDir = join(mockRoot, "projects", oldId);
      mkdirSync(projDir, { recursive: true });
      writeFileSync(
        join(projDir, "project-meta.json"),
        JSON.stringify({ cwd, name: "repo", initTimestamp: "x", version: "0.1.0" })
      );

      process.env.MINK_PROJECTS_IDENTITY = "git-remote";
      try {
        const { migrateSyncLayout } = await import(
          "../../src/commands/sync-migrate"
        );
        migrateSyncLayout();
        // Second run finds nothing to rename — alias list does not gain a
        // duplicate, pathsByDevice does not corrupt.
        migrateSyncLayout();

        const { resolveProjectIdentity } = await import(
          "../../src/core/project-id"
        );
        const newId = resolveProjectIdentity(cwd).id;
        const raw = JSON.parse(
          readFileSync(
            join(mockRoot, "projects", newId, "project-meta.json"),
            "utf-8"
          )
        );
        const aliasCount = (raw.aliases ?? []).filter(
          (a: string) => a === oldId
        ).length;
        expect(aliasCount).toBe(1);
      } finally {
        delete process.env.MINK_PROJECTS_IDENTITY;
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("skips projects whose cwd does not exist on this device", async () => {
    process.env.MINK_PROJECTS_IDENTITY = "git-remote";
    try {
      const phantomId = "phantom-abc123";
      const projDir = join(mockRoot, "projects", phantomId);
      mkdirSync(projDir, { recursive: true });
      writeFileSync(
        join(projDir, "project-meta.json"),
        JSON.stringify({
          cwd: "/nonexistent/elsewhere",
          name: "phantom",
          initTimestamp: "x",
          version: "0.1.0",
        })
      );

      const { migrateSyncLayout } = await import(
        "../../src/commands/sync-migrate"
      );
      migrateSyncLayout();

      // Directory left alone — the device that owns the cwd will migrate it.
      expect(existsSync(projDir)).toBe(true);
    } finally {
      delete process.env.MINK_PROJECTS_IDENTITY;
    }
  });
});
