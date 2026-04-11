import { mkdirSync } from "fs";
import { createSessionState } from "../core/session";
import { projectDir, sessionPath, actionLogPath } from "../core/paths";
import { atomicWriteJson } from "../core/fs-utils";
import { createActionLogWriter } from "../core/action-log";

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
}
