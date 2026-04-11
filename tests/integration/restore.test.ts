import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { projectDir } from "../../src/core/paths";
import { createBackup, listBackups, restoreBackup } from "../../src/core/backup";

function createTempProject(): string {
  const name = `mink-restore-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("restore integration", () => {
  let testCwd: string;

  beforeEach(() => {
    testCwd = createTempProject();
    const stateDir = projectDir(testCwd);
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "file-index.json"), '{"version":"original"}');
    writeFileSync(join(stateDir, "learning-memory.md"), "# Original");
  });

  afterEach(() => {
    rmSync(testCwd, { recursive: true, force: true });
    try {
      rmSync(projectDir(testCwd), { recursive: true, force: true });
    } catch {}
  });

  test("full backup and restore round-trip", () => {
    // Create backup of original state
    const backupName = createBackup(testCwd);

    // Modify state
    const stateDir = projectDir(testCwd);
    writeFileSync(join(stateDir, "file-index.json"), '{"version":"modified"}');
    writeFileSync(join(stateDir, "learning-memory.md"), "# Modified");

    // Verify modification
    expect(
      readFileSync(join(stateDir, "file-index.json"), "utf-8")
    ).toContain("modified");

    // Restore
    restoreBackup(testCwd, backupName);

    // Verify original is back
    expect(
      readFileSync(join(stateDir, "file-index.json"), "utf-8")
    ).toContain("original");
    expect(
      readFileSync(join(stateDir, "learning-memory.md"), "utf-8")
    ).toContain("Original");
  });

  test("list backups shows available backups", () => {
    const name1 = createBackup(testCwd);
    const name2 = createBackup(testCwd);

    const backups = listBackups(testCwd);
    expect(backups.length).toBeGreaterThanOrEqual(2);

    const names = backups.map((b) => b.name);
    expect(names).toContain(name1);
    expect(names).toContain(name2);
  });

  test("restore nonexistent backup fails", () => {
    expect(() => restoreBackup(testCwd, "backup-doesnotexist")).toThrow();
  });
});
