import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { minkRoot } from "./paths";
import { safeReadJson, atomicWriteJson } from "./fs-utils";

// ── Project metadata ──────────────────────────────────────────────────────
//
// `project-meta.json` records who/what/when about a project's state directory.
// The schema evolved across sync versions:
//
//   v1/v2: { cwd, name, initTimestamp, version, projectType? }
//   v3:    adds { aliases: string[], pathsByDevice: Record<deviceId, cwd> }
//
// `cwd` is preserved on disk for forward-compat with older mink versions that
// downgrade after a v3 migration — they continue to read it. New code prefers
// `pathsByDevice[deviceId]` and treats `cwd` as a single-device fallback.

export interface ProjectMeta {
  cwd: string;
  name: string;
  initTimestamp: string;
  version: string;
  aliases?: string[];
  pathsByDevice?: Record<string, string>;
}

export interface RegisteredProject {
  id: string;
  cwd: string;
  name: string;
  version: string;
  aliases: string[];
  pathsByDevice: Record<string, string>;
}

function projectMetaFilePath(projDir: string): string {
  return join(projDir, "project-meta.json");
}

export function getProjectMeta(projDir: string): ProjectMeta | null {
  const raw = safeReadJson(projectMetaFilePath(projDir));
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.cwd !== "string" || typeof obj.name !== "string") return null;

  const aliases = Array.isArray(obj.aliases)
    ? (obj.aliases as unknown[]).filter((s): s is string => typeof s === "string")
    : undefined;

  const pathsByDevice =
    obj.pathsByDevice &&
    typeof obj.pathsByDevice === "object" &&
    !Array.isArray(obj.pathsByDevice)
      ? Object.fromEntries(
          Object.entries(obj.pathsByDevice as Record<string, unknown>).filter(
            ([, v]) => typeof v === "string"
          ) as [string, string][]
        )
      : undefined;

  return {
    cwd: obj.cwd as string,
    name: obj.name as string,
    initTimestamp: (obj.initTimestamp as string) ?? "",
    version: (obj.version as string) ?? "0.1.0",
    aliases,
    pathsByDevice,
  };
}

// Idempotently records `aliasId` on the project at `projDir`. Preserves the
// existing alias list, deduplicates, and preserves any unknown fields on the
// metadata record so a future-version downgrade doesn't lose data.
export function addProjectAlias(projDir: string, aliasId: string): boolean {
  const path = projectMetaFilePath(projDir);
  const raw = safeReadJson(path);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  const existing = Array.isArray(obj.aliases)
    ? (obj.aliases as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  if (existing.includes(aliasId)) return false;
  obj.aliases = [...existing, aliasId];
  atomicWriteJson(path, obj);
  return true;
}

// Writes the working-copy path for the given device into the per-device map.
// Reads the existing map (or seeds it from the legacy singular `cwd` field if
// no map exists yet) and writes the merged result back. Preserves unknown fields.
export function setProjectPathForDevice(
  projDir: string,
  deviceId: string,
  cwd: string
): void {
  const path = projectMetaFilePath(projDir);
  const raw = safeReadJson(path);
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const obj = raw as Record<string, unknown>;
  const existing =
    obj.pathsByDevice &&
    typeof obj.pathsByDevice === "object" &&
    !Array.isArray(obj.pathsByDevice)
      ? { ...(obj.pathsByDevice as Record<string, string>) }
      : {};
  // Seed the map from the legacy singular cwd so the first device-keyed write
  // doesn't drop the prior single-device path on the floor.
  if (
    Object.keys(existing).length === 0 &&
    typeof obj.cwd === "string" &&
    obj.cwd !== cwd
  ) {
    existing[deviceId] = obj.cwd;
  }
  existing[deviceId] = cwd;
  obj.pathsByDevice = existing;
  // Keep `cwd` in sync as the local-machine fallback so older versions still
  // read a meaningful value after a downgrade.
  obj.cwd = cwd;
  atomicWriteJson(path, obj);
}

export function listRegisteredProjects(): RegisteredProject[] {
  const projectsDir = join(minkRoot(), "projects");
  if (!existsSync(projectsDir)) return [];

  const entries = readdirSync(projectsDir, { withFileTypes: true });
  const projects: RegisteredProject[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projDir = join(projectsDir, entry.name);
    const meta = getProjectMeta(projDir);
    if (meta) {
      projects.push({
        id: entry.name,
        cwd: meta.cwd,
        name: meta.name,
        version: meta.version,
        aliases: meta.aliases ?? [],
        pathsByDevice: meta.pathsByDevice ?? {},
      });
    }
  }

  return projects;
}

// Scans every project directory for one whose on-disk name or alias list matches
// `id`. Returns the on-disk project directory or null. Used by paths.ts to
// tolerate historical references after migration renames the project's
// directory.
export function findProjectDirByIdOrAlias(id: string): string | null {
  const projectsDir = join(minkRoot(), "projects");
  if (!existsSync(projectsDir)) return null;

  const primary = join(projectsDir, id);
  if (existsSync(primary)) return primary;

  let entries: string[];
  try {
    entries = readdirSync(projectsDir);
  } catch {
    return null;
  }

  for (const name of entries) {
    const projDir = join(projectsDir, name);
    const meta = getProjectMeta(projDir);
    if (meta?.aliases?.includes(id)) return projDir;
  }
  return null;
}
