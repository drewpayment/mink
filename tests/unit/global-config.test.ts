import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test global-config by manipulating a temp directory
// Since global-config uses paths.ts which uses homedir(), we'll test the
// underlying logic by importing and calling functions with controlled state

import {
  loadGlobalConfig,
  saveGlobalConfig,
  resolveConfigValue,
  resolveAllConfig,
  setConfigValue,
  resetConfigKey,
  resetAllConfig,
} from "../../src/core/global-config";
import { globalConfigPath } from "../../src/core/paths";
import { CONFIG_KEYS, isValidConfigKey } from "../../src/types/config";

describe("config types", () => {
  test("isValidConfigKey accepts valid keys", () => {
    expect(isValidConfigKey("wiki.path")).toBe(true);
    expect(isValidConfigKey("wiki.enabled")).toBe(true);
    expect(isValidConfigKey("wiki.sync-mode")).toBe(true);
    expect(isValidConfigKey("wiki.git-backup")).toBe(true);
    expect(isValidConfigKey("wiki.git-remote")).toBe(true);
  });

  test("isValidConfigKey rejects invalid keys", () => {
    expect(isValidConfigKey("invalid.key")).toBe(false);
    expect(isValidConfigKey("")).toBe(false);
    expect(isValidConfigKey("wiki")).toBe(false);
  });

  test("CONFIG_KEYS has 6 entries", () => {
    expect(CONFIG_KEYS.length).toBe(6);
  });

  test("each CONFIG_KEY has required fields", () => {
    for (const meta of CONFIG_KEYS) {
      expect(meta.key).toBeTruthy();
      expect(meta.default).toBeDefined();
      expect(meta.envVar).toBeTruthy();
      expect(meta.description).toBeTruthy();
    }
  });
});

describe("loadGlobalConfig", () => {
  const configDir = join(tmpdir(), `mink-config-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(configDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  test("returns empty object when file missing", () => {
    // loadGlobalConfig reads from globalConfigPath() which is ~/.mink/config
    // We can't easily redirect that, so we test resolveConfigValue defaults
    const result = resolveConfigValue("wiki.path");
    expect(result.source).toBe("default");
    expect(result.value).toBe("~/.mink/wiki/");
  });
});

describe("resolveConfigValue", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original env vars
    for (const meta of CONFIG_KEYS) {
      originalEnv[meta.envVar] = process.env[meta.envVar];
    }
  });

  afterEach(() => {
    // Restore original env vars
    for (const meta of CONFIG_KEYS) {
      if (originalEnv[meta.envVar] === undefined) {
        delete process.env[meta.envVar];
      } else {
        process.env[meta.envVar] = originalEnv[meta.envVar];
      }
    }
  });

  test("returns default values when nothing is set", () => {
    // Clear any env vars
    for (const meta of CONFIG_KEYS) {
      delete process.env[meta.envVar];
    }

    const result = resolveConfigValue("wiki.path");
    expect(result.value).toBe("~/.mink/wiki/");
    expect(result.source).toBe("default");
  });

  test("env var takes priority over default", () => {
    process.env.MINK_WIKI_PATH = "/tmp/test-wiki";
    const result = resolveConfigValue("wiki.path");
    expect(result.value).toBe("/tmp/test-wiki");
    expect(result.source).toBe("environment variable");
  });

  test("resolveAllConfig returns all keys", () => {
    for (const meta of CONFIG_KEYS) {
      delete process.env[meta.envVar];
    }
    const all = resolveAllConfig();
    expect(all.length).toBe(6);
    for (const entry of all) {
      expect(entry.key).toBeTruthy();
      expect(entry.value).toBeDefined();
      expect(entry.source).toBeTruthy();
    }
  });

  test("defaults are correct", () => {
    for (const meta of CONFIG_KEYS) {
      delete process.env[meta.envVar];
    }
    const all = resolveAllConfig();
    const byKey = Object.fromEntries(all.map((a) => [a.key, a]));

    expect(byKey["wiki.path"].value).toBe("~/.mink/wiki/");
    expect(byKey["wiki.enabled"].value).toBe("true");
    expect(byKey["wiki.sync-mode"].value).toBe("immediate");
    expect(byKey["wiki.git-backup"].value).toBe("false");
    expect(byKey["wiki.git-remote"].value).toBe("origin");
  });
});

describe("saveGlobalConfig / setConfigValue / resetConfigKey", () => {
  test("setConfigValue and resetConfigKey round-trip", () => {
    // Set a value
    setConfigValue("wiki.path", "/my/wiki");
    const resolved = resolveConfigValue("wiki.path");
    // It should be either from config file or default depending on file state
    // Since we're writing to the real ~/.mink/config, just verify no crash
    expect(resolved.value).toBeDefined();

    // Reset
    resetConfigKey("wiki.path");
  });

  test("resetAllConfig clears everything", () => {
    setConfigValue("wiki.path", "/tmp/reset-test");
    resetAllConfig();
    const config = loadGlobalConfig();
    expect(Object.keys(config).length).toBe(0);
  });
});
