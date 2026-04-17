import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { spawnSync } from "child_process";
import { channelPidPath, minkRoot } from "./paths";
import type { ChannelPidFile, ChannelStatus, ChannelPlatform } from "../types/channel";

// ── PID File Operations ─────────────────────────────────────────────────────

export function readChannelPidFile(): ChannelPidFile | null {
  try {
    const raw = readFileSync(channelPidPath(), "utf-8");
    const data = JSON.parse(raw);
    if (
      data &&
      typeof data.session === "string" &&
      typeof data.platform === "string" &&
      typeof data.startedAt === "string" &&
      typeof data.vaultPath === "string"
    ) {
      return data as ChannelPidFile;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeChannelPidFile(data: ChannelPidFile): void {
  const pidPath = channelPidPath();
  mkdirSync(dirname(pidPath), { recursive: true });
  writeFileSync(pidPath, JSON.stringify(data, null, 2));
}

export function removeChannelPidFile(): void {
  try {
    unlinkSync(channelPidPath());
  } catch {
    // Already removed
  }
}

// ── Screen Session Management ───────────────────────────────────────────────

const SESSION_PREFIX = "mink-channel-";

function sessionName(platform: ChannelPlatform): string {
  return `${SESSION_PREFIX}${platform}`;
}

function isScreenInstalled(): boolean {
  const result = spawnSync("screen", ["-ls"], { stdio: "ignore" });
  return !result.error;
}

function screenSessionExists(session: string): boolean {
  const result = spawnSync("screen", ["-ls", session], {
    stdio: ["ignore", "pipe", "ignore"],
    encoding: "utf-8",
  });
  const output = typeof result.stdout === "string" ? result.stdout : "";
  return new RegExp(`\\d+\\.${session}\\b`).test(output);
}

function shellEscape(s: string): string {
  if (/^[a-zA-Z0-9_@%+=:,./\-]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Channel Lifecycle ───────────────────────────────────────────────────────

const PLUGIN_SPECS: Record<ChannelPlatform, string> = {
  discord: "plugin:discord@claude-plugins-official",
  telegram: "plugin:telegram@claude-plugins-official",
};

const TOKEN_ENV_VARS: Record<ChannelPlatform, string> = {
  discord: "DISCORD_BOT_TOKEN",
  telegram: "TELEGRAM_BOT_TOKEN",
};

export interface StartChannelOptions {
  vaultPath: string;
  platform: ChannelPlatform;
  token?: string;
  claudeCommand?: string;
  skipPermissions?: boolean;
}

export interface StartChannelResult {
  session: string;
  alreadyRunning: boolean;
}

export async function startChannelProcess(opts: StartChannelOptions): Promise<StartChannelResult> {
  if (!isScreenInstalled()) {
    throw new Error(
      "GNU screen is required but was not found on PATH.\n" +
        "macOS: screen is pre-installed — check your shell environment.\n" +
        "Linux: install with `sudo apt install screen` (or your package manager)."
    );
  }

  const session = sessionName(opts.platform);

  if (screenSessionExists(session)) {
    writeChannelPidFile({
      session,
      platform: opts.platform,
      startedAt: new Date().toISOString(),
      vaultPath: opts.vaultPath,
    });
    return { session, alreadyRunning: true };
  }

  const claudeCmd = opts.claudeCommand ?? "claude";
  const pluginSpec = PLUGIN_SPECS[opts.platform];
  const tokenEnvVar = TOKEN_ENV_VARS[opts.platform];

  const claudeFlags = ["--channels", shellEscape(pluginSpec)];
  if (opts.skipPermissions) {
    claudeFlags.push("--dangerously-skip-permissions");
  }

  const parts: string[] = [];
  parts.push(`cd ${shellEscape(opts.vaultPath)}`);
  if (opts.token) {
    parts.push(`export ${tokenEnvVar}=${shellEscape(opts.token)}`);
  }
  parts.push(`exec ${shellEscape(claudeCmd)} ${claudeFlags.join(" ")}`);
  const innerCmd = parts.join("; ");

  const result = spawnSync(
    "screen",
    // -T screen-256color: advertise 256-color terminal to inner programs.
    // Default screen TERM is `screen` (8 colors) and makes Claude Code render washed-out.
    ["-T", "screen-256color", "-dmS", session, "bash", "-c", innerCmd],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" }
  );

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr : "";
    throw new Error(
      `screen failed to create session (exit ${result.status}): ${stderr || "(no output)"}`
    );
  }

  // Give screen/claude a moment to start; verify the session is still alive
  await new Promise((r) => setTimeout(r, 700));

  if (!screenSessionExists(session)) {
    throw new Error(
      "channel session died immediately after starting. " +
        "This usually means `claude` failed to launch. Check:\n" +
        "  • Is `claude` on your PATH? Run `which claude`.\n" +
        "  • Have you installed the plugin? Run `claude` then `/plugin install discord@claude-plugins-official`.\n" +
        "  • Try running the command manually to see the error:\n" +
        `    cd ${opts.vaultPath} && claude --channels ${pluginSpec}`
    );
  }

  writeChannelPidFile({
    session,
    platform: opts.platform,
    startedAt: new Date().toISOString(),
    vaultPath: opts.vaultPath,
  });

  return { session, alreadyRunning: false };
}

export async function stopChannelProcess(): Promise<"stopped" | "not-running"> {
  const pidData = readChannelPidFile();
  if (!pidData) {
    return "not-running";
  }

  if (!screenSessionExists(pidData.session)) {
    removeChannelPidFile();
    return "not-running";
  }

  spawnSync("screen", ["-S", pidData.session, "-X", "quit"], { stdio: "ignore" });

  for (let i = 0; i < 30; i++) {
    if (!screenSessionExists(pidData.session)) {
      removeChannelPidFile();
      return "stopped";
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // Session lingered — force clean up our tracking file
  removeChannelPidFile();
  return "stopped";
}

export function isChannelRunning(): boolean {
  const pidData = readChannelPidFile();
  if (!pidData) return false;
  if (!screenSessionExists(pidData.session)) {
    removeChannelPidFile();
    return false;
  }
  return true;
}

export function getChannelStatus(): ChannelStatus | null {
  const pidData = readChannelPidFile();
  if (!pidData) return null;
  if (!screenSessionExists(pidData.session)) {
    removeChannelPidFile();
    return null;
  }
  const startedMs = Date.parse(pidData.startedAt);
  const uptimeSec = Number.isFinite(startedMs)
    ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000))
    : 0;
  return {
    session: pidData.session,
    platform: pidData.platform,
    startedAt: pidData.startedAt,
    vaultPath: pidData.vaultPath,
    uptime: uptimeSec,
  };
}

export function getChannelLogs(): string | null {
  const pidData = readChannelPidFile();
  if (!pidData) return null;
  if (!screenSessionExists(pidData.session)) return null;

  const tmpPath = join(minkRoot(), `.channel-capture-${Date.now()}-${process.pid}.txt`);

  const result = spawnSync(
    "screen",
    ["-S", pidData.session, "-X", "hardcopy", "-h", tmpPath],
    { stdio: "ignore" }
  );

  if (result.status !== 0) return null;

  // screen writes asynchronously; give it a brief moment
  for (let i = 0; i < 20; i++) {
    if (existsSync(tmpPath)) break;
    const delayUntil = Date.now() + 50;
    while (Date.now() < delayUntil) {
      /* busy wait — 50ms */
    }
  }

  try {
    const content = readFileSync(tmpPath, "utf-8");
    try {
      unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    return content;
  } catch {
    return null;
  }
}

export function attachChannel(): "attached" | "not-running" {
  const pidData = readChannelPidFile();
  if (!pidData) return "not-running";
  if (!screenSessionExists(pidData.session)) {
    removeChannelPidFile();
    return "not-running";
  }
  // Hand terminal to screen. Returns when user detaches (Ctrl-a then d).
  spawnSync("screen", ["-r", pidData.session], { stdio: "inherit" });
  return "attached";
}
