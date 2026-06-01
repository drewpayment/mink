import { existsSync } from "fs";
import { projectDir } from "../core/paths";
import {
  listRegisteredProjects,
  type RegisteredProject,
} from "../core/project-registry";

export type StartupResolution =
  | { kind: "active"; cwd: string }
  | { kind: "fallback"; cwd: string; project: RegisteredProject }
  | { kind: "none" };

/**
 * Resolve which project's cwd to hand to the dashboard server at startup.
 *
 * The dashboard UI has an in-app project switcher, so `mink dashboard` does
 * not need to be launched from inside an active mink project. When the cwd
 * is not an initialized project, fall back to any registered project — the
 * user can switch from there.
 */
export function resolveStartupCwd(
  cwd: string,
  registered: RegisteredProject[] = listRegisteredProjects(),
): StartupResolution {
  if (existsSync(projectDir(cwd))) {
    return { kind: "active", cwd };
  }
  if (registered.length === 0) {
    return { kind: "none" };
  }
  const fallback = [...registered].sort((a, b) =>
    a.name.localeCompare(b.name),
  )[0];
  return { kind: "fallback", cwd: fallback.cwd, project: fallback };
}

export async function dashboard(cwd: string, args: string[]): Promise<void> {
  const resolution = resolveStartupCwd(cwd);
  if (resolution.kind === "none") {
    console.error(
      "[mink] no mink projects found. Run `mink init` in a project first.",
    );
    process.exit(1);
  }
  if (resolution.kind === "fallback") {
    console.log(
      `[mink] not in a mink project — starting dashboard with "${resolution.project.name}". ` +
        "Use the in-app project switcher to change projects.",
    );
  }
  const startupCwd = resolution.cwd;

  const portArg = args.find((a) => a.startsWith("--port="));
  const port = portArg ? parseInt(portArg.split("=")[1], 10) : 4040;
  const noOpen = args.includes("--no-open");

  const { startDashboardServer } = await import("../core/dashboard-server");
  const { url } = await startDashboardServer(startupCwd, {
    port,
    open: !noOpen,
  });

  console.log(`[mink] dashboard running at ${url}`);
  console.log("[mink] press Ctrl+C to stop");

  await new Promise(() => {});
}
