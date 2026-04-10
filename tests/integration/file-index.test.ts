import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { scanProject, loadConfig, getExcludes } from "../../src/core/scanner";
import { extractDescription } from "../../src/core/description";
import { estimateTokens } from "../../src/core/token-estimate";
import {
  createEmptyIndex,
  isFileIndex,
  upsertEntry,
  checkStaleness,
  lookupEntry,
  recordHit,
  recordMiss,
} from "../../src/core/index-store";
import type { FileIndex, FileIndexEntry } from "../../src/types/file-index";

describe("file index integration", () => {
  let projectDir: string;
  let stateDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "mink-project-"));
    stateDir = mkdtempSync(join(tmpdir(), "mink-state-"));
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  });

  function buildIndex(): FileIndex {
    const indexPath = join(stateDir, "file-index.json");
    const configPath = join(stateDir, "config.json");
    const config = loadConfig(configPath);
    const excludes = getExcludes(config);
    const maxFiles = config.maxFiles ?? 500;

    const scanned = scanProject(projectDir, excludes, maxFiles);
    const index = createEmptyIndex();

    for (const file of scanned) {
      const fullPath = join(projectDir, file.relativePath);
      let content: string;
      try {
        content = readFileSync(fullPath, "utf-8");
      } catch {
        continue;
      }

      const entry: FileIndexEntry = {
        filePath: file.relativePath,
        description: extractDescription(file.relativePath, content),
        estimatedTokens: estimateTokens(content, file.relativePath),
        lastModified: new Date(file.mtimeMs).toISOString(),
        lastIndexed: new Date().toISOString(),
      };
      upsertEntry(index, entry);
    }

    index.header.lastScanTimestamp = new Date().toISOString();
    atomicWriteJson(indexPath, index);
    return index;
  }

  test("scan → persist → reload produces valid index", () => {
    // Create sample project files
    writeFileSync(
      join(projectDir, "index.ts"),
      'export function main() { console.log("hello"); }'
    );
    mkdirSync(join(projectDir, "src"));
    writeFileSync(
      join(projectDir, "src", "utils.ts"),
      "export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }"
    );
    writeFileSync(
      join(projectDir, "README.md"),
      "# My Project\n\nA sample project."
    );

    // Build and persist index
    const index = buildIndex();
    const indexPath = join(stateDir, "file-index.json");

    // Reload from disk
    const raw = safeReadJson(indexPath);
    expect(isFileIndex(raw)).toBe(true);

    const loaded = raw as FileIndex;
    expect(loaded.header.totalFiles).toBe(3);
    expect(loaded.header.lastScanTimestamp).not.toBe("");

    // Verify individual entries
    const indexEntry = lookupEntry(loaded, "index.ts");
    expect(indexEntry).not.toBeNull();
    expect(indexEntry!.description).toBe("exports: main");
    expect(indexEntry!.estimatedTokens).toBeGreaterThan(0);

    const utilsEntry = lookupEntry(loaded, join("src", "utils.ts"));
    expect(utilsEntry).not.toBeNull();
    expect(utilsEntry!.description).toBe("exports: add, sub");

    const readmeEntry = lookupEntry(loaded, "README.md");
    expect(readmeEntry).not.toBeNull();
    expect(readmeEntry!.description).toBe("My Project");
  });

  test("excluded files are not indexed", () => {
    writeFileSync(join(projectDir, "app.ts"), "export const app = true;");
    mkdirSync(join(projectDir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(
      join(projectDir, "node_modules", "pkg", "index.js"),
      "module.exports = {};"
    );
    writeFileSync(join(projectDir, ".env"), "SECRET=abc");

    const index = buildIndex();

    expect(lookupEntry(index, "app.ts")).not.toBeNull();
    expect(lookupEntry(index, join("node_modules", "pkg", "index.js"))).toBeNull();
    expect(lookupEntry(index, ".env")).toBeNull();
  });

  test("staleness check detects new and deleted files", () => {
    // Initial scan with two files
    writeFileSync(join(projectDir, "a.ts"), "export const a = 1;");
    writeFileSync(join(projectDir, "b.ts"), "export const b = 2;");

    const index = buildIndex();
    expect(index.header.totalFiles).toBe(2);

    // Simulate: delete b.ts, add c.ts
    rmSync(join(projectDir, "b.ts"));
    writeFileSync(join(projectDir, "c.ts"), "export const c = 3;");

    // Re-scan filesystem (but don't rebuild index)
    const config = loadConfig(join(stateDir, "config.json"));
    const excludes = getExcludes(config);
    const scanned = scanProject(projectDir, excludes);
    const scannedPaths = scanned.map((f) => f.relativePath);

    const report = checkStaleness(index, scannedPaths);
    expect(report.isStale).toBe(true);
    expect(report.missingFromIndex).toContain("c.ts");
    expect(report.orphanedEntries).toContain("b.ts");
  });

  test("rebuild preserves lifetime counters", () => {
    writeFileSync(join(projectDir, "app.ts"), "export const x = 1;");

    // First build
    const firstIndex = buildIndex();
    recordHit(firstIndex);
    recordHit(firstIndex);
    recordMiss(firstIndex);
    const indexPath = join(stateDir, "file-index.json");
    atomicWriteJson(indexPath, firstIndex);

    // Simulate rebuild: load existing, create new index preserving counters
    const existing = safeReadJson(indexPath) as FileIndex;
    const newIndex = createEmptyIndex();
    newIndex.header.lifetimeHits = existing.header.lifetimeHits;
    newIndex.header.lifetimeMisses = existing.header.lifetimeMisses;

    const scanned = scanProject(projectDir, getExcludes({}));
    for (const file of scanned) {
      const fullPath = join(projectDir, file.relativePath);
      const content = readFileSync(fullPath, "utf-8");
      const entry: FileIndexEntry = {
        filePath: file.relativePath,
        description: extractDescription(file.relativePath, content),
        estimatedTokens: estimateTokens(content, file.relativePath),
        lastModified: new Date(file.mtimeMs).toISOString(),
        lastIndexed: new Date().toISOString(),
      };
      upsertEntry(newIndex, entry);
    }
    newIndex.header.lastScanTimestamp = new Date().toISOString();
    atomicWriteJson(indexPath, newIndex);

    // Verify counters survived
    const reloaded = safeReadJson(indexPath) as FileIndex;
    expect(reloaded.header.lifetimeHits).toBe(2);
    expect(reloaded.header.lifetimeMisses).toBe(1);
  });

  test("custom config excludePatterns are respected", () => {
    writeFileSync(join(projectDir, "app.ts"), "export const app = 1;");
    writeFileSync(join(projectDir, "debug.log"), "DEBUG: some log");
    writeFileSync(join(projectDir, "error.log"), "ERROR: bad thing");

    // Write custom config
    const configPath = join(stateDir, "config.json");
    atomicWriteJson(configPath, { excludePatterns: ["*.log"] });

    const config = loadConfig(configPath);
    const excludes = getExcludes(config);
    const scanned = scanProject(projectDir, excludes);
    const index = createEmptyIndex();

    for (const file of scanned) {
      const fullPath = join(projectDir, file.relativePath);
      const content = readFileSync(fullPath, "utf-8");
      const entry: FileIndexEntry = {
        filePath: file.relativePath,
        description: extractDescription(file.relativePath, content),
        estimatedTokens: estimateTokens(content, file.relativePath),
        lastModified: new Date(file.mtimeMs).toISOString(),
        lastIndexed: new Date().toISOString(),
      };
      upsertEntry(index, entry);
    }

    expect(lookupEntry(index, "app.ts")).not.toBeNull();
    expect(lookupEntry(index, "debug.log")).toBeNull();
    expect(lookupEntry(index, "error.log")).toBeNull();
  });

  test("maxFiles config limits the number of indexed files", () => {
    for (let i = 0; i < 20; i++) {
      writeFileSync(
        join(projectDir, `file${String(i).padStart(2, "0")}.ts`),
        `export const x${i} = ${i};`
      );
    }

    const configPath = join(stateDir, "config.json");
    atomicWriteJson(configPath, { maxFiles: 5 });

    const config = loadConfig(configPath);
    const excludes = getExcludes(config);
    const maxFiles = config.maxFiles ?? 500;
    const scanned = scanProject(projectDir, excludes, maxFiles);

    expect(scanned).toHaveLength(5);
  });

  test("description extraction works across file types in a real project", () => {
    // TypeScript with exports
    writeFileSync(
      join(projectDir, "router.ts"),
      "export function createRouter() {}\nexport function addRoute() {}"
    );

    // Markdown with heading
    writeFileSync(
      join(projectDir, "CHANGELOG.md"),
      "# Changelog\n\n## v1.0.0\n- Initial release"
    );

    // Package.json (known config)
    writeFileSync(
      join(projectDir, "package.json"),
      '{ "name": "test", "version": "1.0.0" }'
    );

    // Shell script with shebang
    writeFileSync(
      join(projectDir, "deploy.sh"),
      "#!/bin/bash\n# Deploy to production\nset -e\necho 'deploying'"
    );

    const index = buildIndex();

    const router = lookupEntry(index, "router.ts");
    expect(router!.description).toBe("exports: createRouter, addRoute");

    const changelog = lookupEntry(index, "CHANGELOG.md");
    expect(changelog!.description).toBe("Changelog");

    const pkg = lookupEntry(index, "package.json");
    expect(pkg!.description).toBe("Node.js package manifest");

    const deploy = lookupEntry(index, "deploy.sh");
    expect(deploy!.description).toBe("Deploy to production");
  });
});
