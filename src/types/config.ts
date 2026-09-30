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
  "recall.rerank"?: string;
  "recall.rerank-api-key"?: string;
  "recall.rerank-base-url"?: string;
  "recall.rerank-model"?: string;
  "recall.rerank-min-relevance"?: string;
  "recall.rerank-pool-size"?: string;
  "recall.rerank-timeout-ms"?: string;
  "recall.rerank-concurrency"?: string;
}

export type ConfigKey = keyof GlobalConfig & string;

export type ConfigScope = "shared" | "local";

export interface ConfigKeyMeta {
  key: ConfigKey;
  default: string;
  envVar: string;
  description: string;
  scope: ConfigScope;
  /** Secret values are masked wherever config is printed (spec 18). */
  secret?: boolean;
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
    secret: true,
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
    default: "true",
    envVar: "MINK_COMPRESSION_ENABLED",
    description:
      "Enable tool-output compression (spec 22). On by default; set false to opt out.",
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
  {
    key: "recall.rerank",
    default: "off",
    envVar: "MINK_RECALL_RERANK",
    description:
      "Relevance reranking for mink recall (spec 25): off or jev. jev sends candidate note titles, tags, paths and excerpts to the configured judge service.",
    scope: "shared",
  },
  {
    key: "recall.rerank-api-key",
    default: "",
    envVar: "MINK_RECALL_RERANK_API_KEY",
    description: "API key for the rerank judge (falls back to JEV_API_KEY). Per-machine secret, never synced.",
    scope: "local",
    secret: true,
  },
  {
    key: "recall.rerank-base-url",
    default: "https://api.typesafe.ai",
    envVar: "MINK_RECALL_RERANK_BASE_URL",
    description: "Judge endpoint: https://api.typesafe.ai (direct) or https://ai-gateway.vercel.sh/typesafe (Vercel AI Gateway)",
    scope: "local",
  },
  {
    key: "recall.rerank-model",
    default: "jev-latest",
    envVar: "MINK_RECALL_RERANK_MODEL",
    description: "Judge model name (the Vercel AI Gateway accepts jev or jev-latest)",
    scope: "shared",
  },
  {
    key: "recall.rerank-min-relevance",
    default: "0.5",
    envVar: "MINK_RECALL_RERANK_MIN_RELEVANCE",
    description: "Drop reranked results scoring below this relevance probability (0-1)",
    scope: "shared",
  },
  {
    key: "recall.rerank-pool-size",
    default: "40",
    envVar: "MINK_RECALL_RERANK_POOL_SIZE",
    description: "Candidate notes gathered and judged per recall query",
    scope: "shared",
  },
  {
    key: "recall.rerank-timeout-ms",
    default: "3000",
    envVar: "MINK_RECALL_RERANK_TIMEOUT_MS",
    description: "Total time budget for judging; on overrun recall falls back to lexical order",
    scope: "shared",
  },
  {
    key: "recall.rerank-concurrency",
    default: "8",
    envVar: "MINK_RECALL_RERANK_CONCURRENCY",
    description: "Maximum concurrent judge requests",
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

export function isSecretConfigKey(key: ConfigKey): boolean {
  return getConfigKeyMeta(key).secret === true;
}

/** "••••" + last 4 characters, or "(not set)" when empty. Short values reveal nothing. */
export function maskSecretValue(value: string | undefined): string {
  if (!value) return "(not set)";
  return value.length <= 4 ? "••••" : "••••" + value.slice(-4);
}

/** Display form of a config value: masked for secret keys, verbatim otherwise. */
export function displayConfigValue(key: ConfigKey, value: string | undefined): string {
  if (isSecretConfigKey(key)) return maskSecretValue(value);
  return value ?? "";
}
