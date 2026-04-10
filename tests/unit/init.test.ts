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

  test("includes PreToolUse and PostToolUse hooks for Read", () => {
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PreToolUse[0].matcher).toBe("Read");
    expect(hooks.PreToolUse[0].command).toContain("pre-read");
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.PostToolUse[0].matcher).toBe("Read");
    expect(hooks.PostToolUse[0].command).toContain("post-read");
  });

  test("uses correct runtime prefix for read hooks", () => {
    const bunHooks = buildHooksConfig("bun", "/path/to/cli.js");
    expect(bunHooks.PreToolUse[0].command).toContain("bun run");
    expect(bunHooks.PostToolUse[0].command).toContain("bun run");

    const nodeHooks = buildHooksConfig("node", "/path/to/cli.js");
    expect(nodeHooks.PreToolUse[0].command).toContain("node ");
    expect(nodeHooks.PostToolUse[0].command).toContain("node ");
  });

  test("includes Edit and Write matchers for pre-write and post-write", () => {
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");

    // PreToolUse: Read (pre-read) + Edit (pre-write) + Write (pre-write)
    expect(hooks.PreToolUse).toHaveLength(3);
    expect(hooks.PreToolUse[1].matcher).toBe("Edit");
    expect(hooks.PreToolUse[1].command).toContain("pre-write");
    expect(hooks.PreToolUse[2].matcher).toBe("Write");
    expect(hooks.PreToolUse[2].command).toContain("pre-write");

    // PostToolUse: Read (post-read) + Edit (post-write) + Write (post-write)
    expect(hooks.PostToolUse).toHaveLength(3);
    expect(hooks.PostToolUse[1].matcher).toBe("Edit");
    expect(hooks.PostToolUse[1].command).toContain("post-write");
    expect(hooks.PostToolUse[2].matcher).toBe("Write");
    expect(hooks.PostToolUse[2].command).toContain("post-write");
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

  test("merges hooks into existing settings without overwriting non-mink hooks", () => {
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
    const allHooks = settings.hooks as Record<string, Array<{ command: string }>>;
    // Non-mink hook preserved + 3 mink hooks added (Read, Edit, Write)
    expect(allHooks.PreToolUse).toHaveLength(4);
    expect(allHooks.PreToolUse.some((h) => h.command === "existing-hook")).toBe(true);
    expect(allHooks.PreToolUse.some((h) => h.command.includes("pre-read"))).toBe(true);
    expect(allHooks.PreToolUse.some((h) => h.command.includes("pre-write"))).toBe(true);
    expect(allHooks.SessionStart).toBeDefined();
    expect(allHooks.Stop).toBeDefined();
    expect(allHooks.PostToolUse).toBeDefined();
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
          PreToolUse: [
            { matcher: "Read", command: "bun run /old/path/cli.js pre-read" },
            { matcher: "Edit", command: "bun run /old/path/cli.js pre-write" },
            { matcher: "Write", command: "bun run /old/path/cli.js pre-write" },
          ],
          PostToolUse: [
            { matcher: "Read", command: "bun run /old/path/cli.js post-read" },
            { matcher: "Edit", command: "bun run /old/path/cli.js post-write" },
            { matcher: "Write", command: "bun run /old/path/cli.js post-write" },
          ],
        },
      })
    );

    const hooks = buildHooksConfig("bun", "/new/path/cli.js");
    mergeHooksIntoSettings(settingsPath, hooks);

    const settings = safeReadJson(settingsPath) as Record<string, unknown>;
    const allHooks = settings.hooks as Record<string, Array<{ command: string }>>;

    expect(allHooks.SessionStart).toHaveLength(1);
    expect(allHooks.SessionStart[0].command).toContain("/new/path/cli.js");

    // PreToolUse: 3 entries (Read, Edit, Write) — all replaced with new path
    expect(allHooks.PreToolUse).toHaveLength(3);
    expect(allHooks.PreToolUse.every((h) => h.command.includes("/new/path/cli.js"))).toBe(true);
    expect(allHooks.PreToolUse.some((h) => h.command.includes("pre-read"))).toBe(true);
    expect(allHooks.PreToolUse.some((h) => h.command.includes("pre-write"))).toBe(true);

    // PostToolUse: 3 entries (Read, Edit, Write)
    expect(allHooks.PostToolUse).toHaveLength(3);
    expect(allHooks.PostToolUse.every((h) => h.command.includes("/new/path/cli.js"))).toBe(true);
    expect(allHooks.PostToolUse.some((h) => h.command.includes("post-read"))).toBe(true);
    expect(allHooks.PostToolUse.some((h) => h.command.includes("post-write"))).toBe(true);
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
