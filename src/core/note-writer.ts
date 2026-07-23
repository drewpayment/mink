import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { atomicWriteText, safeAppendText } from "./fs-utils";
import { categoryToDir, vaultDailyDir, vaultTemplates } from "./vault";
import { loadTemplate } from "./vault-templates";
import { getOrCreateDeviceId } from "./device";
import type { NoteMetadata, NoteFrontmatter, NoteCategory } from "../types/note";

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

  const filePath = resolveUniqueNotePath(dir, slug, content);
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

// Inserts (or extends) an `aliases:` line in an existing note's frontmatter
// without rewriting anything else — used by `mink wiki doctor --fix` to
// backfill aliases on notes whose title/H1 differs from their filename slug.
// Preserves every other frontmatter line verbatim (key order, quoting style,
// unknown custom fields) so re-running the doctor is a byte-for-byte no-op
// once aliases exist.
export function upsertFrontmatterAliases(
  content: string,
  aliases: string[]
): string {
  const firstLineEnd = content.indexOf("\n");
  if (firstLineEnd === -1) return content;
  // Require the first line to be *exactly* "---" (mind a trailing \r on
  // CRLF files) — content.startsWith("---") alone also matches a "----"
  // rule or a "---foo" line, and more importantly would treat a markdown
  // thematic break at the top of a body as frontmatter, splicing aliases
  // into prose. Trimmed comparison rejects both.
  if (content.slice(0, firstLineEnd).trim() !== "---") return content;
  const closeIdx = content.indexOf("\n---", firstLineEnd);
  if (closeIdx === -1) return content;

  const fmBody = content.slice(firstLineEnd + 1, closeIdx);
  const rest = content.slice(closeIdx); // "\n---\n\n# Title..."
  // Strip a trailing \r per line so CRLF input normalizes to LF in the
  // frontmatter block we rebuild (the untouched body after `rest` keeps
  // whatever line endings it already had).
  const lines = fmBody.split("\n").map((l) => l.replace(/\r$/, ""));

  // A "---" thematic break followed by ordinary prose (no `key:` lines)
  // isn't frontmatter either — bail rather than guess.
  if (!lines.some((l) => /^\S+:/.test(l))) return content;

  const aliasLineIdx = lines.findIndex((l) => /^aliases:\s*\[/.test(l));

  if (aliasLineIdx !== -1) {
    // Merge with the existing inline array, de-duping case-insensitively.
    const match = lines[aliasLineIdx].match(/^aliases:\s*\[(.*)\]\s*$/);
    const existing = match
      ? match[1]
          .split(",")
          .map((a) => a.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean)
      : [];
    const merged = [...existing];
    const seen = new Set(existing.map((a) => a.toLowerCase()));
    for (const alias of aliases) {
      if (!seen.has(alias.toLowerCase())) {
        seen.add(alias.toLowerCase());
        merged.push(alias);
      }
    }
    lines[aliasLineIdx] = `aliases: [${merged.map(formatAliasValue).join(", ")}]`;
  } else {
    lines.push(`aliases: [${aliases.map(formatAliasValue).join(", ")}]`);
  }

  return `---\n${lines.join("\n")}${rest}`;
}

// YAML flow-sequence values need quoting whenever they contain a character
// that's structurally significant inside `[a, b, c]` — not just the comma/
// bracket/quote set tags happen to avoid in practice. In particular a bare
// ": " (or a trailing ":") inside a flow scalar reopens it as a nested
// mapping (`aliases: [Chapter 1: Intro]` parses as `Chapter 1` mapping to
// `Intro`, not a single string) — proven with exactly that title. Quote
// whenever the value contains any YAML flow/indicator character, starts
// with a flow-significant prefix, or has leading/trailing whitespace.
function formatAliasValue(value: string): string {
  const needsQuoting =
    value === "" ||
    value !== value.trim() ||
    /[,\[\]{}:#&*!|>'"%@`]/.test(value) ||
    /^[-?]\s|^[-?]$/.test(value);
  return needsQuoting ? JSON.stringify(value) : value;
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
  const filePath = resolveUniqueNotePath(dir, slug, content);
  atomicWriteText(filePath, content);
  return { filePath, content };
}
