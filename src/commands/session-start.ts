import { mkdirSync } from "fs";
import { createSessionState } from "../core/session";
import { projectDir, sessionPath, actionLogPath } from "../core/paths";
import { atomicWriteJson } from "../core/fs-utils";
import { createActionLogWriter } from "../core/action-log";
import { isWikiEnabled, isVaultInitialized, isInsideVault } from "../core/vault";
import { loadVaultIndex } from "../core/note-index";

export function sessionStart(cwd: string): void {
  const dir = projectDir(cwd);
  mkdirSync(dir, { recursive: true });

  const state = createSessionState();
  atomicWriteJson(sessionPath(cwd), state);

  // Append session header to action log
  try {
    const logWriter = createActionLogWriter(actionLogPath(cwd));
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
