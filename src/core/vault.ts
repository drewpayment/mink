import { join, basename, resolve } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, symlinkSync, unlinkSync, lstatSync, readlinkSync } from "fs";
import { resolveConfigValue } from "./global-config";
import { safeReadJson } from "./fs-utils";
import { atomicWriteJson } from "./fs-utils";
import type { VaultManifest, VaultLink } from "../types/note";

const DEFAULT_VAULT_PATH = join(homedir(), ".mink", "wiki");

export function resolveVaultPath(): string {
  const resolved = resolveConfigValue("wiki.path");
  const raw = resolved.value;
  if (raw.startsWith("~/")) {
    return join(homedir(), raw.slice(2));
  }
  return raw;
}

export function vaultRoot(): string {
  return resolveVaultPath();
}

export function vaultInbox(): string {
  return join(resolveVaultPath(), "inbox");
}

export function vaultProjects(slug?: string): string {
  const base = join(resolveVaultPath(), "projects");
  return slug ? join(base, slug) : base;
}

export function vaultAreas(): string {
  return join(resolveVaultPath(), "areas");
}

export function vaultDailyDir(): string {
  return join(resolveVaultPath(), "areas", "daily");
}

export function vaultResources(): string {
  return join(resolveVaultPath(), "resources");
}

export function vaultArchives(): string {
  return join(resolveVaultPath(), "archives");
}

export function vaultTemplates(): string {
  return join(resolveVaultPath(), "templates");
}

export function vaultPatterns(): string {
  return join(resolveVaultPath(), "patterns");
}

export function vaultManifestPath(): string {
  return join(resolveVaultPath(), ".mink-vault.json");
}

export function vaultIndexPath(): string {
  return join(resolveVaultPath(), ".mink-index.json");
}

export function vaultMasterIndexPath(): string {
  return join(resolveVaultPath(), "_index.md");
}

export function isVaultInitialized(): boolean {
  return existsSync(vaultManifestPath());
}

export function isInsideVault(cwd: string): boolean {
  const vault = resolveVaultPath();
  const normalizedCwd = cwd.replace(/\/+$/, "");
  const normalizedVault = vault.replace(/\/+$/, "");
  return (
    normalizedCwd === normalizedVault ||
    normalizedCwd.startsWith(normalizedVault + "/")
  );
}

export function isWikiEnabled(): boolean {
  const resolved = resolveConfigValue("wiki.enabled");
  return resolved.value === "true";
}

export function loadVaultManifest(): VaultManifest | null {
  const raw = safeReadJson(vaultManifestPath());
  if (raw === null || typeof raw !== "object") return null;
  return raw as VaultManifest;
}

const VAULT_DIRS = [
  "",
  "inbox",
  "projects",
  "areas",
  "areas/daily",
  "resources",
  "archives",
  "templates",
  "patterns",
];

export function ensureVaultStructure(): void {
  const root = resolveVaultPath();
  for (const dir of VAULT_DIRS) {
    mkdirSync(join(root, dir), { recursive: true });
  }
}

export function categoryToDir(
  category: string,
  projectSlug?: string
): string {
  const root = resolveVaultPath();
  switch (category) {
    case "projects":
      return projectSlug
        ? join(root, "projects", projectSlug)
        : join(root, "projects");
    case "areas":
      return join(root, "areas");
    case "resources":
      return join(root, "resources");
    case "archives":
      return join(root, "archives");
    case "inbox":
    default:
      return join(root, "inbox");
  }
}

// ── Symlink management ────────────────────────────────────────────────────

function saveManifest(manifest: VaultManifest): void {
  atomicWriteJson(vaultManifestPath(), manifest);
}

export function linkExternal(targetPath: string, name?: string): { ok: true; linkName: string; linkPath: string } | { ok: false; error: string } {
  const root = resolveVaultPath();
  const absTarget = targetPath.startsWith("~/")
    ? join(homedir(), targetPath.slice(2))
    : resolve(targetPath);

  if (!existsSync(absTarget)) {
    return { ok: false, error: `target does not exist: ${absTarget}` };
  }

  if (!lstatSync(absTarget).isDirectory()) {
    return { ok: false, error: `target is not a directory: ${absTarget}` };
  }

  const linkName = name ?? basename(absTarget);
  const linkPath = join(root, linkName);

  // Don't overwrite existing vault directories
  if (existsSync(linkPath)) {
    if (lstatSync(linkPath).isSymbolicLink()) {
      const existing = readlinkSync(linkPath);
      if (existing === absTarget) {
        return { ok: false, error: `already linked: ${linkName} -> ${absTarget}` };
      }
      return { ok: false, error: `a different link already exists at ${linkName} -> ${existing}` };
    }
    return { ok: false, error: `${linkName} already exists in the vault and is not a symlink` };
  }

  symlinkSync(absTarget, linkPath, "dir");

  // Record in manifest
  const manifest = loadVaultManifest();
  if (manifest) {
    const links = manifest.links ?? [];
    links.push({ name: linkName, target: absTarget, linkedAt: new Date().toISOString() });
    manifest.links = links;
    saveManifest(manifest);
  }

  return { ok: true, linkName, linkPath };
}

export function unlinkExternal(name: string): { ok: true } | { ok: false; error: string } {
  const root = resolveVaultPath();
  const linkPath = join(root, name);

  if (!existsSync(linkPath)) {
    return { ok: false, error: `no link named "${name}" in the vault` };
  }

  if (!lstatSync(linkPath).isSymbolicLink()) {
    return { ok: false, error: `"${name}" is not a symlink — refusing to remove` };
  }

  unlinkSync(linkPath);

  // Remove from manifest
  const manifest = loadVaultManifest();
  if (manifest && manifest.links) {
    manifest.links = manifest.links.filter(l => l.name !== name);
    saveManifest(manifest);
  }

  return { ok: true };
}

export function listLinks(): VaultLink[] {
  const manifest = loadVaultManifest();
  return manifest?.links ?? [];
}
