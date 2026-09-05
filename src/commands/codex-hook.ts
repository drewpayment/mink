import { createHash } from "crypto";
import { readdirSync } from "fs";
import { join } from "path";
import { codexProjectRoot, configuredCodexEvents, CODEX_GUIDANCE } from "../core/agent-codex";
import { readStdinJson } from "../core/stdin";
import { projectDir, projectMetaPath } from "../core/paths";
import { getOrCreateDeviceId } from "../core/device";
import { atomicWriteJson, safeReadJson } from "../core/fs-utils";
import { isVaultInitialized } from "../core/vault";

interface Receipt {
  sessionHash: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt?: string;
  lastEvent: "SessionStart" | "SessionEnd";
}

function receiptDir(cwd: string): string {
  return join(projectDir(cwd), "state", getOrCreateDeviceId(), "codex-hooks");
}

/**
 * Lifecycle verification only. Do not forward Stop to session-stop: Stop is a
 * turn boundary, and the shared finalizer can run network sync beyond Codex's
 * three-second SessionEnd limit. Per-session receipts also avoid resetting the
 * shared Claude/Pi session on resume/compaction or concurrent Codex threads.
 */
export function handleCodexHook(cwd: string, input: unknown): object | null {
  if (!input || typeof input !== "object") return null;
  const event = input as Record<string, unknown>;
  if (typeof event.session_id !== "string" || !event.session_id ||
      !["SessionStart", "SessionEnd"].includes(String(event.hook_event_name))) return null;
  const root = codexProjectRoot(cwd);
  if (!safeReadJson(projectMetaPath(root))) return null;
  const sessionHash = createHash("sha256").update(event.session_id).digest("hex");
  const path = join(receiptDir(root), `${sessionHash}.json`);
  const previous = safeReadJson(path) as Receipt | null;
  // An end event without a recorded start does not imply successful setup.
  if (event.hook_event_name === "SessionEnd" && !previous) return null;
  const now = new Date().toISOString();
  const receipt: Receipt = {
    sessionHash,
    startedAt: previous?.startedAt ?? now,
    lastSeenAt: now,
    lastEvent: event.hook_event_name as Receipt["lastEvent"],
    ...(event.hook_event_name === "SessionEnd" ? { endedAt: previous?.endedAt ?? now } : {}),
  };
  atomicWriteJson(path, receipt);
  if (event.hook_event_name === "SessionStart") return {
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: CODEX_GUIDANCE },
  };
  return null;
}

export async function codexHook(cwd: string): Promise<void> {
  const timer = setTimeout(() => process.exit(0), 2500);
  try {
    const result = handleCodexHook(cwd, await readStdinJson());
    if (result) console.log(JSON.stringify(result));
  } catch {
    // Advisory hooks must never block Codex, including on corrupt local state.
  } finally {
    clearTimeout(timer);
  }
}

export function codexStatus(cwd: string): void {
  const root = codexProjectRoot(cwd);
  const events = configuredCodexEvents(root);
  let receipts: Receipt[] = [];
  try {
    receipts = readdirSync(receiptDir(root)).filter((f) => /^[a-f0-9]{64}\.json$/.test(f))
      .map((f) => safeReadJson(join(receiptDir(root), f)) as Receipt | null)
      .filter((r): r is Receipt => !!r && typeof r.lastSeenAt === "string");
  } catch { /* No execution receipts yet. */ }
  receipts.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  console.log(JSON.stringify({
    project: root,
    configuredEvents: events,
    hookTrust: "unknown — review current definitions in Codex /hooks",
    execution: receipts[0] ?? null,
    executionNote: "Historical local receipt; does not prove current trust or host execution. Verify in /hooks.",
    noteVault: isVaultInitialized() ? "available" : "not initialized — run mink wiki init",
    sessionLedger: "not integrated; lifecycle receipts only",
    fileAccounting: "not supported",
    compression: "disabled; no token savings claimed",
  }, null, 2));
}
