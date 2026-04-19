import { readFileSync, writeFileSync, unlinkSync, existsSync, openSync } from "fs";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { schedulerPidPath, schedulerLogPath } from "./paths";
import type { PidFileData } from "../types/scheduler";
import { resolveConfigValue } from "./global-config";
import { resolveVaultPath, isVaultInitialized } from "./vault";
import { writeCompanionClaudeMd } from "./channel-templates";
import {
  startChannelProcess,
  stopChannelProcess,
  getChannelStatus,
  isChannelRunning,
} from "./channel-process";
import { runtimeSpawn } from "./runtime";
import type { ChannelPlatform, ChannelStatus } from "../types/channel";

// ── PID File Operations ─────────────────────────────────────────────────────

export function readPidFile(): PidFileData | null {
  try {
    const raw = readFileSync(schedulerPidPath(), "utf-8");
    const data = JSON.parse(raw);
    if (
      data &&
      typeof data.pid === "number" &&
      typeof data.startedAt === "string" &&
      typeof data.projectCwd === "string"
    ) {
      return data as PidFileData;
    }
    return null;
  } catch {
    return null;
  }
}

export function writePidFile(data: PidFileData): void {
  const pidPath = schedulerPidPath();
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, JSON.stringify(data, null, 2));
}

export function removePidFile(): void {
  try {
    unlinkSync(schedulerPidPath());
  } catch {
    // Already removed
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ── Daemon Lifecycle ────────────────────────────────────────────────────────

export function startDaemon(cwd: string): void {
  const existing = readPidFile();
  if (existing && isProcessAlive(existing.pid)) {
    console.log(
      `[mink] scheduler is already running (PID: ${existing.pid})`
    );
    return;
  }

  // Clean up stale PID file
  if (existing) {
    removePidFile();
  }

  // Resolve the CLI entry point — argv[1] is correct in both the
  // source tree (bun run src/cli.ts) and the installed bundle (dist/cli.js).
  const __dir = dirname(new URL(import.meta.url).pathname);
  const cliPath = process.argv[1] ?? resolve(__dir, "../cli.ts");

  // Ensure log directory exists
  const logPath = schedulerLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");

  const proc = runtimeSpawn(["bun", "run", cliPath, "cron", "__daemon"], {
    cwd,
    stdout: logFd,
    stderr: logFd,
    stdin: "ignore",
    env: process.env,
  });

  // Unref so parent can exit
  proc.unref();

  writePidFile({
    pid: proc.pid,
    startedAt: new Date().toISOString(),
    projectCwd: cwd,
  });

  console.log(`[mink] scheduler started (PID: ${proc.pid})`);
  console.log(`[mink] log: ${logPath}`);

  // Fire and forget — channel startup has its own verification loop.
  maybeStartChannel().catch((err) => {
    console.error(`[mink] failed to start channel: ${err instanceof Error ? err.message : String(err)}`);
  });
}

async function maybeStartChannel(): Promise<void> {
  const enabled = resolveConfigValue("channel.discord.enabled").value === "true";
  if (!enabled) return;

  if (!isVaultInitialized()) {
    console.log("[mink] channel enabled but vault not initialized — skipping channel start");
    return;
  }

  const token = resolveConfigValue("channel.discord.bot-token").value;
  if (!token) {
    console.log("[mink] channel enabled but no Discord bot token configured — skipping channel start");
    return;
  }

  if (isChannelRunning()) {
    return;
  }

  const platform =
    (resolveConfigValue("channel.default-platform").value as ChannelPlatform) ||
    "discord";
  const skipPermissions =
    resolveConfigValue("channel.skip-permissions").value === "true";
  const vaultPath = resolveVaultPath();
  writeCompanionClaudeMd(vaultPath, false);

  const result = await startChannelProcess({ vaultPath, platform, token, skipPermissions });
  if (!result.alreadyRunning) {
    console.log(`[mink] channel started (session: ${result.session}, platform: ${platform})`);
  }
}

export async function stopDaemon(): Promise<void> {
  await stopChannelIfRunning();

  const pidData = readPidFile();
  if (!pidData) {
    console.log("[mink] scheduler is not running (no PID file)");
    return;
  }

  if (!isProcessAlive(pidData.pid)) {
    console.log("[mink] scheduler is not running (stale PID file)");
    removePidFile();
    return;
  }

  // Send SIGTERM
  process.kill(pidData.pid, "SIGTERM");
  console.log(`[mink] sent SIGTERM to PID ${pidData.pid}`);

  // Poll for up to 5 seconds
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (!isProcessAlive(pidData.pid)) {
      removePidFile();
      console.log("[mink] scheduler stopped");
      return;
    }
  }

  // Force kill
  try {
    process.kill(pidData.pid, "SIGKILL");
  } catch {
    // Process may have just exited
  }
  removePidFile();
  console.log("[mink] scheduler force-stopped (SIGKILL)");
}

async function stopChannelIfRunning(): Promise<void> {
  if (!isChannelRunning()) return;
  const result = await stopChannelProcess();
  if (result === "stopped") {
    console.log("[mink] channel stopped");
  }
}

export function getDaemonStatus(cwd: string): {
  running: boolean;
  pid?: number;
  startedAt?: string;
  projectCwd?: string;
  channel: ChannelStatus | null;
} {
  const channel = getChannelStatus();
  const pidData = readPidFile();
  if (!pidData) {
    return { running: false, channel };
  }
  if (!isProcessAlive(pidData.pid)) {
    removePidFile();
    return { running: false, channel };
  }
  return {
    running: true,
    pid: pidData.pid,
    startedAt: pidData.startedAt,
    projectCwd: pidData.projectCwd,
    channel,
  };
}
