import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statSync,
} from "fs";
import { join } from "path";
import { projectDir, backupDirPath } from "./paths";
import type { BackupInfo } from "../types/backup";

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${mo}${d}-${h}${mi}${s}${ms}`;
}

function copyDirectoryFiles(
  srcDir: string,
  destDir: string,
  excludeDirs: string[]
): void {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (excludeDirs.includes(entry.name)) continue;
      copyDirectoryFiles(
        join(srcDir, entry.name),
        join(destDir, entry.name),
        excludeDirs
      );
    } else if (entry.isFile()) {
      writeFileSync(
        join(destDir, entry.name),
        readFileSync(join(srcDir, entry.name))
      );
    }
  }
}

export function createBackup(cwd: string): string {
  const base = `backup-${formatTimestamp(new Date())}`;
  const dir = backupDirPath(cwd);
  let name = base;
  let suffix = 1;
  while (existsSync(join(dir, name))) {
    name = `${base}-${suffix}`;
    suffix++;
  }
  const src = projectDir(cwd);
  const dest = join(dir, name);
  copyDirectoryFiles(src, dest, ["backups"]);
  return name;
}

export function listBackups(cwd: string): BackupInfo[] {
  const dir = backupDirPath(cwd);
  if (!existsSync(dir)) return [];

  const entries = readdirSync(dir, { withFileTypes: true });
  const backups: BackupInfo[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("backup-")) continue;

    const backupPath = join(dir, entry.name);
    const match = entry.name.match(
      /^backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})?(?:-\d+)?$/
    );
    let timestamp: Date;
    if (match) {
      timestamp = new Date(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3]),
        parseInt(match[4]),
        parseInt(match[5]),
        parseInt(match[6]),
        match[7] ? parseInt(match[7]) : 0
      );
    } else {
      timestamp = statSync(backupPath).mtime;
    }

    let fileCount = 0;
    try {
      fileCount = readdirSync(backupPath).length;
    } catch {
      // ignore
    }

    backups.push({ name: entry.name, timestamp, path: backupPath, fileCount });
  }

  backups.sort((a, b) => {
    const timeDiff = b.timestamp.getTime() - a.timestamp.getTime();
    if (timeDiff !== 0) return timeDiff;
    // Same timestamp — sort by name descending so suffixed names come first
    return b.name.localeCompare(a.name);
  });
  return backups;
}

export function restoreBackup(cwd: string, backupName: string): void {
  const backupPath = join(backupDirPath(cwd), backupName);
  if (!existsSync(backupPath)) {
    throw new Error(`backup not found: ${backupName}`);
  }

  // Create a safety backup before restoring
  createBackup(cwd);

  // Copy files from backup to project dir, excluding backups/
  copyDirectoryFiles(backupPath, projectDir(cwd), ["backups"]);
}
