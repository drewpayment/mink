import {
  initSync,
  syncPull,
  syncPush,
  getSyncStatus,
  disconnectSync,
  isSyncInitialized,
} from "../core/sync";
import { setConfigValue } from "../core/global-config";

export async function sync(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case undefined:
      // No args: full manual sync (pull then push)
      return handleManualSync();

    case "init":
      return handleInit(args.slice(1));

    case "status":
      return handleStatus();

    case "push":
      syncPush((msg) => console.error(msg));
      return;

    case "pull":
      syncPull((msg) => console.error(msg));
      return;

    case "pause":
      return handlePause();

    case "resume":
      return handleResume();

    case "disconnect":
      return handleDisconnect();

    default:
      console.error(`[mink] unknown sync subcommand: ${subcommand}`);
      console.error("Usage: mink sync [init|status|push|pull|pause|resume|disconnect]");
      process.exit(1);
  }
}

function handleManualSync(): void {
  if (!isSyncInitialized()) {
    console.error("[mink] sync is not initialized");
    console.error("Run 'mink sync init <remote-url>' to set up sync");
    return;
  }

  console.log("[mink] pulling remote changes...");
  syncPull((msg) => console.error(msg));

  console.log("[mink] pushing local changes...");
  syncPush((msg) => console.error(msg));

  console.log("[mink] sync complete");
}

function handleInit(args: string[]): void {
  const remoteUrl = args[0];
  if (!remoteUrl) {
    console.error("[mink] missing remote URL");
    console.error("Usage: mink sync init <remote-url>");
    console.error("Example: mink sync init git@github.com:user/mink-data.git");
    process.exit(1);
  }

  initSync(remoteUrl);
}

function handleStatus(): void {
  const status = getSyncStatus();

  console.log("Mink Sync Status");
  console.log("─".repeat(40));
  console.log(`  Enabled:          ${status.enabled ? "yes" : "no"}`);
  console.log(`  Git initialized:  ${status.gitInitialized ? "yes" : "no"}`);
  console.log(`  Remote URL:       ${status.remoteUrl || "(not set)"}`);
  console.log(`  Branch:           ${status.branch || "(none)"}`);
  console.log(`  Pending changes:  ${status.pendingChanges}`);
  console.log(`  Last push:        ${status.lastPush || "(never)"}`);
  console.log(`  Last pull:        ${status.lastPull || "(never)"}`);
}

function handlePause(): void {
  setConfigValue("sync.enabled", "false");
  console.log("[mink] sync paused — auto-sync disabled");
  console.log("[mink] run 'mink sync resume' to re-enable");
}

function handleResume(): void {
  const status = getSyncStatus();
  if (!status.gitInitialized) {
    console.error("[mink] sync has not been initialized yet");
    console.error("Run 'mink sync init <remote-url>' first");
    return;
  }

  setConfigValue("sync.enabled", "true");
  console.log("[mink] sync resumed — auto-sync re-enabled");
}

function handleDisconnect(): void {
  disconnectSync();
}
