import { readFileSync, writeFileSync, unlinkSync, existsSync, openSync } from "fs";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { schedulerPidPath, schedulerLogPath } from "./paths";
import type { PidFileData } from "../types/scheduler";

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

  // Resolve the CLI entry point
  const cliPath = resolve(import.meta.dir, "../cli.ts");

  // Ensure log directory exists
  const logPath = schedulerLogPath();
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a");

  const proc = Bun.spawn(["bun", "run", cliPath, "cron", "__daemon"], {
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
}

export async function stopDaemon(): Promise<void> {
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

export function getDaemonStatus(cwd: string): {
  running: boolean;
  pid?: number;
  startedAt?: string;
  projectCwd?: string;
} {
  const pidData = readPidFile();
  if (!pidData) {
    return { running: false };
  }
  if (!isProcessAlive(pidData.pid)) {
    removePidFile();
    return { running: false };
  }
  return {
    running: true,
    pid: pidData.pid,
    startedAt: pidData.startedAt,
    projectCwd: pidData.projectCwd,
  };
}
