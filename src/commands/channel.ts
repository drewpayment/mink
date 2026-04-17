import { resolveConfigValue, setConfigValue } from "../core/global-config";
import { resolveVaultPath, isVaultInitialized } from "../core/vault";
import { writeCompanionClaudeMd } from "../core/channel-templates";
import {
  startChannelProcess,
  stopChannelProcess,
  getChannelStatus,
  getChannelLogs,
  attachChannel,
} from "../core/channel-process";
import type { ChannelPlatform } from "../types/channel";

const SUPPORTED_PLATFORMS: ChannelPlatform[] = ["discord", "telegram"];

function parsePlatform(value: string | undefined): ChannelPlatform | null {
  if (!value) return null;
  if (SUPPORTED_PLATFORMS.includes(value as ChannelPlatform)) {
    return value as ChannelPlatform;
  }
  return null;
}

function extractFlag(args: string[], flag: string): string | undefined {
  const idx = args.findIndex((a) => a === flag || a.startsWith(flag + "="));
  if (idx === -1) return undefined;
  const arg = args[idx];
  if (arg.includes("=")) {
    return arg.slice(arg.indexOf("=") + 1);
  }
  return args[idx + 1];
}

export async function channel(args: string[]): Promise<void> {
  const subcommand = args[0];
  const rest = args.slice(1);

  switch (subcommand) {
    case "setup":
      setupChannel(rest);
      break;
    case "start":
      await startChannel(rest);
      break;
    case "stop":
      await stopChannel();
      break;
    case "status":
      showStatus();
      break;
    case "logs":
      showLogs();
      break;
    case "attach":
      doAttach();
      break;
    default:
      printUsage();
      process.exit(1);
  }
}

function setupChannel(args: string[]): void {
  const platform = parsePlatform(args[0]);
  if (!platform) {
    console.error("[mink] missing or invalid platform");
    console.error("Usage: mink channel setup <discord|telegram> --token <token>");
    process.exit(1);
  }

  if (platform === "telegram") {
    console.error("[mink] telegram setup is not yet supported");
    process.exit(1);
  }

  const token = extractFlag(args, "--token");

  if (!token) {
    console.log("[mink] Discord Channel Setup");
    console.log("");
    console.log("In the Discord Developer Portal (https://discord.com/developers/applications):");
    console.log("");
    console.log("  1. New Application > give it a name");
    console.log("  2. Bot > Reset Token > copy the token");
    console.log("  3. Bot > scroll to Privileged Gateway Intents:");
    console.log("     - Enable MESSAGE CONTENT INTENT (required)");
    console.log("  4. OAuth2 > URL Generator:");
    console.log("     - Integration Type: Guild Install (NOT User Install)");
    console.log("     - Scopes: bot");
    console.log("     - Bot Permissions: View Channels, Send Messages,");
    console.log("       Send Messages in Threads, Read Message History,");
    console.log("       Attach Files, Add Reactions");
    console.log("  5. Open the generated URL to invite the bot to a server");
    console.log("     (create a personal server if you just want to DM the bot)");
    console.log("");
    console.log("Then install the channel plugin once inside Claude Code:");
    console.log("  claude");
    console.log("  /plugin install discord@claude-plugins-official");
    console.log("  (exit Claude Code)");
    console.log("");
    console.log("Finally, save your token:");
    console.log("  mink channel setup discord --token <your-token>");
    console.log("");
    console.log("Your token is stored locally in ~/.mink/config.local");
    console.log("and is NOT synced across machines.");
    return;
  }

  if (!/^[\w.-]{30,}$/.test(token)) {
    console.error("[mink] token format looks invalid — expected a long token string");
    process.exit(1);
  }

  setConfigValue("channel.discord.bot-token", token);
  setConfigValue("channel.discord.enabled", "true");
  setConfigValue("channel.default-platform", "discord");

  console.log("[mink] Discord bot token saved to config.local");
  console.log("[mink] channel.discord.enabled = true");
  console.log("[mink] channel.default-platform = discord");
  console.log("");
  console.log("Next: mink channel start");
}

