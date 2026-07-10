import { existsSync } from "fs";
import { resolve } from "path";
import {
  listRegisteredProjects,
  type RegisteredProject,
} from "../core/project-registry";
import { createBackup } from "../core/backup";
import { projectMetaPath } from "../core/paths";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";
import { getOrCreateDeviceId } from "../core/device";
import { buildHooksConfig, mergeHooksIntoSettings, resolveCliPath } from "./init";

// Pick the project's working-copy path for *this* device. When a project has
// `pathsByDevice`, prefer the current device's entry. If the map exists but
// has no entry for us, the project is registered elsewhere — return null so
// the caller skips it (instead of trying to mkdir into a foreign absolute
// path like `/home/<user>/…` on macOS, which fails with ENOTSUP on autofs
// and aborts the batch — see issue #95). Legacy single-device projects with
// no map fall back to the singular `cwd`.
export function resolveLocalCwd(
  project: RegisteredProject,
  deviceId: string
): string | null {
  const map = project.pathsByDevice;
  if (map && Object.keys(map).length > 0) {
    return map[deviceId] ?? null;
  }
  return project.cwd || null;
}

function parseArgs(args: string[]): {
  dryRun: boolean;
  project: string | null;
  list: boolean;
} {
  let dryRun = false;
  let project: string | null = null;
  let list = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--list") list = true;
    else if (args[i] === "--project" && i + 1 < args.length) {
      project = args[++i];
    }
  }

  return { dryRun, project, list };
}

export async function update(cwd: string, args: string[]): Promise<void> {
  const { dryRun, project, list } = parseArgs(args);

  const registered = listRegisteredProjects();

  if (list) {
    if (registered.length === 0) {
      console.log("[mink] no registered projects found");
      console.log("  Run 'mink init' in a project directory to register it.");
      return;
    }
    console.log("[mink] registered projects:");
    console.log(
      "  " +
        "ID".padEnd(30) +
        "Name".padEnd(20) +
        "Version".padEnd(12) +
        "Path"
    );
    console.log("  " + "-".repeat(80));
    for (const p of registered) {
      console.log(
        "  " +
          p.id.padEnd(30) +
          p.name.padEnd(20) +
          p.version.padEnd(12) +
          p.cwd
      );
    }
    return;
  }

  let targets = registered;
  if (project) {
    targets = registered.filter(
      (p) => p.name === project || p.id === project
    );
    if (targets.length === 0) {
      console.error(`[mink] project not found: ${project}`);
      console.error(
        "  Available: " + registered.map((p) => p.name).join(", ")
      );
      process.exit(1);
    }
  }

  if (targets.length === 0) {
    console.log("[mink] no registered projects found");
    console.log("  Run 'mink init' in a project directory to register it.");
    return;
  }

  const cliPath = resolveCliPath();
  const newHooks = buildHooksConfig(cliPath);
  const deviceId = getOrCreateDeviceId();

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const target of targets) {
    console.log(`[mink] updating: ${target.name} (${target.id})`);

    // Resolve the working-copy path for the current device. Cross-device-only
    // projects (registered from another machine) are skipped rather than
    // crashing the batch on a foreign absolute path.
    const localCwd = resolveLocalCwd(target, deviceId);
    if (!localCwd) {
      console.log("  skipped: not registered on this device");
      skipped++;
      continue;
    }
    if (!existsSync(localCwd)) {
      console.log(`  skipped: path missing on this device (${localCwd})`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log("  [dry-run] would update hooks and project metadata");
      console.log(`  [dry-run] would create backup before changes`);
      continue;
    }

    try {
      // Create backup
      const backupName = createBackup(localCwd);
      console.log(`  backup: ${backupName}`);

      // Update hooks
      const settingsPath = resolve(localCwd, ".claude", "settings.json");
      mergeHooksIntoSettings(settingsPath, newHooks);
      console.log("  hooks: updated");

      // Update project meta. Preserve `pathsByDevice` and other v3 fields; only
      // refresh the singular `cwd` (the local-machine fallback) and the name/
      // version bookkeeping so a downgrade still reads a meaningful value.
      const metaPath = projectMetaPath(localCwd);
      const existing = safeReadJson(metaPath) as Record<string, unknown> | null;
      atomicWriteJson(metaPath, {
        ...(existing ?? {}),
        cwd: localCwd,
        name: target.name,
        version: "0.1.0",
      });
      console.log("  metadata: updated");
      updated++;
    } catch (err) {
      // One broken project must not stop the batch. Surface the failure and
      // move on so the rest of the user's projects still get refreshed.
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  failed: ${message}`);
      failed++;
    }
  }

  if (!dryRun) {
    const parts = [`${updated} updated`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (failed > 0) parts.push(`${failed} failed`);
    console.log(`[mink] ${parts.join(", ")}`);
    if (failed > 0) process.exitCode = 1;
  }
}
