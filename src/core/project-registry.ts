import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { minkRoot } from "./paths";
import { safeReadJson } from "./fs-utils";

export interface ProjectMeta {
  cwd: string;
  name: string;
  initTimestamp: string;
  version: string;
}

export interface RegisteredProject {
  id: string;
  cwd: string;
  name: string;
  version: string;
}

export function getProjectMeta(projDir: string): ProjectMeta | null {
  const metaPath = join(projDir, "project-meta.json");
  const raw = safeReadJson(metaPath);
  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.cwd !== "string" || typeof obj.name !== "string") {
    return null;
  }
  return {
    cwd: obj.cwd as string,
    name: obj.name as string,
    initTimestamp: (obj.initTimestamp as string) ?? "",
    version: (obj.version as string) ?? "0.1.0",
  };
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
      });
    }
  }

  return projects;
}
