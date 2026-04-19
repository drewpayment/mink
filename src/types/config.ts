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
    default: "~/.mink/wiki/",
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
];

const VALID_KEYS = new Set<string>(CONFIG_KEYS.map((k) => k.key));

export function isValidConfigKey(key: string): key is ConfigKey {
  return VALID_KEYS.has(key);
}

export function getConfigKeyMeta(key: ConfigKey): ConfigKeyMeta {
  return CONFIG_KEYS.find((k) => k.key === key)!;
}
