import { listBackups, restoreBackup } from "../core/backup";

export function restore(cwd: string, args: string[]): void {
  const backupName = args[0];

  if (!backupName) {
    // List available backups
    const backups = listBackups(cwd);
    if (backups.length === 0) {
      console.log("[mink] no backups available");
      return;
    }

    console.log("[mink] available backups:");
    for (const b of backups) {
      console.log(
        `  ${b.name}  (${b.timestamp.toISOString().replace("T", " ").slice(0, 19)}, ${b.fileCount} files)`
      );
    }
    return;
  }

  try {
    restoreBackup(cwd, backupName);
    console.log(`[mink] restored from: ${backupName}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[mink] restore failed: ${msg}`);
    process.exit(1);
  }
}
