import { existsSync, statSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import {
  resolveVaultPath,
  ensureVaultStructure,
  isVaultInitialized,
  vaultManifestPath,
  vaultTemplates,
} from "../core/vault";
import { atomicWriteJson } from "../core/fs-utils";
import { setConfigValue } from "../core/global-config";
import { seedTemplates } from "../core/vault-templates";
import { rebuildVaultIndex, loadVaultIndex } from "../core/note-index";
import { updateMasterIndex } from "../core/note-linker";
import type { VaultManifest, NoteCategory } from "../types/note";

export async function wiki(
  _cwd: string,
  args: string[]
): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "init":
      await wikiInit(args.slice(1));
      break;
    case "status":
      wikiStatus();
      break;
    case "rebuild-index":
      wikiRebuildIndex();
      break;
    case "organize":
      wikiOrganize();
      break;
    default:
      console.log("Usage: mink wiki <init|status|rebuild-index|organize>");
      console.log();
      console.log("  init                Initialize the notes/wiki vault");
      console.log("  status              Show vault statistics");
      console.log("  rebuild-index       Full rescan and reindex of vault");
      console.log("  organize            List inbox notes needing categorization");
      break;
  }
}

async function wikiInit(args: string[]): Promise<void> {
  const pathArg = args[0];

  if (isVaultInitialized()) {
    const vaultPath = resolveVaultPath();
    console.log(`[mink] vault already initialized at ${vaultPath}`);
    console.log("  Run 'mink wiki rebuild-index' to refresh the index.");
    return;
  }

  let targetPath: string;

  if (pathArg) {
    targetPath = expandPath(pathArg);
  } else {
    targetPath = resolveVaultPath();
    console.log(`[mink] initializing vault at ${targetPath}`);
    console.log(
      "  (set a custom path with: mink wiki init /path/to/vault)"
    );
  }

  const isExisting =
    existsSync(targetPath) && statSync(targetPath).isDirectory();

  // Set the config value
  setConfigValue("wiki.path", targetPath);

  // Create vault structure
  ensureVaultStructure();

  // Seed templates
  seedTemplates(vaultTemplates());

  // Create vault manifest
  const manifest: VaultManifest = {
    version: 1,
    createdAt: new Date().toISOString(),
    totalNotes: 0,
    categories: {
      inbox: 0,
      projects: 0,
      areas: 0,
      resources: 0,
      archives: 0,
    },
    lastOrganized: "",
  };

  if (isExisting) {
    console.log(`[mink] scanning existing directory: ${targetPath}`);
    const index = rebuildVaultIndex();
    manifest.totalNotes = index.totalNotes;

    // Count by category
    for (const entry of Object.values(index.entries)) {
      if (manifest.categories[entry.category] !== undefined) {
        manifest.categories[entry.category]++;
      }
    }

    // Flag potential garbage
    const suspicious = Object.values(index.entries).filter((e) => {
      const name = e.filePath.split("/").pop() ?? "";
      return (
        e.estimatedTokens < 15 ||
        name.length > 30 && /[A-Za-z0-9_-]{20,}/.test(name.replace(/\.md$/, ""))
      );
    });

    if (suspicious.length > 0) {
      console.log();
      console.log(
        `  [review] ${suspicious.length} files may need attention:`
      );
      for (const s of suspicious.slice(0, 10)) {
        console.log(`    - ${s.filePath} (${s.estimatedTokens} tokens)`);
      }
      if (suspicious.length > 10) {
        console.log(`    ... and ${suspicious.length - 10} more`);
      }
    }

    console.log();
    console.log(
      `  indexed ${index.totalNotes} notes across the vault`
    );
  } else {
    console.log(`[mink] created new vault at ${targetPath}`);
  }

  atomicWriteJson(vaultManifestPath(), manifest);
  updateMasterIndex(targetPath);

  console.log();
  console.log(`[mink] vault initialized`);
  console.log(`  path:      ${targetPath}`);
  console.log(`  templates: ${vaultTemplates()}`);
  console.log(`  manifest:  ${vaultManifestPath()}`);
  console.log();
  console.log("  Next steps:");
  console.log("    mink note \"your first note\"");
  console.log("    mink note --daily");
  console.log("    mink skill install     # install /mink:note skill for Claude Code");
}

function wikiStatus(): void {
  if (!isVaultInitialized()) {
    console.log("[mink] no vault initialized");
    console.log("  Run 'mink wiki init' to get started.");
    return;
  }

  const vaultPath = resolveVaultPath();
  const index = loadVaultIndex();

  const categoryCounts: Record<string, number> = {
    inbox: 0,
    projects: 0,
    areas: 0,
    resources: 0,
    archives: 0,
  };

  for (const entry of Object.values(index.entries)) {
    if (categoryCounts[entry.category] !== undefined) {
      categoryCounts[entry.category]++;
    }
  }

  console.log("[mink] vault status");
  console.log(`  path:    ${vaultPath}`);
  console.log(`  notes:   ${index.totalNotes}`);
  console.log();
  console.log("  Categories:");
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`    ${cat.padEnd(12)} ${count}`);
  }
  console.log();
  console.log(
    `  last indexed: ${index.lastScanTimestamp || "never"}`
  );

  if (categoryCounts.inbox > 0) {
    console.log();
    console.log(
      `  ${categoryCounts.inbox} notes in inbox need categorization`
    );
  }
}

function wikiRebuildIndex(): void {
  if (!isVaultInitialized()) {
    console.log("[mink] no vault initialized");
    return;
  }

  console.log("[mink] rebuilding vault index...");
  const index = rebuildVaultIndex();
  updateMasterIndex(resolveVaultPath());
  console.log(`  indexed ${index.totalNotes} notes`);
}

function wikiOrganize(): void {
  if (!isVaultInitialized()) {
    console.log("[mink] no vault initialized");
    return;
  }

  const index = loadVaultIndex();
  const inboxNotes = Object.values(index.entries).filter(
    (e) => e.category === "inbox"
  );

  if (inboxNotes.length === 0) {
    console.log("[mink] inbox is empty — nothing to organize");
    return;
  }

  console.log(`[mink] ${inboxNotes.length} notes in inbox:`);
  console.log();

  for (const note of inboxNotes) {
    const tags = note.tags.length > 0 ? ` [${note.tags.join(", ")}]` : "";
    console.log(`  ${note.filePath}`);
    console.log(`    ${note.title}${tags}`);
    if (note.description) {
      console.log(`    ${note.description}`);
    }
    console.log();
  }

  console.log(
    "Use '/mink:note' in Claude Code to intelligently categorize these notes."
  );
}

function expandPath(raw: string): string {
  if (raw.startsWith("~/")) {
    return resolve(homedir(), raw.slice(2));
  }
  return resolve(raw);
}
