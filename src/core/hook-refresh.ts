// Self-healing hook regeneration.
//
// Mink's generated wiring — `.claude/settings.json` and `.pi/extensions/mink.ts`
// — is produced by `mink init` and pinned at the version that wrote it. After the
// package upgrades, those files can go stale (e.g. they lack a newly-added hook,
// or the Pi adapter template changed) until the user re-runs `mink init`.
//
// To avoid that manual step we stamp the project metadata with the Mink version
// that generated the hooks (`hooksVersion`) and refresh when it changes:
//   - lazily, per project, on `session-start` (refreshHooksIfStale), and
//   - eagerly, across all registered projects, right after a successful upgrade
//     (`mink refresh-hooks --all`, spawned as the freshly-installed binary).
//
// Both paths regenerate ONLY the hosts a project already uses and are defensive:
// a failure degrades to "no refresh" and the next session-start tries again.

import { projectMetaPath } from "./paths";
import { safeReadJson, atomicWriteJson } from "./fs-utils";
import { getInstallInfo } from "./self-update";

export interface HookRefreshResult {
  refreshed: boolean;
  /** Hosts the project is wired for (claude/pi). */
  agents: string[];
  /** The Mink version now stamped, or null when nothing could be resolved. */
  version: string | null;
}

const SKIP: HookRefreshResult = { refreshed: false, agents: [], version: null };

/**
 * Regenerate a single project's hooks for exactly the agents it already uses,
 * then stamp the generating Mink version. With `force` off (session-start) it
 * only acts when the stamp differs from the running version; with `force` on
 * (`refresh-hooks`) it always regenerates. Never throws.
 */
export function refreshProjectHooks(
  cwd: string,
  opts: { force?: boolean } = {}
): HookRefreshResult {
  try {
    const metaPath = projectMetaPath(cwd);
    const meta = safeReadJson(metaPath) as Record<string, unknown> | null;
    if (!meta) return SKIP; // never initialized here → nothing to refresh
    const agents = Array.isArray(meta.agents) ? (meta.agents as string[]) : [];
    if (agents.length === 0) return SKIP;

    const current = getInstallInfo().currentVersion;
    const stamped = typeof meta.hooksVersion === "string" ? meta.hooksVersion : null;
    if (!opts.force && stamped === current) {
      return { refreshed: false, agents, version: current };
    }

    rewireAgents(cwd, agents);
    atomicWriteJson(metaPath, { ...meta, hooksVersion: current });
    return { refreshed: true, agents, version: current };
  } catch {
    return SKIP;
  }
}

/** Session-start convenience: refresh only when the version stamp is stale. */
export function refreshHooksIfStale(cwd: string): HookRefreshResult {
  return refreshProjectHooks(cwd);
}

function rewireAgents(cwd: string, agents: string[]): void {
  // Lazy-require the installers so the common (up-to-date) path stays cheap and
  // we avoid any import cycle (init.ts is heavy and pulls in the agent wiring).
  const { resolveCliPath, installClaude } = require("../commands/init");
  const { installPi } = require("./agent-pi");
  const cliPath = resolveCliPath();
  for (const agent of agents) {
    try {
      if (agent === "claude") installClaude(cwd, cliPath);
      else if (agent === "pi") installPi(cwd, cliPath);
    } catch {
      // Per-agent best-effort; one host failing must not block the others.
    }
  }
}
