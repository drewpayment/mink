import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { safeReadJson } from "../../src/core/fs-utils";
import { buildHooksConfig, mergeHooksIntoSettings, writeMinkRule, init } from "../../src/commands/init";
import { learningMemoryPath } from "../../src/core/paths";

describe("buildHooksConfig", () => {
  test("uses bun when bun is the detected runtime", () => {
    const hooks = buildHooksConfig("bun", "/usr/local/bin/mink/cli.js");
    expect(hooks.SessionStart[0].hooks[0].command).toContain("bun run");
    expect(hooks.Stop[0].hooks[0].command).toContain("bun run");
  });

  test("uses node when node is the detected runtime", () => {
    const hooks = buildHooksConfig("node", "/usr/local/bin/mink/cli.js");
    expect(hooks.SessionStart[0].hooks[0].command).toContain("node ");
    expect(hooks.Stop[0].hooks[0].command).toContain("node ");
  });

  test("includes correct commands", () => {
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    expect(hooks.SessionStart[0].hooks[0].command).toContain("session-start");
    expect(hooks.Stop[0].hooks[0].command).toContain("session-stop");
  });

  test("each hook entry has correct structure with type and command", () => {
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    for (const entries of Object.values(hooks)) {
      for (const entry of entries) {
        expect(entry.matcher).toBeDefined();
        expect(Array.isArray(entry.hooks)).toBe(true);
        for (const h of entry.hooks) {
          expect(h.type).toBe("command");
          expect(typeof h.command).toBe("string");
        }
      }
    }
  });

  test("includes PreToolUse and PostToolUse hooks for Read", () => {
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    expect(hooks.PreToolUse).toBeDefined();
    expect(hooks.PreToolUse[0].matcher).toBe("Read");
    expect(hooks.PreToolUse[0].hooks[0].command).toContain("pre-read");
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.PostToolUse[0].matcher).toBe("Read");
    expect(hooks.PostToolUse[0].hooks[0].command).toContain("post-read");
  });

  test("uses correct runtime prefix for read hooks", () => {
    const bunHooks = buildHooksConfig("bun", "/path/to/cli.js");
    expect(bunHooks.PreToolUse[0].hooks[0].command).toContain("bun run");
    expect(bunHooks.PostToolUse[0].hooks[0].command).toContain("bun run");

    const nodeHooks = buildHooksConfig("node", "/path/to/cli.js");
    expect(nodeHooks.PreToolUse[0].hooks[0].command).toContain("node ");
    expect(nodeHooks.PostToolUse[0].hooks[0].command).toContain("node ");
  });

  test("includes Edit and Write matchers for pre-write and post-write", () => {
    const hooks = buildHooksConfig("bun", "/path/to/cli.js");

    // PreToolUse: Read (pre-read) + Edit (pre-write) + Write (pre-write)
    expect(hooks.PreToolUse).toHaveLength(3);
    expect(hooks.PreToolUse[1].matcher).toBe("Edit");
    expect(hooks.PreToolUse[1].hooks[0].command).toContain("pre-write");
    expect(hooks.PreToolUse[2].matcher).toBe("Write");
    expect(hooks.PreToolUse[2].hooks[0].command).toContain("pre-write");

    // PostToolUse: Read (post-read) + Edit (post-write) + Write (post-write)
    expect(hooks.PostToolUse).toHaveLength(3);
    expect(hooks.PostToolUse[1].matcher).toBe("Edit");
    expect(hooks.PostToolUse[1].hooks[0].command).toContain("post-write");
    expect(hooks.PostToolUse[2].matcher).toBe("Write");
    expect(hooks.PostToolUse[2].hooks[0].command).toContain("post-write");
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
          PreToolUse: [{ matcher: "", hooks: [{ type: "command", command: "existing-hook" }] }],
        },
        otherSetting: true,
      })
    );

    const hooks = buildHooksConfig("bun", "/path/to/cli.js");
    mergeHooksIntoSettings(settingsPath, hooks);

    const settings = safeReadJson(settingsPath) as Record<string, unknown>;
    const allHooks = settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>;
    // Non-mink hook preserved + 3 mink hooks added (Read, Edit, Write)
    expect(allHooks.PreToolUse).toHaveLength(4);
    expect(allHooks.PreToolUse.some((e) => e.hooks[0].command === "existing-hook")).toBe(true);
    expect(allHooks.PreToolUse.some((e) => e.hooks[0].command.includes("pre-read"))).toBe(true);
    expect(allHooks.PreToolUse.some((e) => e.hooks[0].command.includes("pre-write"))).toBe(true);
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
            { matcher: "", hooks: [{ type: "command", command: "bun run /old/path/cli.js session-start" }] },
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
    const allHooks = settings.hooks as Record<string, Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }>>;

    expect(allHooks.SessionStart).toHaveLength(1);
    expect(allHooks.SessionStart[0].hooks[0].command).toContain("/new/path/cli.js");

    // PreToolUse: 3 entries (Read, Edit, Write) — all replaced with new path
    expect(allHooks.PreToolUse).toHaveLength(3);
    expect(allHooks.PreToolUse.every((e) => e.hooks[0].command.includes("/new/path/cli.js"))).toBe(true);
    expect(allHooks.PreToolUse.some((e) => e.hooks[0].command.includes("pre-read"))).toBe(true);
    expect(allHooks.PreToolUse.some((e) => e.hooks[0].command.includes("pre-write"))).toBe(true);

    // PostToolUse: 3 entries (Read, Edit, Write)
    expect(allHooks.PostToolUse).toHaveLength(3);
    expect(allHooks.PostToolUse.every((e) => e.hooks[0].command.includes("/new/path/cli.js"))).toBe(true);
    expect(allHooks.PostToolUse.some((e) => e.hooks[0].command.includes("post-read"))).toBe(true);
    expect(allHooks.PostToolUse.some((e) => e.hooks[0].command.includes("post-write"))).toBe(true);
  });
});

describe("writeMinkRule", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-rule-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes .claude/rules/mink.md with the expected rule content", () => {
    const path = writeMinkRule(dir);
    expect(path).toBe(join(dir, ".claude", "rules", "mink.md"));
    expect(existsSync(path)).toBe(true);
    const content = readFileSync(path, "utf-8");
    expect(content).toContain("description: Mink context management");
    expect(content).toContain("@drewpayment/mink");
    expect(content).toContain("`.claude/settings.json`");
    expect(content).toContain("mink-note");
  });

  test("creates the .claude/rules directory if missing", () => {
    expect(existsSync(join(dir, ".claude", "rules"))).toBe(false);
    writeMinkRule(dir);
    expect(existsSync(join(dir, ".claude", "rules"))).toBe(true);
  });

  test("overwrites an existing mink.md so the rule stays current", () => {
    const path = join(dir, ".claude", "rules", "mink.md");
    mkdirSync(join(dir, ".claude", "rules"), { recursive: true });
    writeFileSync(path, "stale content");
    writeMinkRule(dir);
    const content = readFileSync(path, "utf-8");
    expect(content).not.toContain("stale content");
    expect(content).toContain("Mink");
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

  test("writes .claude/rules/mink.md as part of init", async () => {
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify({ name: "rule-init-project" })
    );

    await init(projectDir);

    const rulePath = join(projectDir, ".claude", "rules", "mink.md");
    expect(existsSync(rulePath)).toBe(true);
    const content = readFileSync(rulePath, "utf-8");
    expect(content).toContain("Mink");
    expect(content).toContain("@drewpayment/mink");
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
