import { readdirSync, statSync } from "fs";
import { join, relative } from "path";
import type { ScannedFile, ProjectConfig } from "../types/file-index";
import { safeReadJson } from "./fs-utils";

export const DEFAULT_EXCLUDES: string[] = [
  "node_modules", "vendor", ".venv", "venv", "__pycache__",
  "bower_components", ".yarn", ".pnp",
  "dist", "build", "out", ".next", ".nuxt", ".svelte-kit",
  ".turbo", ".vercel", ".output",
  "coverage", ".nyc_output",
  ".git", ".hg", ".svn",
  "package-lock.json", "bun.lock", "yarn.lock",
  "pnpm-lock.yaml", "Gemfile.lock", "poetry.lock", "composer.lock",
  "*.min.js", "*.min.css", "*.map",
  "*.png", "*.jpg", "*.jpeg", "*.gif", "*.svg", "*.ico",
  "*.woff", "*.woff2", "*.ttf", "*.eot",
  "*.mp3", "*.mp4", "*.webm", "*.zip", "*.tar", "*.gz",
  "*.pdf", "*.exe", "*.dll", "*.so", "*.dylib",
  ".env", ".env.*",
  ".mink",
];

const DEFAULT_MAX_FILES = 500;

function matchesPattern(name: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    // Glob: *.min.js -> match against basename
    const regex = new RegExp(
      "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$"
    );
    return regex.test(name);
  }
  // Exact match against name
  return name === pattern;
}

function isExcluded(name: string, excludes: string[]): boolean {
  return excludes.some((pattern) => matchesPattern(name, pattern));
}

function walkDirectory(
  dir: string,
  projectRoot: string,
  excludes: string[],
  results: ScannedFile[]
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // Permission denied or other error — skip
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      if (isExcluded(entry.name, excludes)) continue;
      walkDirectory(join(dir, entry.name), projectRoot, excludes, results);
      continue;
    }

    if (entry.isFile()) {
      if (isExcluded(entry.name, excludes)) continue;
      try {
        const fullPath = join(dir, entry.name);
        const stat = statSync(fullPath);
        results.push({
          relativePath: relative(projectRoot, fullPath),
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // stat failed — skip
      }
    }
  }
}

export function loadConfig(configPath: string): ProjectConfig {
  const raw = safeReadJson(configPath);
  if (raw && typeof raw === "object") return raw as ProjectConfig;
  return {};
}

export function getExcludes(config: ProjectConfig): string[] {
  return [...DEFAULT_EXCLUDES, ...(config.excludePatterns ?? [])];
}

export interface ScanStats {
  files: ScannedFile[];
  totalScanned: number;
  truncated: number;
}

export function scanProjectWithStats(
  projectRoot: string,
  excludes: string[],
  maxFiles: number = DEFAULT_MAX_FILES
): ScanStats {
  const results: ScannedFile[] = [];
  walkDirectory(projectRoot, projectRoot, excludes, results);
  results.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const totalScanned = results.length;
  const files = results.slice(0, maxFiles);
  return { files, totalScanned, truncated: totalScanned - files.length };
}

export function scanProject(
  projectRoot: string,
  excludes: string[],
  maxFiles: number = DEFAULT_MAX_FILES
): ScannedFile[] {
  return scanProjectWithStats(projectRoot, excludes, maxFiles).files;
}
