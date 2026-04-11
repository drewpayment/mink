export interface GlobalConfig {
  "wiki.path"?: string;
  "wiki.enabled"?: string;
  "wiki.sync-mode"?: string;
  "wiki.git-backup"?: string;
  "wiki.git-remote"?: string;
}

export type ConfigKey = keyof GlobalConfig & string;

export interface ConfigKeyMeta {
  key: ConfigKey;
  default: string;
  envVar: string;
  description: string;
}

export const CONFIG_KEYS: ConfigKeyMeta[] = [
  {
    key: "wiki.path",
    default: "~/.mink/wiki/",
    envVar: "MINK_WIKI_PATH",
    description: "Wiki vault location",
  },
  {
    key: "wiki.enabled",
    default: "true",
    envVar: "MINK_WIKI_ENABLED",
    description: "Enable/disable the wiki feature",
  },
  {
    key: "wiki.sync-mode",
    default: "immediate",
    envVar: "MINK_WIKI_SYNC_MODE",
    description: "Sync mode: immediate or batched",
  },
  {
    key: "wiki.git-backup",
    default: "false",
    envVar: "MINK_WIKI_GIT_BACKUP",
    description: "Enable/disable auto-commit and push",
  },
  {
    key: "wiki.git-remote",
    default: "origin",
    envVar: "MINK_WIKI_GIT_REMOTE",
    description: "Git remote name for push",
  },
];

const VALID_KEYS = new Set<string>(CONFIG_KEYS.map((k) => k.key));

export function isValidConfigKey(key: string): key is ConfigKey {
  return VALID_KEYS.has(key);
}

export function getConfigKeyMeta(key: ConfigKey): ConfigKeyMeta {
  return CONFIG_KEYS.find((k) => k.key === key)!;
}
