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
