import { join } from "path";
import { homedir } from "os";
import { generateProjectId } from "./project-id";

const MINK_ROOT = join(homedir(), ".mink");

export function minkRoot(): string {
  return MINK_ROOT;
}

export function projectDir(cwd: string): string {
  const id = generateProjectId(cwd);
  return join(MINK_ROOT, "projects", id);
}

export function sessionPath(cwd: string): string {
  return join(projectDir(cwd), "session.json");
}

export function fileIndexPath(cwd: string): string {
  return join(projectDir(cwd), "file-index.json");
}

export function configPath(cwd: string): string {
  return join(projectDir(cwd), "config.json");
}

export function learningMemoryPath(cwd: string): string {
  return join(projectDir(cwd), "learning-memory.md");
}
