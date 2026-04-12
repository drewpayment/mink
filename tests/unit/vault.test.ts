import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  resolveVaultPath,
  ensureVaultStructure,
  isVaultInitialized,
  isInsideVault,
  categoryToDir,
  vaultManifestPath,
  vaultRoot,
  vaultInbox,
  vaultProjects,
  vaultAreas,
  vaultDailyDir,
  vaultResources,
  vaultArchives,
  vaultTemplates,
  vaultPatterns,
  vaultIndexPath,
  vaultMasterIndexPath,
  isWikiEnabled,
} from "../../src/core/vault";

describe("vault", () => {
  let tempDir: string;
  let originalEnv: string | undefined;
  let originalEnabled: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mink-test-"));
    originalEnv = process.env.MINK_WIKI_PATH;
    originalEnabled = process.env.MINK_WIKI_ENABLED;
    process.env.MINK_WIKI_PATH = tempDir;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MINK_WIKI_PATH;
    } else {
      process.env.MINK_WIKI_PATH = originalEnv;
    }
    if (originalEnabled === undefined) {
      delete process.env.MINK_WIKI_ENABLED;
    } else {
      process.env.MINK_WIKI_ENABLED = originalEnabled;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("resolveVaultPath", () => {
    test("resolves from MINK_WIKI_PATH env var", () => {
      expect(resolveVaultPath()).toBe(tempDir);
    });

    test("expands ~ in path", () => {
      process.env.MINK_WIKI_PATH = "~/my-wiki";
      const result = resolveVaultPath();
      expect(result).not.toContain("~");
      expect(result).toContain("my-wiki");
    });

    test("returns absolute path as-is", () => {
      process.env.MINK_WIKI_PATH = "/absolute/path/wiki";
      expect(resolveVaultPath()).toBe("/absolute/path/wiki");
    });
  });

  describe("vaultRoot", () => {
    test("returns same as resolveVaultPath", () => {
      expect(vaultRoot()).toBe(resolveVaultPath());
    });
  });

  describe("vault directory helpers", () => {
    test("vaultInbox returns inbox subdirectory", () => {
      expect(vaultInbox()).toBe(join(tempDir, "inbox"));
    });

    test("vaultProjects returns projects subdirectory", () => {
      expect(vaultProjects()).toBe(join(tempDir, "projects"));
    });

    test("vaultProjects with slug returns project subdirectory", () => {
      expect(vaultProjects("my-app")).toBe(join(tempDir, "projects", "my-app"));
    });

    test("vaultAreas returns areas subdirectory", () => {
      expect(vaultAreas()).toBe(join(tempDir, "areas"));
    });

    test("vaultDailyDir returns areas/daily subdirectory", () => {
      expect(vaultDailyDir()).toBe(join(tempDir, "areas", "daily"));
    });

    test("vaultResources returns resources subdirectory", () => {
      expect(vaultResources()).toBe(join(tempDir, "resources"));
    });

    test("vaultArchives returns archives subdirectory", () => {
      expect(vaultArchives()).toBe(join(tempDir, "archives"));
    });

    test("vaultTemplates returns templates subdirectory", () => {
      expect(vaultTemplates()).toBe(join(tempDir, "templates"));
    });

    test("vaultPatterns returns patterns subdirectory", () => {
      expect(vaultPatterns()).toBe(join(tempDir, "patterns"));
    });

    test("vaultManifestPath returns .mink-vault.json path", () => {
      expect(vaultManifestPath()).toBe(join(tempDir, ".mink-vault.json"));
    });

    test("vaultIndexPath returns .mink-index.json path", () => {
      expect(vaultIndexPath()).toBe(join(tempDir, ".mink-index.json"));
    });

    test("vaultMasterIndexPath returns _index.md path", () => {
      expect(vaultMasterIndexPath()).toBe(join(tempDir, "_index.md"));
    });
  });

  describe("ensureVaultStructure", () => {
    test("creates all vault directories", () => {
      ensureVaultStructure();
      expect(existsSync(join(tempDir, "inbox"))).toBe(true);
      expect(existsSync(join(tempDir, "projects"))).toBe(true);
      expect(existsSync(join(tempDir, "areas"))).toBe(true);
      expect(existsSync(join(tempDir, "areas", "daily"))).toBe(true);
      expect(existsSync(join(tempDir, "resources"))).toBe(true);
      expect(existsSync(join(tempDir, "archives"))).toBe(true);
      expect(existsSync(join(tempDir, "templates"))).toBe(true);
      expect(existsSync(join(tempDir, "patterns"))).toBe(true);
    });

    test("is idempotent", () => {
      ensureVaultStructure();
      ensureVaultStructure();
      expect(existsSync(join(tempDir, "inbox"))).toBe(true);
    });
  });

  describe("isVaultInitialized", () => {
    test("returns false when manifest does not exist", () => {
      expect(isVaultInitialized()).toBe(false);
    });

    test("returns true when manifest exists", () => {
      writeFileSync(join(tempDir, ".mink-vault.json"), "{}");
      expect(isVaultInitialized()).toBe(true);
    });
  });

  describe("isInsideVault", () => {
    test("returns true for vault root", () => {
      expect(isInsideVault(tempDir)).toBe(true);
    });

    test("returns true for subdirectory of vault", () => {
      expect(isInsideVault(join(tempDir, "inbox"))).toBe(true);
    });

    test("returns true for deeply nested subdirectory", () => {
      expect(isInsideVault(join(tempDir, "projects", "my-app", "notes"))).toBe(
        true
      );
    });

    test("returns false for directory outside vault", () => {
      expect(isInsideVault("/some/other/path")).toBe(false);
    });

    test("returns false for path that starts similarly but is different", () => {
      expect(isInsideVault(tempDir + "-extra")).toBe(false);
    });

    test("handles trailing slashes", () => {
      expect(isInsideVault(tempDir + "/")).toBe(true);
    });
  });

  describe("isWikiEnabled", () => {
    test("returns true when MINK_WIKI_ENABLED is true", () => {
      process.env.MINK_WIKI_ENABLED = "true";
      expect(isWikiEnabled()).toBe(true);
    });

    test("returns false when MINK_WIKI_ENABLED is false", () => {
      process.env.MINK_WIKI_ENABLED = "false";
      expect(isWikiEnabled()).toBe(false);
    });
  });

  describe("categoryToDir", () => {
    test("maps inbox to inbox directory", () => {
      expect(categoryToDir("inbox")).toBe(join(tempDir, "inbox"));
    });

    test("maps projects to projects directory", () => {
      expect(categoryToDir("projects")).toBe(join(tempDir, "projects"));
    });

    test("maps projects with slug to project subdirectory", () => {
      expect(categoryToDir("projects", "my-app")).toBe(
        join(tempDir, "projects", "my-app")
      );
    });

    test("maps areas to areas directory", () => {
      expect(categoryToDir("areas")).toBe(join(tempDir, "areas"));
    });

    test("maps resources to resources directory", () => {
      expect(categoryToDir("resources")).toBe(join(tempDir, "resources"));
    });

    test("maps archives to archives directory", () => {
      expect(categoryToDir("archives")).toBe(join(tempDir, "archives"));
    });

    test("defaults unknown category to inbox", () => {
      expect(categoryToDir("unknown")).toBe(join(tempDir, "inbox"));
    });

    test("defaults empty string to inbox", () => {
      expect(categoryToDir("")).toBe(join(tempDir, "inbox"));
    });
  });
});
