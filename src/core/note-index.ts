import { join } from "path";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { atomicWriteJson, safeReadJson } from "./fs-utils";
import { vaultIndexPath, resolveVaultPath } from "./vault";
import type { VaultIndex, VaultIndexEntry, NoteCategory } from "../types/note";

export function createEmptyVaultIndex(): VaultIndex {
  return {
    lastScanTimestamp: "",
    lastFullScanTimestamp: "",
    totalNotes: 0,
    entries: {},
  };
}

export function loadVaultIndex(): VaultIndex {
  const raw = safeReadJson(vaultIndexPath());
  if (raw === null || typeof raw !== "object") return createEmptyVaultIndex();
  const obj = raw as Record<string, unknown>;
  if (typeof obj.entries !== "object" || obj.entries === null) {
    return createEmptyVaultIndex();
  }
  return raw as VaultIndex;
}

export function saveVaultIndex(index: VaultIndex): void {
  atomicWriteJson(vaultIndexPath(), index);
}

export function updateVaultEntry(
  index: VaultIndex,
  entry: VaultIndexEntry
): void {
  index.entries[entry.filePath] = entry;
  index.totalNotes = Object.keys(index.entries).length;
}

export function removeVaultEntry(
  index: VaultIndex,
  filePath: string
): void {
  delete index.entries[filePath];
  index.totalNotes = Object.keys(index.entries).length;
}

export function extractNoteTitle(content: string): string {
  // Try first heading
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  // Try frontmatter title
  const fmMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  if (fmMatch) return fmMatch[1].trim();
  // First non-empty line after frontmatter
  const lines = content.split("\n");
  let pastFrontmatter = !content.startsWith("---");
  let fmDashCount = 0;
  for (const line of lines) {
    if (!pastFrontmatter) {
      if (line.trim() === "---") fmDashCount++;
      if (fmDashCount >= 2) pastFrontmatter = true;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) return trimmed;
  }
  return "Untitled";
}

