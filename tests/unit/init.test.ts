import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { safeReadJson } from "../../src/core/fs-utils";
import { buildHooksConfig, mergeHooksIntoSettings, init } from "../../src/commands/init";
import { learningMemoryPath } from "../../src/core/paths";

describe("buildHooksConfig", () => {
  test("uses bun when bun is the detected runtime", () => {
    const hooks = buildHooksConfig("bun", "/usr/local/bin/mink/cli.js");
    expect(hooks.SessionStart[0].command).toContain("bun run");
    expect(hooks.Stop[0].command).toContain("bun run");
  });

  test("uses node when node is the detected runtime", () => {
    const hooks = buildHooksConfig("node", "/usr/local/bin/mink/cli.js");
    expect(hooks.SessionStart[0].command).toContain("node ");
    expect(hooks.Stop[0].command).toContain("node ");
  });

  test("includes correct commands", () => {
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    expect(hooks.SessionStart[0].command).toContain("session-start");
    expect(hooks.Stop[0].command).toContain("session-stop");
  });
});

describe("mergeHooksIntoSettings", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates settings.json if it does not exist", () => {
    const settingsDir = join(dir, ".claude");
    const settingsPath = join(settingsDir, "settings.json");
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");

    mergeHooksIntoSettings(settingsPath, hooks);

    const settings = safeReadJson(settingsPath) as Record<string, unknown>;
    expect(settings).not.toBeNull();
    expect(settings.hooks).toBeDefined();
  });

  test("merges hooks into existing settings without overwriting", () => {
    const settingsDir = join(dir, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "", command: "existing-hook" }],
        },
        otherSetting: true,
      })
    );

    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    mergeHooksIntoSettings(settingsPath, hooks);

    const settings = safeReadJson(settingsPath) as Record<string, unknown>;
    const allHooks = settings.hooks as Record<string, unknown[]>;
    expect(allHooks.PreToolUse).toHaveLength(1);
    expect(allHooks.SessionStart).toBeDefined();
    expect(allHooks.Stop).toBeDefined();
    expect(settings.otherSetting).toBe(true);
  });

  test("replaces existing mink hooks on re-init", () => {
    const settingsDir = join(dir, ".claude");
    mkdirSync(settingsDir, { recursive: true });
    const settingsPath = join(settingsDir, "settings.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [
            { matcher: "", command: "bun run /old/path/cli.js session-start" },
          ],
        },
      })
    );

    const hooks = buildHooksConfig("bun", "/new/path/cli.js");
    mergeHooksIntoSettings(settingsPath, hooks);

    const settings = safeReadJson(settingsPath) as Record<string, unknown>;
    const allHooks = settings.hooks as Record<string, Array<{ command: string }>>;
    const sessionStartHooks = allHooks.SessionStart;
    expect(sessionStartHooks).toHaveLength(1);
    expect(sessionStartHooks[0].command).toContain("/new/path/cli.js");
  });
});

describe("init", () => {
  let projectDir: string;
  let memPath: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "mink-init-test-"));
    memPath = learningMemoryPath(projectDir);
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    // Clean up the mink project dir created by init
    if (existsSync(memPath)) {
      const minkProjDir = join(memPath, "..");
      rmSync(minkProjDir, { recursive: true, force: true });
    }
  });

  test("seeds learning-memory.md on init", async () => {
    // Create a package.json so seed can detect project name and frameworks
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({
        name: "my-test-project",
        dependencies: { react: "^18.0.0", typescript: "^5.0.0" },
      })
    );

    await init(projectDir);

    expect(existsSync(memPath)).toBe(true);
    const content = readFileSync(memPath, "utf-8");
    expect(content).toContain("my-test-project");
    expect(content).toContain("React");
    expect(content).toContain("TypeScript");
  });

  test("does not overwrite existing learning-memory.md on re-init", async () => {
    const minkProjDir = join(memPath, "..");
    mkdirSync(minkProjDir, { recursive: true });
    writeFileSync(memPath, "# Existing Memory\n\nCustom content");

    await init(projectDir);

    const content = readFileSync(memPath, "utf-8");
    expect(content).toContain("Custom content");
  });
});
