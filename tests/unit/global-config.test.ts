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
  loadLocalConfig,
  saveLocalConfig,
  resolveConfigValue,
  resolveAllConfig,
  setConfigValue,
  resetConfigKey,
  resetAllConfig,
} from "../../src/core/global-config";
import { globalConfigPath, localConfigPath } from "../../src/core/paths";
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

  test("CONFIG_KEYS has 24 entries", () => {
    expect(CONFIG_KEYS.length).toBe(24);
  });

  test("each CONFIG_KEY has required fields", () => {
    for (const meta of CONFIG_KEYS) {
      expect(meta.key).toBeTruthy();
      expect(meta.default).toBeDefined();
      expect(meta.envVar).toBeTruthy();
      expect(meta.description).toBeTruthy();
      expect(["shared", "local"]).toContain(meta.scope);
    }
  });
});

describe("loadGlobalConfig", () => {
  const configDir = join(tmpdir(), `mink-config-test-${Date.now()}`);
  let savedLocalConfig: string | null = null;

  beforeEach(() => {
    mkdirSync(configDir, { recursive: true });
    try {
      savedLocalConfig = readFileSync(localConfigPath(), "utf-8");
    } catch {
      savedLocalConfig = null;
    }
    // Clear local config so tests see defaults
    try { rmSync(localConfigPath(), { force: true }); } catch {}
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (savedLocalConfig !== null) {
      writeFileSync(localConfigPath(), savedLocalConfig);
    }
  });

  test("returns empty object when file missing", () => {
    // loadGlobalConfig reads from globalConfigPath() which is ~/.mink/config
    // We can't easily redirect that, so we test resolveConfigValue defaults
    const result = resolveConfigValue("wiki.path");
    expect(result.source).toBe("default");
    expect(result.value).toBe("~/.mink/wiki");
  });
});

describe("resolveConfigValue", () => {
  const originalEnv: Record<string, string | undefined> = {};
  let savedLocalConfig: string | null = null;

  beforeEach(() => {
    // Save original env vars
    for (const meta of CONFIG_KEYS) {
      originalEnv[meta.envVar] = process.env[meta.envVar];
    }
    // Save and clear local config so tests see defaults for local-scoped keys
    try {
      savedLocalConfig = readFileSync(localConfigPath(), "utf-8");
    } catch {
      savedLocalConfig = null;
    }
    try { rmSync(localConfigPath(), { force: true }); } catch {}
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
    // Restore local config
    if (savedLocalConfig !== null) {
      writeFileSync(localConfigPath(), savedLocalConfig);
    }
  });

  test("returns default values when nothing is set", () => {
    // Clear any env vars
    for (const meta of CONFIG_KEYS) {
      delete process.env[meta.envVar];
    }

    const result = resolveConfigValue("wiki.path");
    expect(result.value).toBe("~/.mink/wiki");
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
    expect(all.length).toBe(24);
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

    expect(byKey["wiki.path"].value).toBe("~/.mink/wiki");
    expect(byKey["wiki.enabled"].value).toBe("true");
    expect(byKey["wiki.sync-mode"].value).toBe("immediate");
    expect(byKey["wiki.git-backup"].value).toBe("false");
    expect(byKey["wiki.git-remote"].value).toBe("origin");
  });
});

describe("saveGlobalConfig / setConfigValue / resetConfigKey", () => {
  let savedLocalConfig: string | null = null;
  let savedGlobalConfig: string | null = null;

  beforeEach(() => {
    try {
      savedLocalConfig = readFileSync(localConfigPath(), "utf-8");
    } catch {
      savedLocalConfig = null;
    }
    try {
      savedGlobalConfig = readFileSync(globalConfigPath(), "utf-8");
    } catch {
      savedGlobalConfig = null;
    }
  });

  afterEach(() => {
    if (savedLocalConfig !== null) {
      writeFileSync(localConfigPath(), savedLocalConfig);
    } else {
      try { rmSync(localConfigPath(), { force: true }); } catch {}
    }
    if (savedGlobalConfig !== null) {
      writeFileSync(globalConfigPath(), savedGlobalConfig);
    } else {
      try { rmSync(globalConfigPath(), { force: true }); } catch {}
    }
  });

  test("setConfigValue and resetConfigKey round-trip", () => {
    // Set a value
    setConfigValue("wiki.path", "/my/wiki");
    const resolved = resolveConfigValue("wiki.path");
    expect(resolved.value).toBe("/my/wiki");
    expect(resolved.source).toBe("config file");

    // Reset
    resetConfigKey("wiki.path");
    const afterReset = resolveConfigValue("wiki.path");
    expect(afterReset.source).toBe("default");
  });

  test("resetAllConfig clears everything", () => {
    setConfigValue("wiki.path", "/tmp/reset-test");
    setConfigValue("wiki.enabled", "false");
    resetAllConfig();
    const sharedConfig = loadGlobalConfig();
    const localConfig = loadLocalConfig();
    expect(Object.keys(sharedConfig).length).toBe(0);
    expect(Object.keys(localConfig).length).toBe(0);
  });
});
