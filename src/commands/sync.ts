import {
  initSync,
  syncPull,
  syncPush,
  getSyncStatus,
  disconnectSync,
  isSyncInitialized,
} from "../core/sync";
import { setConfigValue } from "../core/global-config";
import { runMergeDriver } from "../core/sync-merge-drivers";
import {
  listParkedConflicts,
  dropParkedConflict,
} from "../core/conflict-park";

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

    case "merge-driver":
      return handleMergeDriver(args.slice(1));

    case "reconcile":
      return handleReconcile(args.slice(1));

    case "migrate": {
      const { syncMigrateCommand } = await import("./sync-migrate");
      syncMigrateCommand();
      return;
    }

    default:
      console.error(`[mink] unknown sync subcommand: ${subcommand}`);
      console.error(
        "Usage: mink sync [init|status|push|pull|pause|resume|disconnect|reconcile|migrate|merge-driver]"
      );
      process.exit(1);
  }
}

function handleReconcile(args: string[]): void {
  const sub = args[0];
  if (sub === undefined || sub === "list") {
    const refs = listParkedConflicts();
    if (refs.length === 0) {
      console.log("[mink] no parked conflicts");
      return;
    }
    console.log(`[mink] ${refs.length} parked conflict ref(s):`);
    for (const r of refs) console.log(`  ${r}`);
    console.log(
      "Inspect with: cd ~/.mink && git log <ref> | git diff main..<ref>"
    );
    console.log("Drop with:    mink sync reconcile drop <ref>");
    return;
  }
  if (sub === "drop") {
    const ref = args[1];
    if (!ref) {
      console.error("Usage: mink sync reconcile drop <ref>");
      process.exit(1);
    }
    if (dropParkedConflict(ref)) {
      console.log(`[mink] dropped ${ref}`);
    } else {
      console.error(`[mink] failed to drop ${ref} — only refs/mink/conflicts/* are droppable`);
      process.exit(1);
    }
    return;
  }
  console.error("Usage: mink sync reconcile [list|drop <ref>]");
  process.exit(1);
}

// Invoked by git for paths matched in .gitattributes. Always exits 0 so a
// merge can never block — the driver itself logs warnings and falls back to
// "ours" when inputs are unparseable.
function handleMergeDriver(args: string[]): void {
  const [name, basePath, oursPath, theirsPath, filePath] = args;
  if (!name || !basePath || !oursPath || !theirsPath) {
    console.error(
      "Usage: mink sync merge-driver <name> <base> <ours> <theirs> [path]"
    );
    process.exit(0); // exit 0 so git never sees a failure here
  }
  const code = runMergeDriver(
    name,
    basePath,
    oursPath,
    theirsPath,
    filePath ?? oursPath
  );
  process.exit(code);
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
