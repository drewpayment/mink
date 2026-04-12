import { join } from "path";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { atomicWriteText, safeAppendText } from "./fs-utils";
import { vaultRoot, vaultMasterIndexPath } from "./vault";
import type { VaultIndex } from "../types/note";

const WIKILINK_RE = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(WIKILINK_RE.source, "g");
  while ((match = re.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return [...new Set(links)];
}

export function insertWikilinks(
  content: string,
  targets: string[]
): string {
  let result = content;
  for (const target of targets) {
    // Don't insert if already a wikilink
    if (result.includes(`[[${target}]]`)) continue;
    // Don't insert inside frontmatter
    const fmEnd = findFrontmatterEnd(result);
    const body = result.slice(fmEnd);
    // Replace first occurrence of the target text (case-insensitive, word boundary)
    const re = new RegExp(`\\b(${escapeRegex(target)})\\b`, "i");
    const replaced = body.replace(re, `[[$1]]`);
    if (replaced !== body) {
      result = result.slice(0, fmEnd) + replaced;
    }
  }
  return result;
}

export function addBacklink(
  targetNotePath: string,
  sourceTitle: string
): void {
  if (!existsSync(targetNotePath)) return;
  const content = readFileSync(targetNotePath, "utf-8");

  // Don't add duplicate backlinks
  if (content.includes(`[[${sourceTitle}]]`)) return;

  const backlinkSection = "\n\n## Backlinks\n";
  const backlinkEntry = `- [[${sourceTitle}]]\n`;

  if (content.includes("## Backlinks")) {
    // Append to existing backlinks section
    const idx = content.indexOf("## Backlinks");
    const sectionEnd = content.indexOf("\n## ", idx + 1);
    const insertAt = sectionEnd === -1 ? content.length : sectionEnd;
    const updated =
      content.slice(0, insertAt).trimEnd() +
      "\n" +
      backlinkEntry +
      (sectionEnd === -1 ? "" : content.slice(sectionEnd));
    atomicWriteText(targetNotePath, updated);
  } else {
    safeAppendText(targetNotePath, backlinkSection + backlinkEntry);
  }
}

export function updateMasterIndex(vaultRootPath: string): void {
  const now = new Date().toISOString().split("T")[0];
  const sections: string[] = [
    `---`,
    `updated: "${new Date().toISOString()}"`,
    `---`,
    ``,
    `# Knowledge Base`,
    ``,
    `> Last updated: ${now}`,
    ``,
  ];

  const categories = [
    { name: "Inbox", dir: "inbox", emoji: "" },
    { name: "Projects", dir: "projects", emoji: "" },
    { name: "Areas", dir: "areas", emoji: "" },
    { name: "Resources", dir: "resources", emoji: "" },
    { name: "Archives", dir: "archives", emoji: "" },
    { name: "Patterns", dir: "patterns", emoji: "" },
  ];

  for (const cat of categories) {
    const dirPath = join(vaultRootPath, cat.dir);
    if (!existsSync(dirPath)) continue;

    const files = collectMarkdownFiles(dirPath, vaultRootPath);
    if (files.length === 0 && cat.dir !== "inbox") continue;

    sections.push(`## ${cat.name}`);
    sections.push("");

    if (files.length === 0) {
      sections.push("*No notes yet.*");
    } else {
      // Show up to 20 most recent
      const sorted = files
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20);
      for (const file of sorted) {
        sections.push(`- [[${file.title}]]`);
      }
      if (files.length > 20) {
        sections.push(`- *...and ${files.length - 20} more*`);
      }
    }
    sections.push("");
  }

  const indexPath = vaultMasterIndexPath();
  atomicWriteText(indexPath, sections.join("\n"));
}

interface CollectedFile {
  title: string;
  relativePath: string;
  mtime: number;
}

function collectMarkdownFiles(
  dirPath: string,
  rootPath: string
): CollectedFile[] {
  const files: CollectedFile[] = [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...collectMarkdownFiles(fullPath, rootPath));
      } else if (entry.name.endsWith(".md") && !entry.name.startsWith("_")) {
        const stat = statSync(fullPath);
        const title = entry.name.replace(/\.md$/, "");
        const relativePath = fullPath.slice(rootPath.length + 1);
        files.push({ title, relativePath, mtime: stat.mtimeMs });
      }
    }
  } catch {
    // Directory might not exist or be readable
  }
  return files;
}

function findFrontmatterEnd(content: string): number {
  if (!content.startsWith("---")) return 0;
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return 0;
  return endIdx + 3;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
