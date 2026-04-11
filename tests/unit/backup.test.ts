import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Since backup.ts uses projectDir(cwd) and backupDirPath(cwd) which hash the cwd,
// we test the internal helpers by creating a realistic project state directory.

import { createBackup, listBackups, restoreBackup } from "../../src/core/backup";
import { projectDir, backupDirPath } from "../../src/core/paths";

function createTempProject(): string {
  const name = `mink-backup-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("backup", () => {
  let testCwd: string;

  beforeEach(() => {
    testCwd = createTempProject();
    // Create a fake project state directory
    const stateDir = projectDir(testCwd);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "file-index.json"), '{"header":{},"entries":{}}');
    writeFileSync(join(stateDir, "token-ledger.json"), '{"lifetime":{},"sessions":[]}');
    writeFileSync(join(stateDir, "config.json"), "{}");
  });

  afterEach(() => {
    rmSync(testCwd, { recursive: true, force: true });
    // Clean up state dir
    try {
      rmSync(projectDir(testCwd), { recursive: true, force: true });
    } catch {}
  });

  test("createBackup copies files to backup directory", () => {
    const name = createBackup(testCwd);
    expect(name).toMatch(/^backup-\d{8}-\d{9}$/);

    const backupPath = join(backupDirPath(testCwd), name);
    expect(existsSync(backupPath)).toBe(true);
    expect(existsSync(join(backupPath, "file-index.json"))).toBe(true);
    expect(existsSync(join(backupPath, "token-ledger.json"))).toBe(true);
    expect(existsSync(join(backupPath, "config.json"))).toBe(true);
  });

  test("createBackup excludes backups/ subdirectory", () => {
    // Create first backup
    createBackup(testCwd);
    // Create second backup — should NOT contain the backups/ dir from first
    const name2 = createBackup(testCwd);
    const backupPath = join(backupDirPath(testCwd), name2);
    expect(existsSync(join(backupPath, "backups"))).toBe(false);
  });

  test("listBackups returns sorted backups", () => {
    createBackup(testCwd);
    // Slight delay to get different timestamp
    const name2 = createBackup(testCwd);

    const backups = listBackups(testCwd);
    expect(backups.length).toBeGreaterThanOrEqual(2);
    // Most recent should be first
    expect(backups[0].name).toBe(name2);
  });

  test("listBackups returns empty for no backups", () => {
    const freshCwd = createTempProject();
    const stateDir = projectDir(freshCwd);
    mkdirSync(stateDir, { recursive: true });

    const backups = listBackups(freshCwd);
    expect(backups.length).toBe(0);

    rmSync(freshCwd, { recursive: true, force: true });
    try { rmSync(stateDir, { recursive: true, force: true }); } catch {}
  });

  test("restoreBackup restores files", () => {
    const name = createBackup(testCwd);

    // Modify the current state
    const stateDir = projectDir(testCwd);
    writeFileSync(join(stateDir, "file-index.json"), '{"modified":true}');

    // Restore
    restoreBackup(testCwd, name);

    // Verify original content is back
    const content = readFileSync(join(stateDir, "file-index.json"), "utf-8");
    expect(content).toBe('{"header":{},"entries":{}}');
  });

  test("restoreBackup throws for nonexistent backup", () => {
    expect(() => restoreBackup(testCwd, "backup-nonexistent")).toThrow(
      "backup not found"
    );
  });

  test("restoreBackup creates safety backup before restoring", () => {
    const name = createBackup(testCwd);

    // Modify state
    writeFileSync(
      join(projectDir(testCwd), "file-index.json"),
      '{"modified":true}'
    );

    restoreBackup(testCwd, name);

    // Should now have at least 2 backups (original + safety)
    const backups = listBackups(testCwd);
    expect(backups.length).toBeGreaterThanOrEqual(2);
  });
});
