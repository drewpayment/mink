// End-to-end guard for the SQLite-over-git sync corruption fix. Drives the
// real syncPush() against a bare git remote and asserts:
//   1. a structurally corrupt mink.db is NEVER committed/pushed (so corruption
//      can't fan out to every other device), while
//   2. a healthy mink.db in the same project tree pushes normally.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

import { openDriver } from "../../src/storage/driver";
import { applySchema } from "../../src/storage/schema";
import { saveGlobalConfig } from "../../src/core/global-config";
import { ensureGitignore, ensureGitAttributes, syncPush } from "../../src/core/sync";

let mockRoot: string;
let remote: string;

function git(args: string, cwd: string): string {
  return execSync(`git ${args}`, { cwd, stdio: ["pipe", "pipe", "pipe"] })
    .toString()
    .trim();
}

function writeHealthyDb(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  const db = openDriver(path);
  db.exec("PRAGMA journal_mode = WAL");
  applySchema(db);
  db.prepare(
    "INSERT INTO file_index (file_path, description, estimated_tokens, last_modified, last_indexed, mtime_ms, device_id) VALUES (?,?,?,?,?,?,?)"
  ).run("src/a.ts", "d", 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", 1, "dev");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

beforeEach(() => {
  mockRoot = mkdtempSync(join(tmpdir(), "mink-db-corrupt-test-"));
  process.env.MINK_ROOT_OVERRIDE = mockRoot;

  // Bare remote to push into.
  remote = mkdtempSync(join(tmpdir(), "mink-db-corrupt-remote-"));
  git("init --bare", remote);

  // Seed an initial healthy project DB and stand up the sync repo by hand
  // (local git identity, remote, initial commit/push) so we don't depend on a
  // global git config in CI.
  writeHealthyDb(join(mockRoot, "projects", "proj-A", "mink.db"));
  ensureGitignore();
  ensureGitAttributes();
  git("init", mockRoot);
  git('config user.email "test@example.com"', mockRoot);
  git('config user.name "Test"', mockRoot);
  git(`remote add origin "${remote}"`, mockRoot);
  git("add -A", mockRoot);
  git('commit -m "initial"', mockRoot);
  git("branch -M main", mockRoot);
  git("push -u origin main", mockRoot);

  saveGlobalConfig({
    "sync.enabled": "true",
    "sync.remote-url": remote,
  } as never);
});

afterEach(() => {
  delete process.env.MINK_ROOT_OVERRIDE;
  rmSync(mockRoot, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
});

describe("syncPush corruption guard", () => {
  test("a corrupt project DB is kept out of the commit; healthy ones still push", () => {
    // proj-A already healthy from init. Add a second healthy project and a
    // corrupt one, then push.
    writeHealthyDb(join(mockRoot, "projects", "proj-B", "mink.db"));

    const corruptPath = join(mockRoot, "projects", "proj-bad", "mink.db");
    mkdirSync(join(mockRoot, "projects", "proj-bad"), { recursive: true });
    writeFileSync(
      corruptPath,
      Buffer.concat([Buffer.from("SQLite format 3 "), Buffer.alloc(4096, 0xff)])
    );

    const messages: string[] = [];
    syncPush((m) => messages.push(m));

    // The corrupt DB must not be tracked in the remote's HEAD tree.
    const tracked = git("ls-tree -r --name-only HEAD", mockRoot).split("\n");
    expect(tracked).toContain("projects/proj-B/mink.db");
    expect(tracked).not.toContain("projects/proj-bad/mink.db");

    // And the user is told why.
    expect(messages.some((m) => m.includes("proj-bad/mink.db"))).toBe(true);

    // The corrupt file is left on disk for manual recovery — not silently
    // deleted.
    expect(existsSync(corruptPath)).toBe(true);
  });
});
