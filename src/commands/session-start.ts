import { mkdirSync } from "fs";
import { createSessionState } from "../core/session";
import { projectDir, sessionPath, actionLogShardPath } from "../core/paths";
import { atomicWriteJson } from "../core/fs-utils";
import { createActionLogWriter } from "../core/action-log";
import { getOrCreateDeviceId } from "../core/device";
import { isWikiEnabled, isVaultInitialized, isInsideVault } from "../core/vault";
import { loadVaultIndex } from "../core/note-index";

export function sessionStart(cwd: string): void {
  // Migrate config to shared/local split if needed (before sync pull)
  try {
    const { migrateConfigIfNeeded } = require("../core/global-config");
    migrateConfigIfNeeded();
  } catch {
    // Never crash hooks
  }

  // Register/update this device in the registry
  try {
    const { updateDeviceHeartbeat } = require("../core/device");
    updateDeviceHeartbeat();
  } catch {
    // Never crash hooks
  }

  // One-shot migration to the current sync layout. Idempotent re-run is a
  // no-op. We also re-trigger when projects.identity=git-remote so a user who
  // flips the flag after the version has stamped still gets project directories
  // renamed to their stable identifier on the next session-start.
  try {
    const { readSyncVersion, MINK_SYNC_VERSION } = require("../core/sync");
    const { resolveConfigValue } = require("../core/global-config");
    const identityOn =
      resolveConfigValue("projects.identity").value === "git-remote";
    if (readSyncVersion() < MINK_SYNC_VERSION || identityOn) {
      const { migrateSyncLayout } = require("./sync-migrate");
      migrateSyncLayout();
    }
  } catch {
    // Migration is best-effort; never block session-start
  }

  // Sync pull before session begins (if enabled)
  try {
    const { isSyncInitialized, syncPull } = require("../core/sync");
    if (isSyncInitialized()) {
      syncPull((msg: string) => console.error(msg));
    }
  } catch {
    // Never crash hooks
  }

  const dir = projectDir(cwd);
  mkdirSync(dir, { recursive: true });

  const state = createSessionState();
  atomicWriteJson(sessionPath(cwd), state);

  // Append session header to this device's action log shard
  try {
    const logWriter = createActionLogWriter(
      actionLogShardPath(cwd, getOrCreateDeviceId())
    );
    logWriter.appendSessionHeader(state.startTimestamp);
  } catch {
    // Never crash hooks
  }

  // Emit vault context if wiki is enabled
  try {
    if (isWikiEnabled() && isVaultInitialized()) {
      const index = loadVaultIndex();
      const inboxCount = Object.values(index.entries).filter(
        (e) => e.category === "inbox"
      ).length;

      // Regenerate the master index when missing — it's gitignored under sync
      // v2 so freshly-cloned devices need it materialised before Obsidian can
      // see the vault. updateMasterIndex is idempotent + cheap.
      try {
        const { join } = require("path");
        const { existsSync } = require("fs");
        const { resolveVaultPath } = require("../core/vault");
        const { updateMasterIndex } = require("../core/note-linker");
        const vaultPath = resolveVaultPath();
        const masterIndexPath = join(vaultPath, "_index.md");
        if (!existsSync(masterIndexPath)) {
          updateMasterIndex(vaultPath);
        }
      } catch {
        // Never crash hooks on regeneration failure
      }

      if (inboxCount > 0) {
        console.error(
          `[mink] vault: ${inboxCount} notes in inbox need categorization`
        );
      }

      if (isInsideVault(cwd)) {
        console.error(
          `[mink] notes project detected — vault has ${index.totalNotes} notes`
        );
      }
    }
  } catch {
    // Never crash hooks
  }
}
