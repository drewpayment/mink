// `mink refresh-hooks [--all]` — regenerate Mink's generated hook wiring after an
// upgrade so it matches the installed version's templates.
//
//   (default)  Refresh the current project.
//   --all      Refresh every registered project that exists on this device.
//
// `--all` is what `runSelfUpgrade` spawns (as the freshly-installed binary) right
// after a successful upgrade, so every project is refreshed eagerly rather than
// waiting for its next session-start.

import { existsSync } from "fs";
import { refreshProjectHooks } from "../core/hook-refresh";

export function refreshHooks(cwd: string, args: string[]): void {
  const all = args.includes("--all");

  if (!all) {
    const r = refreshProjectHooks(cwd, { force: true });
    console.log(
      r.refreshed
        ? `[mink] refreshed hooks (${r.agents.join(", ")}) → ${r.version}`
        : "[mink] nothing to refresh — run `mink init` first."
    );
    return;
  }

  const { listRegisteredProjects } = require("../core/project-registry");
  const { getOrCreateDeviceId } = require("../core/device");
  const deviceId = getOrCreateDeviceId();

  let refreshed = 0;
  for (const p of listRegisteredProjects()) {
    const local = p.pathsByDevice?.[deviceId] ?? p.cwd;
    if (!local || !existsSync(local)) continue; // not present on this device
    const r = refreshProjectHooks(local, { force: true });
    if (r.refreshed) {
      refreshed++;
      console.log(`  ${p.name} (${r.agents.join(", ")})`);
    }
  }
  console.log(`[mink] refreshed hooks for ${refreshed} project(s) → installed version.`);
}
