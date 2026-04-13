import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import {
  isVaultInitialized,
  isWikiEnabled,
  resolveVaultPath,
} from "../core/vault";
import { resolveConfigValue } from "../core/global-config";
import { generateProjectId } from "../core/project-id";
import {
  createNote,
  appendToDaily,
  ingestFile,
  slugifyTitle,
} from "../core/note-writer";
import {
  updateVaultIndexForFile,
  searchVaultIndex,
  getRecentNotes,
  loadVaultIndex,
} from "../core/note-index";
import { updateMasterIndex } from "../core/note-linker";
import type { NoteCategory, NoteMetadata } from "../types/note";

export async function note(
  cwd: string,
  args: string[]
): Promise<void> {
  if (!isWikiEnabled()) {
    console.error("[mink] wiki feature is disabled");
    console.error("  Enable with: mink config wiki.enabled true");
    process.exit(1);
  }

  if (!isVaultInitialized()) {
    console.error("[mink] vault not initialized");
    console.error("  Run 'mink wiki init' first.");
    process.exit(1);
  }

  // Handle subcommands
  if (args[0] === "list") {
    noteList(args.slice(1));
    return;
  }
  if (args[0] === "search") {
    noteSearch(args.slice(1).join(" "));
    return;
  }

  // Parse flags
  const parsed = parseNoteArgs(args);

  // Handle daily note
  if (parsed.daily) {
    const date = new Date().toISOString().split("T")[0];
    const content = parsed.positional || parsed.body || "";
    const filePath = appendToDaily(date, content);
    updateVaultIndexForFile(
      filePath,
      readFileSync(filePath, "utf-8")
    );
    console.log(`[mink] daily note: ${filePath}`);
    return;
  }

  // Handle file ingestion
  if (parsed.file) {
    const sourcePath = resolve(cwd, parsed.file);
    if (!existsSync(sourcePath)) {
      console.error(`[mink] file not found: ${sourcePath}`);
      process.exit(1);
    }
    const result = ingestFile(sourcePath, {
      category: parsed.category,
      tags: parsed.tags,
      projectSlug: parsed.project,
      sourceProject: detectSourceProject(cwd),
    });
    updateVaultIndexForFile(result.filePath, result.content);
    console.log(`[mink] ingested: ${result.filePath}`);
    return;
  }

  // Regular note creation
  const title =
    parsed.title ||
    (parsed.positional
      ? parsed.positional.split("\n")[0].slice(0, 80)
      : `note-${Date.now()}`);

  const body = parsed.body || parsed.positional || "";

  const meta: NoteMetadata = {
    title,
    category: parsed.category,
    tags: parsed.tags,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    template: parsed.template,
    projectSlug: parsed.project,
    sourceProject: detectSourceProject(cwd),
    body,
  };

  const result = createNote(meta);
  updateVaultIndexForFile(result.filePath, result.content);
  updateMasterIndex(resolveVaultPath());

  const tagsStr =
    meta.tags.length > 0 ? ` [${meta.tags.join(", ")}]` : "";
  console.log(
    `[mink] note saved: ${result.filePath}${tagsStr}`
  );
}

interface ParsedNoteArgs {
  title: string;
  body: string;
  category: NoteCategory;
  tags: string[];
  project: string;
  template: string;
  daily: boolean;
  file: string;
  positional: string;
}

function parseNoteArgs(args: string[]): ParsedNoteArgs {
  const result: ParsedNoteArgs = {
    title: "",
    body: "",
    category: resolveConfigValue("notes.default-category").value as NoteCategory,
    tags: [],
    project: "",
    template: "",
    daily: false,
    file: "",
    positional: "",
  };

  const positionalParts: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg === "--title" && i + 1 < args.length) {
      result.title = args[++i];
    } else if (arg === "--body" && i + 1 < args.length) {
      result.body = args[++i];
    } else if (arg === "--category" && i + 1 < args.length) {
      result.category = args[++i] as NoteCategory;
    } else if (arg === "--tags" && i + 1 < args.length) {
      result.tags = args[++i].split(",").map((t) => t.trim()).filter(Boolean);
    } else if (arg === "--project" && i + 1 < args.length) {
      result.project = args[++i];
      if (result.category === "inbox") {
        result.category = "projects";
      }
    } else if (arg === "--template" && i + 1 < args.length) {
      result.template = args[++i];
    } else if (arg === "--daily") {
      result.daily = true;
    } else if (arg === "--file" && i + 1 < args.length) {
      result.file = args[++i];
    } else if (!arg.startsWith("--")) {
      positionalParts.push(arg);
    }

    i++;
  }

  result.positional = positionalParts.join(" ");
  return result;
}

function detectSourceProject(cwd: string): string | undefined {
  try {
    const vaultPath = resolveVaultPath();
    // Don't mark notes created from within the vault itself
    if (cwd.startsWith(vaultPath)) return undefined;
    return generateProjectId(cwd);
  } catch {
    return undefined;
  }
}

function noteList(args: string[]): void {
  const index = loadVaultIndex();
  let entries = Object.values(index.entries);

  // Parse filters
  let categoryFilter = "";
  let tagFilter = "";
  let recent = 20;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--category" && i + 1 < args.length) {
      categoryFilter = args[++i];
    } else if (args[i] === "--tag" && i + 1 < args.length) {
      tagFilter = args[++i];
    } else if (args[i] === "--recent" && i + 1 < args.length) {
      recent = parseInt(args[++i], 10) || 20;
    }
  }

  if (categoryFilter) {
    entries = entries.filter((e) => e.category === categoryFilter);
  }
  if (tagFilter) {
    entries = entries.filter((e) =>
      e.tags.some((t) => t.toLowerCase().includes(tagFilter.toLowerCase()))
    );
  }

  // Sort by last modified, most recent first
  entries.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
  entries = entries.slice(0, recent);

  if (entries.length === 0) {
    console.log("[mink] no notes found");
    return;
  }

  console.log(`[mink] ${entries.length} notes:`);
  console.log();

  for (const entry of entries) {
    const tags =
      entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
    console.log(`  ${entry.category.padEnd(10)} ${entry.title}${tags}`);
    console.log(`             ${entry.filePath}`);
  }
}

function noteSearch(term: string): void {
  if (!term.trim()) {
    console.error("Usage: mink note search <term>");
    process.exit(1);
  }

  const results = searchVaultIndex(term);

  if (results.length === 0) {
    console.log(`[mink] no notes matching "${term}"`);
    return;
  }

  console.log(`[mink] ${results.length} notes matching "${term}":`);
  console.log();

  for (const entry of results.slice(0, 20)) {
    const tags =
      entry.tags.length > 0 ? ` [${entry.tags.join(", ")}]` : "";
    console.log(`  ${entry.category.padEnd(10)} ${entry.title}${tags}`);
    if (entry.description) {
      console.log(`             ${entry.description}`);
    }
    console.log(`             ${entry.filePath}`);
  }

  if (results.length > 20) {
    console.log();
    console.log(`  ... and ${results.length - 20} more results`);
  }
}
