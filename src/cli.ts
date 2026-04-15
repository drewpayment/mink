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
    await init(cwd);
    break;
  }

  case "status": {
    const { status } = await import("./commands/status");
    status(cwd);
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

  case "detect-waste": {
    const { detectWaste } = await import("./commands/detect-waste");
    detectWaste(cwd);
    break;
  }

  case "cron": {
    const { cron } = await import("./commands/cron");
    await cron(cwd, process.argv.slice(3));
    break;
  }

  case "dashboard": {
    const { dashboard } = await import("./commands/dashboard");
    await dashboard(cwd, process.argv.slice(3));
    break;
  }

  case "daemon": {
    const { daemon } = await import("./commands/daemon");
    await daemon(cwd, process.argv.slice(3));
    break;
  }

  case "config": {
    const { config } = await import("./commands/config");
    await config(process.argv.slice(3));
    break;
  }

  case "update": {
    const { update } = await import("./commands/update");
    await update(cwd, process.argv.slice(3));
    break;
  }

  case "restore": {
    const { restore } = await import("./commands/restore");
    restore(cwd, process.argv.slice(3));
    break;
  }

  case "designqc": {
    const { designqc } = await import("./commands/designqc");
    designqc(cwd, process.argv.slice(3));
    break;
  }

  case "framework-advisor": {
    const { frameworkAdvisor } = await import("./commands/framework-advisor");
    await frameworkAdvisor(cwd, process.argv.slice(3));
    break;
  }

  case "wiki": {
    const { wiki } = await import("./commands/wiki");
    await wiki(cwd, process.argv.slice(3));
    break;
  }

  case "note": {
    const { note } = await import("./commands/note");
    await note(cwd, process.argv.slice(3));
    break;
  }

  case "skill": {
    const { skill } = await import("./commands/skill");
    await skill(process.argv.slice(3));
    break;
  }

  case "sync": {
    const { sync } = await import("./commands/sync");
    await sync(process.argv.slice(3));
    break;
  }

  case "device": {
    const { device } = await import("./commands/device");
    device(process.argv.slice(3));
    break;
  }

  case "bug-search": {
    const { bugSearch } = await import("./commands/bug-search");
    bugSearch(cwd, process.argv.slice(3).join(" "));
    break;
  }

  case "bug": {
    if (process.argv[3] === "search") {
      const { bugSearch } = await import("./commands/bug-search");
      bugSearch(cwd, process.argv.slice(4).join(" "));
    } else {
      console.error(
        `[mink] unknown bug subcommand: ${process.argv[3] ?? "(none)"}`
      );
      console.error("Usage: mink bug search <term>");
      process.exit(1);
    }
    break;
  }

  case "version":
  case "--version":
  case "-v": {
    const { resolve, dirname } = await import("path");
    const cliPath = resolve(dirname(new URL(import.meta.url).pathname));
    const { readFileSync } = await import("fs");
    try {
      const pkg = JSON.parse(
        readFileSync(resolve(cliPath, "../package.json"), "utf-8")
      );
      console.log(`mink ${pkg.version}`);
    } catch {
      console.log("mink (unknown version)");
    }
    console.log(`  location: ${cliPath}`);
    break;
  }

  case "help":
  case "--help":
  case "-h":
    console.log("mink — a hidden presence that moves alongside the developer");
    console.log();
    console.log("Usage: mink <command> [options]");
    console.log();
    console.log("Commands:");
    console.log("  init                    Initialize Mink in the current project");
    console.log("  status                  Display project health at a glance");
    console.log("  scan [--check]          Force a full file index rescan");
    console.log("  config [key] [value]    Manage global user settings");
    console.log();
    console.log("Notes & Wiki:");
    console.log("  wiki <cmd>              Manage the notes/wiki vault (init|status|link|unlink|links|rebuild-index|organize)");
    console.log("  note \"text\"             Capture a note to the vault");
    console.log("  note --daily [text]     Create or append to today's daily note");
    console.log("  note list [filters]     List notes (--category, --tag, --recent)");
    console.log("  note search <term>      Full-text search across the vault");
    console.log("  skill install           Install /mink:note skill for Claude Code");
    console.log();
    console.log("Devices & Sync:");
    console.log("  device                  Show current device info");
    console.log("  device list             List all registered devices");
    console.log("  device rename <name>    Set a friendly name for this device");
    console.log("  sync                    Full manual sync (pull then push)");
    console.log("  sync init <remote-url>  Connect ~/.mink to a git remote for cross-device sync");
    console.log("  sync status             Show sync state (remote, last sync, pending changes)");
    console.log("  sync push               Manually push local changes");
    console.log("  sync pull               Manually pull remote changes");
    console.log("  sync pause / resume     Temporarily disable/enable auto-sync");
    console.log("  sync disconnect         Remove git tracking (data preserved)");
    console.log();
    console.log("Automation & Analysis:");
    console.log("  dashboard [--port=N]    Open the real-time web dashboard");
    console.log("  daemon <cmd>            Manage the background daemon (start|stop|restart|logs)");
    console.log("  cron <cmd> [id]         Manage scheduled tasks (list|run|retry)");
    console.log("  update [options]        Update Mink across registered projects");
    console.log("  restore [backup]        Restore state from a backup");
    console.log("  bug search <term>       Search the bug log");
    console.log("  detect-waste            Detect and flag wasteful patterns");
    console.log("  reflect                 Generate learning memory reflections");
    console.log("  designqc [target]       Capture design screenshots (spec 13)");
    console.log("  framework-advisor       Generate framework advisor knowledge file (spec 14)");
    console.log();
    console.log("Lifecycle hooks (internal):");
    console.log("  session-start           Start session tracking");
    console.log("  session-stop            Finalize session and log data");
    console.log("  pre-read / post-read    File read hooks");
    console.log("  pre-write / post-write  File write hooks");
    break;

  default:
    console.error(`[mink] unknown command: ${command ?? "(none)"}`);
    console.error("Run 'mink help' for usage information.");
    process.exit(1);
}
