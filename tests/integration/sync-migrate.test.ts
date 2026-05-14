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

  // Regression: with sync initialised, migrateSyncLayout stashes uncommitted
  // edits before running so the migration commit stays clean. If the user has
  // an uncommitted `projects.identity=git-remote` write in ~/.mink/config, the
  // stash temporarily reverts the working tree to the committed config (which
  // doesn't have the key). Reading the flag inside the stash window then
  // returns "path-derived" (the default), the identity migration no-ops, and
  // the user reports "I set the flag and migrate but nothing happens." The
  // fix: snapshot the identity mode BEFORE the stash and thread it through
  // planIdentityMigration / migrateProjectIdentities / resolveProjectIdentity
  // so all downstream decisions agree with the caller's intent.
  test("renames when projects.identity was set but not yet committed", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "mink-v3-stash-bug-"));
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

      // Commit ~/.mink with the original config (no projects.identity) so the
      // stash has a meaningful "last committed" version to revert to.
      const configPath = join(mockRoot, "config");
      writeFileSync(configPath, JSON.stringify({ "sync.enabled": "true" }));
      execSync(`git init -q "${mockRoot}"`);
      execSync(`git -C "${mockRoot}" config user.email "t@t"`);
      execSync(`git -C "${mockRoot}" config user.name "t"`);
      execSync(`git -C "${mockRoot}" add -A`);
      execSync(`git -C "${mockRoot}" commit -q -m initial`);

      // Now write projects.identity=git-remote into the working tree but DO
      // NOT commit it. This is exactly what `mink config projects.identity
      // git-remote` produces: a dirty config file.
      writeFileSync(
        configPath,
        JSON.stringify({
          "sync.enabled": "true",
          "projects.identity": "git-remote",
        })
      );

      const { migrateSyncLayout } = await import(
        "../../src/commands/sync-migrate"
      );
      const result = migrateSyncLayout();
      expect(result.ranMigration).toBe(true);

      // The bug: pre-fix, the dir would NOT be renamed because the migration
      // re-read the (stashed) config and saw path-derived → newId === oldId.
      const { resolveProjectIdentity } = await import(
        "../../src/core/project-id"
      );
      const newId = resolveProjectIdentity(cwd, "git-remote").id;
      expect(newId).not.toBe(oldId);
      expect(existsSync(join(mockRoot, "projects", newId))).toBe(true);
      expect(existsSync(projDir)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("identity migration safety: dry-run, backup, rollback", () => {
  function seedRenameableProject(): { cwd: string; oldId: string } {
    const cwd = mkdtempSync(join(tmpdir(), "mink-safety-"));
    execSync(`git init -q "${cwd}"`);
    execSync(`git -C "${cwd}" remote add origin git@github.com:owner/repo.git`);

    // Compute the path-derived id and seed the project at that location.
    const oldId = require("../../src/core/project-id").generateProjectId(cwd);
    const projDir = join(mockRoot, "projects", oldId);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(
      join(projDir, "project-meta.json"),
      JSON.stringify({ cwd, name: "repo", initTimestamp: "x", version: "0.1.0" })
    );
    writeFileSync(join(projDir, "marker.txt"), "before migration");
    return { cwd, oldId };
  }

  test("--dry-run prints the rename plan without touching disk", async () => {
    const { cwd, oldId } = seedRenameableProject();
    try {
      process.env.MINK_PROJECTS_IDENTITY = "git-remote";
      try {
        const { planIdentityMigration } = await import(
          "../../src/commands/sync-migrate"
        );
        const plan = planIdentityMigration();
        expect(plan.length).toBe(1);
        expect(plan[0].action).toBe("rename");
        expect(plan[0].oldId).toBe(oldId);
        expect(plan[0].newId).not.toBe(oldId);

        // Disk untouched
        expect(existsSync(join(mockRoot, "projects", oldId))).toBe(true);
        expect(
          existsSync(join(mockRoot, "projects", plan[0].newId!))
        ).toBe(false);
      } finally {
        delete process.env.MINK_PROJECTS_IDENTITY;
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("migration writes a per-project backup under .identity-rollback before renaming", async () => {
    const { cwd, oldId } = seedRenameableProject();
    try {
      process.env.MINK_PROJECTS_IDENTITY = "git-remote";
      try {
        const { migrateSyncLayout } = await import(
          "../../src/commands/sync-migrate"
        );
        migrateSyncLayout();

        const backupRoot = join(mockRoot, ".identity-rollback");
        expect(existsSync(backupRoot)).toBe(true);
        const stamps = require("fs").readdirSync(backupRoot);
        expect(stamps.length).toBeGreaterThanOrEqual(1);
        const snapshot = join(backupRoot, stamps[0], oldId);
        expect(existsSync(join(snapshot, "marker.txt"))).toBe(true);
        expect(
          require("fs")
            .readFileSync(join(snapshot, "marker.txt"), "utf-8")
            .toString()
        ).toBe("before migration");
      } finally {
        delete process.env.MINK_PROJECTS_IDENTITY;
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("--rollback renames back, pops the alias, leaves the project usable", async () => {
    const { cwd, oldId } = seedRenameableProject();
    try {
      process.env.MINK_PROJECTS_IDENTITY = "git-remote";
      try {
        const { migrateSyncLayout, rollbackProjectIdentities, planIdentityMigration } =
          await import("../../src/commands/sync-migrate");

        const plan = planIdentityMigration();
        const newId = plan[0].newId!;

        migrateSyncLayout();
        expect(existsSync(join(mockRoot, "projects", newId))).toBe(true);
        expect(existsSync(join(mockRoot, "projects", oldId))).toBe(false);

        const results = rollbackProjectIdentities();
        const ok = results.filter((r) => r.ok);
        expect(ok.length).toBe(1);
        expect(ok[0].currentId).toBe(newId);
        expect(ok[0].restoredId).toBe(oldId);

        // After rollback: original dir name restored, marker preserved, alias gone.
        expect(existsSync(join(mockRoot, "projects", oldId))).toBe(true);
        expect(existsSync(join(mockRoot, "projects", newId))).toBe(false);
        expect(
          require("fs")
            .readFileSync(
              join(mockRoot, "projects", oldId, "marker.txt"),
              "utf-8"
            )
            .toString()
        ).toBe("before migration");
        const meta = JSON.parse(
          require("fs")
            .readFileSync(
              join(mockRoot, "projects", oldId, "project-meta.json"),
              "utf-8"
            )
            .toString()
        );
        expect(meta.aliases ?? []).toEqual([]);
      } finally {
        delete process.env.MINK_PROJECTS_IDENTITY;
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  test("--rollback is a no-op when nothing has aliases", async () => {
    const { rollbackProjectIdentities } = await import(
      "../../src/commands/sync-migrate"
    );
    const results = rollbackProjectIdentities();
    expect(results.length).toBe(0);
  });
});
