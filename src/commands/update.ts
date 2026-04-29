import { resolve } from "path";
import { listRegisteredProjects } from "../core/project-registry";
import { createBackup } from "../core/backup";
import { projectMetaPath } from "../core/paths";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";
import { buildHooksConfig, mergeHooksIntoSettings, resolveCliPath } from "./init";

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

  for (const target of targets) {
    console.log(`[mink] updating: ${target.name} (${target.id})`);

    if (dryRun) {
      console.log("  [dry-run] would update hooks and project metadata");
      console.log(`  [dry-run] would create backup before changes`);
      continue;
    }

    // Create backup
    const backupName = createBackup(target.cwd);
    console.log(`  backup: ${backupName}`);

    // Update hooks
    const settingsPath = resolve(target.cwd, ".claude", "settings.json");
    mergeHooksIntoSettings(settingsPath, newHooks);
    console.log("  hooks: updated");

    // Update project meta
    const metaPath = projectMetaPath(target.cwd);
    const existing = safeReadJson(metaPath) as Record<string, unknown> | null;
    atomicWriteJson(metaPath, {
      ...(existing ?? {}),
      cwd: target.cwd,
      name: target.name,
      version: "0.1.0",
    });
    console.log("  metadata: updated");
  }

  if (!dryRun) {
    console.log(`[mink] ${targets.length} project(s) updated`);
  }
}
