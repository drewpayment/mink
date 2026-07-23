import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { atomicWriteText, safeAppendText } from "./fs-utils";
import { categoryToDir, vaultDailyDir, vaultTemplates } from "./vault";
import { loadTemplate } from "./vault-templates";
import { getOrCreateDeviceId } from "./device";
import { indexNoteFile } from "./wiki-search";
import type { NoteMetadata, NoteFrontmatter, NoteCategory } from "../types/note";

// Every write path below calls this right after the file lands on disk so
// the FTS5 search index (mink recall, wiki backlinks/related) never drifts
// from what's actually in the vault. Failures here must never break note
// capture itself — worst case a note is briefly missing from `mink recall`
// until the next mtime catch-up sweep repairs it.
function indexAfterWrite(filePath: string, content: string): void {
  try {
    indexNoteFile(filePath, content);
  } catch (err) {
    console.warn(
      `[mink] search index update failed for ${filePath}: ${(err as Error).message}`
    );
  }
}

const MAX_COLLISION_ATTEMPTS = 4;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// Resolve the target path for a note write so two devices creating notes with
// the same slug never overwrite each other. Strategy:
//   1. If the path is free, use it as-is.
//   2. If the path holds the exact same content (idempotent re-save), reuse
//      the path so the write is a no-op.
//   3. Otherwise append a short device suffix and retry. Fall back to a
//      timestamp suffix if the device suffix is also taken.
function resolveUniqueNotePath(
  dir: string,
  baseSlug: string,
  content: string
): string {
  const targetHash = sha256(content);
  const primary = join(dir, `${baseSlug}.md`);
  if (!existsSync(primary)) return primary;
  if (sameContent(primary, targetHash)) return primary;

  const dev4 = getOrCreateDeviceId().replace(/-/g, "").slice(0, 4);
  for (let i = 0; i < MAX_COLLISION_ATTEMPTS; i++) {
    const suffix = i === 0 ? dev4 : `${dev4}-${i + 1}`;
    const candidate = join(dir, `${baseSlug}-${suffix}.md`);
    if (!existsSync(candidate)) return candidate;
    if (sameContent(candidate, targetHash)) return candidate;
  }

  // Final fallback: timestamp suffix (effectively guaranteed unique).
  return join(dir, `${baseSlug}-${Date.now()}.md`);
}

function sameContent(filePath: string, expectedHash: string): boolean {
  try {
    return sha256(readFileSync(filePath, "utf-8")) === expectedHash;
  } catch {
    return false;
  }
}

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

  // Write-time hygiene (phase 1 of the retrieval plan): files are always
  // saved by slug, but notes get linked by display title. Auto-declaring the
  // title as an alias means a `[[Display Title]]` wikilink resolves even
  // though the file on disk is `display-title.md` — this is what keeps
  // links from going dead the moment someone types the natural-language
  // title instead of the exact slug.
  const aliases = slug !== meta.title ? [meta.title] : undefined;

  let content: string;

  if (meta.template) {
    const rendered = loadTemplate(vaultTemplates(), meta.template, {
      title: meta.title,
      body: meta.body,
      created: now,
      updated: now,
      date: now.split("T")[0],
    });
    content = rendered ?? buildNoteContent(meta, now, aliases);
  } else {
    content = buildNoteContent(meta, now, aliases);
  }

  const filePath = resolveUniqueNotePath(dir, slug, content);
  atomicWriteText(filePath, content);
  indexAfterWrite(filePath, content);
  return { filePath, content };
}

function buildNoteContent(meta: NoteMetadata, now: string, aliases?: string[]): string {
  const frontmatter = generateFrontmatter({
    created: now,
    updated: now,
    tags: meta.tags,
    category: meta.category,
    sourceProject: meta.sourceProject,
    aliases,
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
    // Append-only so `merge=union` cleanly resolves cross-device daily entries
    // — full-file rewrites would defeat union merging and reintroduce conflict
    // markers when two devices append on the same day.
    const timestamp = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    safeAppendText(filePath, `\n\n## ${timestamp}\n\n${content}\n`);
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

  // Re-read so an append (which only writes a fragment) still indexes the
  // full current file content, not just the fragment just appended.
  indexAfterWrite(filePath, readFileSync(filePath, "utf-8"));
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

  const slug = slugifyTitle(title);

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
    // Same write-time alias hygiene as createNote(): the file lands at its
    // slug, so declare the extracted title as an alias when the two differ.
    const aliases = slug !== title ? [title] : undefined;
    const frontmatter = generateFrontmatter({
      created: now,
      updated: now,
      tags: meta.tags ?? [],
      category: meta.category,
      sourceProject: meta.sourceProject,
      aliases,
    });
    content = `${frontmatter}\n\n${raw}`;
  }

  const dir = categoryToDir(meta.category, meta.projectSlug);
  const filePath = resolveUniqueNotePath(dir, slug, content);
  atomicWriteText(filePath, content);
  indexAfterWrite(filePath, content);
  return { filePath, content };
}
