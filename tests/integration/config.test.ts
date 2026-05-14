import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync } from "fs";
import {
  loadGlobalConfig,
  saveGlobalConfig,
  resolveConfigValue,
  resolveAllConfig,
  setConfigValue,
  resetConfigKey,
  resetAllConfig,
} from "../../src/core/global-config";
import { globalConfigPath, localConfigPath } from "../../src/core/paths";
import { CONFIG_KEYS } from "../../src/types/config";

describe("config integration", () => {
  let savedConfig: string | null = null;
  let savedLocalConfig: string | null = null;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save existing config files
    try {
      savedConfig = readFileSync(globalConfigPath(), "utf-8");
    } catch {
      savedConfig = null;
    }
    try {
      savedLocalConfig = readFileSync(localConfigPath(), "utf-8");
    } catch {
      savedLocalConfig = null;
    }
    // Clear env vars
    for (const meta of CONFIG_KEYS) {
      originalEnv[meta.envVar] = process.env[meta.envVar];
      delete process.env[meta.envVar];
    }
    // Start with clean config
    resetAllConfig();
  });

  afterEach(() => {
    const { mkdirSync, writeFileSync } = require("fs");
    const { dirname } = require("path");
    // Restore original shared config
    if (savedConfig !== null) {
      mkdirSync(dirname(globalConfigPath()), { recursive: true });
      writeFileSync(globalConfigPath(), savedConfig);
    } else {
      try {
        rmSync(globalConfigPath(), { force: true });
      } catch {}
    }
    // Restore original local config
    if (savedLocalConfig !== null) {
      mkdirSync(dirname(localConfigPath()), { recursive: true });
      writeFileSync(localConfigPath(), savedLocalConfig);
    } else {
      try {
        rmSync(localConfigPath(), { force: true });
      } catch {}
    }
    // Restore env vars
    for (const meta of CONFIG_KEYS) {
      if (originalEnv[meta.envVar] === undefined) {
        delete process.env[meta.envVar];
      } else {
        process.env[meta.envVar] = originalEnv[meta.envVar];
      }
    }
  });

  test("set and get wiki.path", () => {
    setConfigValue("wiki.path", "/custom/wiki");
    const result = resolveConfigValue("wiki.path");
    expect(result.value).toBe("/custom/wiki");
    expect(result.source).toBe("config file");
  });

  test("reset key reverts to default", () => {
    setConfigValue("wiki.path", "/custom/wiki");
    resetConfigKey("wiki.path");
    const result = resolveConfigValue("wiki.path");
    expect(result.value).toBe("~/.mink/wiki");
    expect(result.source).toBe("default");
  });

  test("env var overrides config file", () => {
    setConfigValue("wiki.path", "/config/wiki");
    process.env.MINK_WIKI_PATH = "/env/wiki";
    const result = resolveConfigValue("wiki.path");
    expect(result.value).toBe("/env/wiki");
    expect(result.source).toBe("environment variable");
    expect(result.configFileValue).toBe("/config/wiki");
  });

  test("resolveAllConfig shows all settings with defaults", () => {
    const all = resolveAllConfig();
    expect(all.length).toBe(19);
    const byKey = Object.fromEntries(all.map((a) => [a.key, a]));
    expect(byKey["wiki.path"].source).toBe("default");
    expect(byKey["wiki.enabled"].value).toBe("true");
    expect(byKey["wiki.sync-mode"].value).toBe("immediate");
    expect(byKey["wiki.git-backup"].value).toBe("false");
    expect(byKey["wiki.git-remote"].value).toBe("origin");
  });

  test("resetAllConfig clears all values", () => {
    setConfigValue("wiki.path", "/a");
    setConfigValue("wiki.enabled", "false");
    resetAllConfig();
    const config = loadGlobalConfig();
    expect(Object.keys(config).length).toBe(0);
    const result = resolveConfigValue("wiki.path");
    expect(result.source).toBe("default");
  });

  test("loadGlobalConfig handles corrupt file", () => {
    const { mkdirSync, writeFileSync } = require("fs");
    const { dirname } = require("path");
    mkdirSync(dirname(globalConfigPath()), { recursive: true });
    writeFileSync(globalConfigPath(), "not valid json{{{");

    const config = loadGlobalConfig();
    expect(Object.keys(config).length).toBe(0);
  });

  test("config file created automatically on set (shared key)", () => {
    try {
      rmSync(globalConfigPath(), { force: true });
    } catch {}

    setConfigValue("wiki.enabled", "false");
    expect(existsSync(globalConfigPath())).toBe(true);
    const result = resolveConfigValue("wiki.enabled");
    expect(result.value).toBe("false");
  });

  test("local config file created automatically on set (local key)", () => {
    try {
      rmSync(localConfigPath(), { force: true });
    } catch {}

    setConfigValue("wiki.path", "/new/path");
    expect(existsSync(localConfigPath())).toBe(true);
    const result = resolveConfigValue("wiki.path");
    expect(result.value).toBe("/new/path");
  });
});
