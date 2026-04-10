import { mkdirSync } from "fs";
import { createSessionState } from "../core/session";
import { projectDir, sessionPath } from "../core/paths";
import { atomicWriteJson } from "../core/fs-utils";

export function sessionStart(cwd: string): void {
  const dir = projectDir(cwd);
  mkdirSync(dir, { recursive: true });

  const state = createSessionState();
  atomicWriteJson(sessionPath(cwd), state);

  // Downstream stubs (specs 04, 08):
  // - Append session header to action log
  // - Increment lifetime session counter in token ledger
}
