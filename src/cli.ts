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

  default:
    console.error(`[mink] unknown command: ${command}`);
    console.error("Usage: mink <session-start|session-stop|init>");
    process.exit(1);
}
