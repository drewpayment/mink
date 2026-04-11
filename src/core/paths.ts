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

export function tokenLedgerPath(cwd: string): string {
  return join(projectDir(cwd), "token-ledger.json");
}

export function tokenLedgerArchivePath(cwd: string): string {
  return join(projectDir(cwd), "token-ledger-archive.json");
}

export function bugMemoryPath(cwd: string): string {
  return join(projectDir(cwd), "bug-memory.json");
}

export function actionLogPath(cwd: string): string {
  return join(projectDir(cwd), "action-log.md");
}

export function schedulerPidPath(): string {
  return join(MINK_ROOT, "scheduler.pid");
}

export function schedulerLogPath(): string {
  return join(MINK_ROOT, "scheduler.log");
}

export function schedulerManifestPath(cwd: string): string {
  return join(projectDir(cwd), "scheduler-manifest.json");
}

export function globalConfigPath(): string {
  return join(MINK_ROOT, "config");
}

export function projectMetaPath(cwd: string): string {
  return join(projectDir(cwd), "project-meta.json");
}

export function backupDirPath(cwd: string): string {
  return join(projectDir(cwd), "backups");
}

export function designCapturesDir(cwd: string): string {
  return join(projectDir(cwd), "design-captures");
}

export function designReportPath(cwd: string): string {
  return join(projectDir(cwd), "design-report.json");
}

export function frameworkAdvisorPath(cwd: string): string {
  return join(projectDir(cwd), "framework-advisor.md");
}

export function frameworkAdvisorJsonPath(cwd: string): string {
  return join(projectDir(cwd), "framework-advisor.json");
}
