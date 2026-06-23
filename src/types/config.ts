export interface GlobalConfig {
  "wiki.path"?: string;
  "wiki.enabled"?: string;
  "wiki.sync-mode"?: string;
  "wiki.git-backup"?: string;
  "wiki.git-remote"?: string;
  "notes.default-category"?: string;
  "sync.enabled"?: string;
  "sync.remote-url"?: string;
  "sync.last-push"?: string;
  "sync.last-pull"?: string;
  "channel.discord.bot-token"?: string;
  "channel.discord.enabled"?: string;
  "channel.discord.allowlist"?: string;
  "channel.default-platform"?: string;
  "channel.skip-permissions"?: string;
  "cli.auto-update"?: string;
  "cli.auto-update-schedule"?: string;
  "cli.auto-update-package-manager"?: string;
  "projects.identity"?: string;
  "compression.enabled"?: string;
  "compression.threshold-tokens"?: string;
  "compression.min-savings-ratio"?: string;
  "compression.holdout-fraction"?: string;
  "compression.retention-hours"?: string;
}

export type ConfigKey = keyof GlobalConfig & string;

export type ConfigScope = "shared" | "local";

export interface ConfigKeyMeta {
  key: ConfigKey;
  default: string;
  envVar: string;
  description: string;
  scope: ConfigScope;
}

export interface DeviceInfo {
  name: string;
  hostname: string;
  platform: string;
  firstSeen: string;
  lastSeen: string;
}

export interface DeviceRegistry {
  devices: Record<string, DeviceInfo>;
}

export const CONFIG_KEYS: ConfigKeyMeta[] = [
  {
    key: "wiki.path",
    default: "~/.mink/wiki",
    envVar: "MINK_WIKI_PATH",
    description: "Wiki vault location",
    scope: "local",
  },
  {
    key: "wiki.enabled",
    default: "true",
    envVar: "MINK_WIKI_ENABLED",
    description: "Enable/disable the wiki feature",
    scope: "shared",
  },
  {
    key: "wiki.sync-mode",
    default: "immediate",
    envVar: "MINK_WIKI_SYNC_MODE",
    description: "Sync mode: immediate or batched",
    scope: "shared",
  },
  {
    key: "wiki.git-backup",
    default: "false",
    envVar: "MINK_WIKI_GIT_BACKUP",
    description: "Deprecated: use sync.enabled instead",
    scope: "shared",
  },
  {
    key: "wiki.git-remote",
    default: "origin",
    envVar: "MINK_WIKI_GIT_REMOTE",
    description: "Deprecated: use sync.remote-url instead",
    scope: "shared",
  },
  {
    key: "notes.default-category",
    default: "inbox",
    envVar: "MINK_NOTES_DEFAULT_CATEGORY",
    description: "Default category for notes captured via CLI",
    scope: "shared",
  },
  {
    key: "sync.enabled",
    default: "false",
    envVar: "MINK_SYNC_ENABLED",
    description: "Enable/disable automatic git sync of ~/.mink",
    scope: "shared",
  },
  {
    key: "sync.remote-url",
    default: "",
    envVar: "MINK_SYNC_REMOTE_URL",
    description: "Git remote URL for ~/.mink sync",
    scope: "shared",
  },
  {
    key: "sync.last-push",
    default: "",
    envVar: "MINK_SYNC_LAST_PUSH",
    description: "ISO timestamp of last successful sync push",
    scope: "local",
  },
  {
    key: "sync.last-pull",
    default: "",
    envVar: "MINK_SYNC_LAST_PULL",
    description: "ISO timestamp of last successful sync pull",
    scope: "local",
  },
  {
    key: "channel.discord.bot-token",
    default: "",
    envVar: "MINK_CHANNEL_DISCORD_BOT_TOKEN",
    description: "Discord bot token for Claude Code Channels",
    scope: "local",
  },
  {
    key: "channel.discord.enabled",
    default: "false",
    envVar: "MINK_CHANNEL_DISCORD_ENABLED",
    description: "Auto-start Discord channel when daemon starts",
    scope: "local",
  },
  {
    key: "channel.discord.allowlist",
    default: "",
    envVar: "MINK_CHANNEL_DISCORD_ALLOWLIST",
    description: "Comma-separated list of Discord user IDs permitted to DM the bot",
    scope: "local",
  },
  {
    key: "channel.default-platform",
    default: "discord",
    envVar: "MINK_CHANNEL_DEFAULT_PLATFORM",
    description: "Default platform for mink channel start",
    scope: "shared",
  },
  {
    key: "channel.skip-permissions",
    default: "true",
    envVar: "MINK_CHANNEL_SKIP_PERMISSIONS",
    description: "Pass --dangerously-skip-permissions so the channel can run without terminal prompts",
    scope: "shared",
  },
  {
    key: "cli.auto-update",
    default: "false",
    envVar: "MINK_CLI_AUTO_UPDATE",
    description: "Auto-upgrade the mink CLI on schedule via the background scheduler",
    scope: "shared",
  },
  {
    key: "cli.auto-update-schedule",
    default: "0 4 * * *",
    envVar: "MINK_CLI_AUTO_UPDATE_SCHEDULE",
    description: "Cron expression governing the cli-self-update scheduled task",
    scope: "shared",
  },
  {
    key: "cli.auto-update-package-manager",
    default: "auto",
    envVar: "MINK_CLI_AUTO_UPDATE_PACKAGE_MANAGER",
    description: "Force a package manager (auto|npm|bun) for self-upgrade installs",
    scope: "local",
  },
  {
    key: "projects.identity",
    default: "path-derived",
    envVar: "MINK_PROJECTS_IDENTITY",
    description:
      "Project identity strategy: path-derived (legacy) or git-remote (stable across machines)",
    scope: "shared",
  },
  {
    key: "compression.enabled",
    default: "false",
    envVar: "MINK_COMPRESSION_ENABLED",
    description: "Enable tool-output compression (spec 22). Off until inline compression ships.",
    scope: "shared",
  },
  {
    key: "compression.threshold-tokens",
    default: "800",
    envVar: "MINK_COMPRESSION_THRESHOLD_TOKENS",
    description: "Minimum estimated token size before a tool output is eligible for compression",
    scope: "shared",
  },
  {
    key: "compression.min-savings-ratio",
    default: "0.25",
    envVar: "MINK_COMPRESSION_MIN_SAVINGS_RATIO",
    description: "Discard a compression attempt unless it saves at least this fraction of tokens",
    scope: "shared",
  },
  {
    key: "compression.holdout-fraction",
    default: "0.1",
    envVar: "MINK_COMPRESSION_HOLDOUT_FRACTION",
    description: "Fraction of eligible outputs left uncompressed as a measured control group",
    scope: "shared",
  },
  {
    key: "compression.retention-hours",
    default: "168",
    envVar: "MINK_COMPRESSION_RETENTION_HOURS",
    description: "How long compressed originals stay retrievable before eviction",
    scope: "shared",
  },
];

const VALID_KEYS = new Set<string>(CONFIG_KEYS.map((k) => k.key));

export function isValidConfigKey(key: string): key is ConfigKey {
  return VALID_KEYS.has(key);
}

export function getConfigKeyMeta(key: ConfigKey): ConfigKeyMeta {
  return CONFIG_KEYS.find((k) => k.key === key)!;
}
