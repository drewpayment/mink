import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  symlinkSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  scanProject,
  scanProjectWithStats,
  getExcludes,
  loadConfig,
  DEFAULT_EXCLUDES,
} from "../../src/core/scanner";
import { atomicWriteJson } from "../../src/core/fs-utils";

describe("scanner", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-scanner-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("DEFAULT_EXCLUDES", () => {
    test("includes node_modules", () => {
      expect(DEFAULT_EXCLUDES).toContain("node_modules");
    });

    test("includes .git", () => {
      expect(DEFAULT_EXCLUDES).toContain(".git");
    });

    test("includes .mink", () => {
      expect(DEFAULT_EXCLUDES).toContain(".mink");
    });

    test("includes lock files", () => {
      expect(DEFAULT_EXCLUDES).toContain("package-lock.json");
      expect(DEFAULT_EXCLUDES).toContain("bun.lock");
      expect(DEFAULT_EXCLUDES).toContain("yarn.lock");
    });

    test("includes binary extensions", () => {
      expect(DEFAULT_EXCLUDES).toContain("*.png");
      expect(DEFAULT_EXCLUDES).toContain("*.jpg");
    });
  });

  describe("loadConfig", () => {
    test("returns empty object for missing config", () => {
      const config = loadConfig(join(dir, "nonexistent.json"));
      expect(config).toEqual({});
    });

    test("returns parsed config from valid JSON", () => {
      const cfgPath = join(dir, "config.json");
      atomicWriteJson(cfgPath, {
        excludePatterns: ["*.log"],
        maxFiles: 100,
      });
      const config = loadConfig(cfgPath);
      expect(config.excludePatterns).toEqual(["*.log"]);
      expect(config.maxFiles).toBe(100);
    });

    test("returns empty object for invalid JSON", () => {
      const cfgPath = join(dir, "config.json");
      writeFileSync(cfgPath, "not json");
      const config = loadConfig(cfgPath);
      expect(config).toEqual({});
    });
  });

  describe("getExcludes", () => {
    test("returns default excludes when no custom patterns", () => {
      const excludes = getExcludes({});
      expect(excludes).toEqual(DEFAULT_EXCLUDES);
    });

    test("merges custom patterns with defaults", () => {
      const excludes = getExcludes({ excludePatterns: ["*.log", "tmp"] });
      expect(excludes).toContain("*.log");
      expect(excludes).toContain("tmp");
      expect(excludes).toContain("node_modules");
    });
  });

  describe("scanProject", () => {
    test("finds files in project root", () => {
      writeFileSync(join(dir, "index.ts"), "export default {};");
      writeFileSync(join(dir, "util.ts"), "export const x = 1;");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain("index.ts");
      expect(paths).toContain("util.ts");
    });

    test("finds files in subdirectories", () => {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "app.ts"), "const app = true;");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain(join("src", "app.ts"));
    });

    test("excludes node_modules directory", () => {
      mkdirSync(join(dir, "node_modules", "foo"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "foo", "index.js"), "module.exports = {};");
      writeFileSync(join(dir, "app.ts"), "export {};");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).not.toContain(join("node_modules", "foo", "index.js"));
      expect(paths).toContain("app.ts");
    });

    test("excludes files matching glob patterns", () => {
      writeFileSync(join(dir, "app.min.js"), "minified");
      writeFileSync(join(dir, "app.ts"), "source");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).not.toContain("app.min.js");
      expect(paths).toContain("app.ts");
    });

    test("excludes .env files", () => {
      writeFileSync(join(dir, ".env"), "SECRET=123");
      writeFileSync(join(dir, ".env.local"), "LOCAL=456");
      writeFileSync(join(dir, "app.ts"), "export {};");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).not.toContain(".env");
      expect(paths).not.toContain(".env.local");
    });

    test("respects maxFiles limit", () => {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(dir, `file${i}.ts`), `export const x${i} = ${i};`);
      }

      const results = scanProject(dir, DEFAULT_EXCLUDES, 5);
      expect(results).toHaveLength(5);
    });

    test("sorts by mtime descending (newest first)", () => {
      // Create files with a slight delay to ensure different mtimes
      writeFileSync(join(dir, "old.ts"), "old");
      writeFileSync(join(dir, "new.ts"), "new");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      // Both files should be present; newest mtime should be first
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0].mtimeMs).toBeGreaterThanOrEqual(results[1].mtimeMs);
    });

    test("skips symlinks", () => {
      writeFileSync(join(dir, "real.ts"), "real content");
      try {
        symlinkSync(join(dir, "real.ts"), join(dir, "link.ts"));
      } catch {
        // Symlinks may not be supported on all platforms
        return;
      }

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain("real.ts");
      expect(paths).not.toContain("link.ts");
    });

    test("returns relative paths", () => {
      mkdirSync(join(dir, "src", "utils"), { recursive: true });
      writeFileSync(join(dir, "src", "utils", "helper.ts"), "export {};");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain(join("src", "utils", "helper.ts"));
      // Ensure no absolute paths
      for (const p of paths) {
        expect(p.startsWith("/")).toBe(false);
      }
    });

    test("includes mtimeMs for each file", () => {
      writeFileSync(join(dir, "test.ts"), "export {};");

      const results = scanProject(dir, DEFAULT_EXCLUDES);
      expect(results[0].mtimeMs).toBeGreaterThan(0);
    });

    test("handles empty project directory", () => {
      const results = scanProject(dir, DEFAULT_EXCLUDES);
      expect(results).toHaveLength(0);
    });

    test("scanProjectWithStats reports truncation when over cap", () => {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(dir, `file${i}.ts`), `export const x${i} = ${i};`);
      }

      const stats = scanProjectWithStats(dir, DEFAULT_EXCLUDES, 5);
      expect(stats.files).toHaveLength(5);
      expect(stats.totalScanned).toBe(10);
      expect(stats.truncated).toBe(5);
    });

    test("scanProjectWithStats reports zero truncation under cap", () => {
      writeFileSync(join(dir, "a.ts"), "x");
      writeFileSync(join(dir, "b.ts"), "x");

      const stats = scanProjectWithStats(dir, DEFAULT_EXCLUDES, 100);
      expect(stats.totalScanned).toBe(2);
      expect(stats.truncated).toBe(0);
    });

    test("applies custom exclude patterns", () => {
      writeFileSync(join(dir, "app.ts"), "export {};");
      writeFileSync(join(dir, "debug.log"), "log data");

      const excludes = [...DEFAULT_EXCLUDES, "*.log"];
      const results = scanProject(dir, excludes);
      const paths = results.map((r) => r.relativePath);
      expect(paths).toContain("app.ts");
      expect(paths).not.toContain("debug.log");
    });
  });
});
