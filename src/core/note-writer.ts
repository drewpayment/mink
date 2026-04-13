import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { atomicWriteText } from "./fs-utils";
import { categoryToDir, vaultDailyDir, vaultTemplates } from "./vault";
import { loadTemplate } from "./vault-templates";
import type { NoteMetadata, NoteFrontmatter, NoteCategory } from "../types/note";

export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export function generateFrontmatter(meta: {
  created: string;
  updated: string;
  tags: string[];
  category: NoteCategory;
  sourceProject?: string;
  aliases?: string[];
  extra?: Record<string, unknown>;
}): string {
  const lines: string[] = ["---"];
  lines.push(`created: "${meta.created}"`);
  lines.push(`updated: "${meta.updated}"`);

  if (meta.tags.length > 0) {
    lines.push(`tags: [${meta.tags.join(", ")}]`);
  } else {
    lines.push("tags: []");
  }

  lines.push(`category: ${meta.category}`);

  if (meta.sourceProject) {
    lines.push(`source_project: ${meta.sourceProject}`);
  }

  if (meta.aliases && meta.aliases.length > 0) {
    lines.push(`aliases: [${meta.aliases.join(", ")}]`);
  }

  if (meta.extra) {
    for (const [key, value] of Object.entries(meta.extra)) {
      lines.push(`${key}: ${JSON.stringify(value)}`);
    }
  }

  lines.push("---");
  return lines.join("\n");
}

export function createNote(meta: NoteMetadata): {
  filePath: string;
  content: string;
} {
  const now = meta.created || new Date().toISOString();
  const slug = slugifyTitle(meta.title);
  const dir = categoryToDir(meta.category, meta.projectSlug);
  const filePath = join(dir, `${slug}.md`);

  let content: string;

  if (meta.template) {
    const rendered = loadTemplate(vaultTemplates(), meta.template, {
      title: meta.title,
      body: meta.body,
      created: now,
      updated: now,
      date: now.split("T")[0],
    });
    content = rendered ?? buildNoteContent(meta, now);
  } else {
    content = buildNoteContent(meta, now);
  }

  atomicWriteText(filePath, content);
  return { filePath, content };
}

function buildNoteContent(meta: NoteMetadata, now: string): string {
  const frontmatter = generateFrontmatter({
    created: now,
    updated: now,
    tags: meta.tags,
    category: meta.category,
    sourceProject: meta.sourceProject,
  });

  return `${frontmatter}

# ${meta.title}

${meta.body}
`;
}

export function appendToDaily(date: string, content: string): string {
  const dir = vaultDailyDir();
  const filePath = join(dir, `${date}.md`);

  if (existsSync(filePath)) {
    const existing = readFileSync(filePath, "utf-8");
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const updated = `${existing.trimEnd()}\n\n## ${timestamp}\n\n${content}\n`;
    atomicWriteText(filePath, updated);
  } else {
    const now = new Date().toISOString();
    const rendered = loadTemplate(vaultTemplates(), "daily-note", {
      title: date,
      date,
      body: content,
      created: now,
      updated: now,
    });
    const noteContent =
      rendered ??
      `---
created: "${now}"
updated: "${now}"
tags: [daily]
category: areas
---

# ${date}

${content}
`;
    atomicWriteText(filePath, noteContent);
  }

  return filePath;
}

export function ingestFile(
  sourcePath: string,
  meta: {
    category: NoteCategory;
    tags?: string[];
    projectSlug?: string;
    sourceProject?: string;
  }
): { filePath: string; content: string } {
  const raw = readFileSync(sourcePath, "utf-8");
  const now = new Date().toISOString();

  // Extract title from first heading or filename
  const headingMatch = raw.match(/^#\s+(.+)$/m);
  const title =
    headingMatch?.[1] ??
    sourcePath
      .split("/")
      .pop()!
      .replace(/\.md$/, "");

  // Check if file already has frontmatter
  const hasFrontmatter = raw.startsWith("---");
  let content: string;

  if (hasFrontmatter) {
    // Preserve existing frontmatter, add missing fields
    const endIdx = raw.indexOf("---", 3);
    if (endIdx !== -1) {
      const existingFm = raw.slice(0, endIdx + 3);
      const body = raw.slice(endIdx + 3).trim();
      // Add category if missing
      if (!existingFm.includes("category:")) {
        const updatedFm = existingFm.replace(
          /---$/,
          `category: ${meta.category}\n---`
        );
        content = `${updatedFm}\n\n${body}\n`;
      } else {
        content = raw;
      }
    } else {
      content = raw;
    }
  } else {
    const frontmatter = generateFrontmatter({
      created: now,
      updated: now,
      tags: meta.tags ?? [],
      category: meta.category,
      sourceProject: meta.sourceProject,
    });
    content = `${frontmatter}\n\n${raw}`;
  }

  const slug = slugifyTitle(title);
  const dir = categoryToDir(meta.category, meta.projectSlug);
  const filePath = join(dir, `${slug}.md`);
  atomicWriteText(filePath, content);
  return { filePath, content };
}
