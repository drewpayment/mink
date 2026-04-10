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

  case "reflect": {
    const { reflect } = await import("./commands/reflect");
    const { learningMemoryPath, configPath } = await import("./core/paths");
    reflect(cwd, learningMemoryPath(cwd), configPath(cwd));
    break;
  }

  case "pre-read": {
    const { preRead } = await import("./commands/pre-read");
    await preRead(cwd);
    break;
  }

  case "post-read": {
    const { postRead } = await import("./commands/post-read");
    await postRead(cwd);
    break;
  }

  case "pre-write": {
    const { preWrite } = await import("./commands/pre-write");
    await preWrite(cwd);
    break;
  }

  case "post-write": {
    const { postWrite } = await import("./commands/post-write");
    await postWrite(cwd);
    break;
  }

  default:
    console.error(`[mink] unknown command: ${command}`);
    console.error("Usage: mink <session-start|session-stop|init|scan|reflect|pre-read|post-read|pre-write|post-write>");
    process.exit(1);
}