export function extractNoteTags(content: string): string[] {
  // Parse tags from frontmatter
  const fmMatch = content.match(/^tags:\s*\[(.+)\]/m);
  if (fmMatch) {
    return fmMatch[1]
      .split(",")
      .map((t) => t.trim().replace(/["']/g, ""))
      .filter(Boolean);
  }
  // Try multiline tags
  const lines = content.split("\n");
  const tagsIdx = lines.findIndex((l) => l.startsWith("tags:"));
  if (tagsIdx === -1) return [];
  const tags: string[] = [];
  for (let i = tagsIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^\s+-\s+/)) {
      tags.push(line.replace(/^\s+-\s+/, "").trim().replace(/["']/g, ""));
    } else {
      break;
    }
  }
  return tags;
}

export function extractNoteCategory(content: string): NoteCategory {
  const match = content.match(/^category:\s*(.+)$/m);
  if (match) {
    const cat = match[1].trim().replace(/["']/g, "") as NoteCategory;
    if (
      ["inbox", "projects", "areas", "resources", "archives"].includes(cat)
    ) {
      return cat;
    }
  }
  return "inbox";
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 3.75);
}

export function buildEntryFromContent(
  filePath: string,
  content: string,
  lastModified: string
): VaultIndexEntry {
  const title = extractNoteTitle(content);
  const tags = extractNoteTags(content);
  const category = extractNoteCategory(content);
  // Description: first non-heading, non-frontmatter line
  let description = "";
  const lines = content.split("\n");
  let pastFrontmatter = !content.startsWith("---");
  let seenFmEnd = false;
  for (const line of lines) {
    if (!pastFrontmatter) {
      if (line === "---" && seenFmEnd) pastFrontmatter = true;
      if (line === "---") seenFmEnd = true;
      continue;
    }
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      description = trimmed.slice(0, 120);
      break;
    }
  }

  return {
    filePath,
    title,
    description,
    tags,
    category,
    estimatedTokens: estimateTokens(content),
    lastModified,
  };
}

export function updateVaultIndexForFile(
  filePath: string,
  content: string
): void {
  const index = loadVaultIndex();
  const root = resolveVaultPath();
  const relativePath = filePath.startsWith(root)
    ? filePath.slice(root.length + 1)
    : filePath;
  const entry = buildEntryFromContent(
    relativePath,
    content,
    new Date().toISOString()
  );
  updateVaultEntry(index, entry);
  index.lastScanTimestamp = new Date().toISOString();
  saveVaultIndex(index);
}

export function rebuildVaultIndex(): VaultIndex {
  const root = resolveVaultPath();
  const index = createEmptyVaultIndex();
  const files = collectAllMarkdown(root);

  for (const file of files) {
    try {
      const content = readFileSync(file.absolutePath, "utf-8");
      const entry = buildEntryFromContent(
        file.relativePath,
        content,
        new Date(file.mtimeMs).toISOString()
      );
      updateVaultEntry(index, entry);
    } catch {
      // Skip unreadable files
    }
  }

  const now = new Date().toISOString();
  index.lastScanTimestamp = now;
  index.lastFullScanTimestamp = now;
  saveVaultIndex(index);
  return index;
}

export function searchVaultIndex(
  term: string
): VaultIndexEntry[] {
  const index = loadVaultIndex();
  const lower = term.toLowerCase();
  return Object.values(index.entries).filter(
    (e) =>
      e.title.toLowerCase().includes(lower) ||
      e.description.toLowerCase().includes(lower) ||
      e.tags.some((t) => t.toLowerCase().includes(lower)) ||
      e.filePath.toLowerCase().includes(lower)
  );
}

export function getVaultTags(): string[] {
  const index = loadVaultIndex();
  const tags = new Set<string>();
  for (const entry of Object.values(index.entries)) {
    for (const tag of entry.tags) {
      tags.add(tag);
    }
  }
  return [...tags].sort();
}

export function getRecentNotes(n: number): VaultIndexEntry[] {
  const index = loadVaultIndex();
  return Object.values(index.entries)
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
    .slice(0, n);
}

export interface VaultStaleness {
  isStale: boolean;
  reason: string | null;
  diskCount: number;
  indexCount: number;
  lastFullScan: string | null;
}

export function vaultIndexStaleness(): VaultStaleness {
  const index = loadVaultIndex();
  const root = resolveVaultPath();
  const diskCount = collectAllMarkdown(root).length;
  const indexCount = Object.keys(index.entries).length;
  const lastFullScan = index.lastFullScanTimestamp || null;

  if (!lastFullScan) {
    return {
      isStale: true,
      reason: "no full scan on record",
      diskCount,
      indexCount,
      lastFullScan: null,
    };
  }

  const delta = Math.abs(diskCount - indexCount);
  const threshold = Math.max(5, Math.floor(diskCount * 0.05));
  if (delta >= threshold) {
    return {
      isStale: true,
      reason: `${diskCount} files on disk but ${indexCount} in index`,
      diskCount,
      indexCount,
      lastFullScan,
    };
  }

  return {
    isStale: false,
    reason: null,
    diskCount,
    indexCount,
    lastFullScan,
  };
}

interface ScannedMarkdown {
  absolutePath: string;
  relativePath: string;
  mtimeMs: number;
}

const VAULT_EXCLUDES = new Set([
  ".obsidian",
  ".git",
  ".mink-vault.json",
  ".mink-index.json",
  "node_modules",
]);

function collectAllMarkdown(rootPath: string): ScannedMarkdown[] {
  const files: ScannedMarkdown[] = [];
  function walk(dir: string) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (VAULT_EXCLUDES.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith(".md")) {
          const stat = statSync(fullPath);
          files.push({
            absolutePath: fullPath,
            relativePath: fullPath.slice(rootPath.length + 1),
            mtimeMs: stat.mtimeMs,
          });
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }
  walk(rootPath);
  return files;
}
