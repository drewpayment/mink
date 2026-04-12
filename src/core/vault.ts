import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";
import { resolveConfigValue } from "./global-config";
import { safeReadJson } from "./fs-utils";
import type { VaultManifest } from "../types/note";

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
