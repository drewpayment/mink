import { existsSync } from "fs";
import { projectDir } from "../core/paths";

export async function dashboard(cwd: string, args: string[]): Promise<void> {
  if (!existsSync(projectDir(cwd))) {
    console.error("[mink] project not initialized. Run: mink init");
    process.exit(1);
  }

  const portArg = args.find((a) => a.startsWith("--port="));
  const port = portArg ? parseInt(portArg.split("=")[1], 10) : 4040;
  const noOpen = args.includes("--no-open");

  const { startDashboardServer } = await import("../core/dashboard-server");
  const { url } = startDashboardServer(cwd, { port, open: !noOpen });

  console.log(`[mink] dashboard running at ${url}`);
  console.log("[mink] press Ctrl+C to stop");

  await new Promise(() => {});
}
