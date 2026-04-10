#!/usr/bin/env bun
import { sessionStart } from "./commands/session-start";
import { sessionStop } from "./commands/session-stop";
import { sessionPath } from "./core/paths";

const command = process.argv[2];
const cwd = process.cwd();

switch (command) {
  case "session-start":
    sessionStart(cwd);
    break;

  case "session-stop":
    sessionStop(sessionPath(cwd));
    break;

  case "init": {
    const { init } = await import("./commands/init");
    init(cwd);
    break;
  }

  case "scan": {
    const { scan } = await import("./commands/scan");
    const check = process.argv.includes("--check");
    scan(cwd, { check });
    break;
  }

  default:
    console.error(`[mink] unknown command: ${command}`);
    console.error("Usage: mink <session-start|session-stop|init|scan>");
    process.exit(1);
}