async function startChannel(args: string[]): Promise<void> {
  if (!isVaultInitialized()) {
    console.error("[mink] wiki vault is not initialized");
    console.error("Run: mink wiki init");
    process.exit(1);
  }

  const requested = parsePlatform(args[0]);
  const platform =
    requested ??
    parsePlatform(resolveConfigValue("channel.default-platform").value) ??
    "discord";

  if (platform === "telegram") {
    console.error("[mink] telegram is not yet supported");
    process.exit(1);
  }

  const token = resolveConfigValue("channel.discord.bot-token").value;
  if (!token) {
    console.error("[mink] no Discord bot token configured");
    console.error("Run: mink channel setup discord --token <your-token>");
    process.exit(1);
  }

  const vaultPath = resolveVaultPath();
  const wrote = writeCompanionClaudeMd(vaultPath, false);
  if (wrote) {
    console.log(`[mink] created companion CLAUDE.md at ${vaultPath}`);
  }

  const skipPermissions =
    resolveConfigValue("channel.skip-permissions").value === "true";

  let result;
  try {
    result = await startChannelProcess({ vaultPath, platform, token, skipPermissions });
  } catch (err) {
    console.error("[mink] failed to start channel:");
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (result.alreadyRunning) {
    console.log(`[mink] channel is already running (screen session: ${result.session})`);
    return;
  }

  console.log(`[mink] channel started`);
  console.log(`[mink] platform:  ${platform}`);
  console.log(`[mink] vault:     ${vaultPath}`);
  console.log(`[mink] session:   ${result.session} (GNU screen)`);
  console.log("");
  console.log("Next:");
  console.log("  1. DM your bot on Discord — it replies with a pairing code");
  console.log("  2. Attach to the Claude Code session: mink channel attach");
  console.log("  3. Inside the session, run: /discord:access pair <code>");
  console.log("  4. Then lock down access:   /discord:access policy allowlist");
  console.log("  5. Detach with Ctrl-a d");
  console.log("");
  console.log("See activity:  mink channel logs");
}

async function stopChannel(): Promise<void> {
  const result = await stopChannelProcess();
  switch (result) {
    case "not-running":
      console.log("[mink] channel is not running");
      break;
    case "stopped":
      console.log("[mink] channel stopped");
      break;
  }
}

function showStatus(): void {
  const status = getChannelStatus();
  if (!status) {
    console.log("[mink] channel is not running");
    return;
  }
  console.log(`running:   yes`);
  console.log(`session:   ${status.session}`);
  console.log(`platform:  ${status.platform}`);
  console.log(`vault:     ${status.vaultPath}`);
  console.log(`started:   ${status.startedAt}`);
  console.log(`uptime:    ${formatUptime(status.uptime)}`);
  console.log("");
  console.log("Attach:    mink channel attach");
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ${seconds % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function showLogs(): void {
  const content = getChannelLogs();
  if (content == null) {
    console.log("[mink] channel is not running (no logs to show)");
    return;
  }
  // Strip trailing empty lines for readability
  console.log(content.replace(/\n+$/, ""));
}

function doAttach(): void {
  const result = attachChannel();
  if (result === "not-running") {
    console.log("[mink] channel is not running");
    console.log("Start it with: mink channel start");
  }
}

function printUsage(): void {
  console.error("Usage: mink channel <subcommand>");
  console.error("");
  console.error("Subcommands:");
  console.error("  setup <platform> --token <token>   Configure a channel (discord|telegram)");
  console.error("  start [platform]                   Launch channel session (in GNU screen)");
  console.error("  stop                               Stop channel session");
  console.error("  status                             Show channel status");
  console.error("  logs                               Show recent channel output");
  console.error("  attach                             Attach to the channel's Claude Code session");
  console.error("                                     (detach with Ctrl-a then d)");
}
