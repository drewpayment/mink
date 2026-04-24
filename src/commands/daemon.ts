import { readFileSync, existsSync } from "fs";
import { startDaemon, stopDaemon } from "../core/daemon";
import { installService, uninstallService } from "../core/daemon-service";
import { schedulerLogPath } from "../core/paths";

export async function daemon(cwd: string, args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "start":
      startDaemon(cwd);
      break;

    case "stop":
      await stopDaemon();
      break;

    case "restart":
      await stopDaemon();
      startDaemon(cwd);
      break;

    case "logs": {
      const logPath = schedulerLogPath();
      if (!existsSync(logPath)) {
        console.log("[mink] no log file found");
        return;
      }
      try {
        const content = readFileSync(logPath, "utf-8");
        const lines = content.split("\n");
        const tail = lines.slice(-50).join("\n");
        console.log(tail);
      } catch {
        console.error("[mink] error reading log file");
      }
      break;
    }

    case "install":
      installService({ force: args.includes("--force") });
      break;

    case "uninstall":
      uninstallService();
      break;

    default:
      console.error(
        `[mink] unknown daemon subcommand: ${subcommand ?? "(none)"}`
      );
      console.error(
        "Usage: mink daemon <start|stop|restart|logs|install|uninstall>"
      );
      process.exit(1);
  }
}
