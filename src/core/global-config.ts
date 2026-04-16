import { globalConfigPath, localConfigPath } from "./paths";
import { safeReadJson, atomicWriteJson } from "./fs-utils";
import {
  CONFIG_KEYS,
  isValidConfigKey,
  getConfigKeyMeta,
  type GlobalConfig,
  type ConfigKey,
  type ConfigScope,
} from "../types/config";

function loadConfigFile(path: string): GlobalConfig {
  const raw = safeReadJson(path);
  if (raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[mink] warning: corrupt config file at " + path);
    return {};
  }
  return raw as GlobalConfig;
}

export function loadGlobalConfig(): GlobalConfig {
  return loadConfigFile(globalConfigPath());
}

export function saveGlobalConfig(config: GlobalConfig): void {
  atomicWriteJson(globalConfigPath(), config);
}

export function loadLocalConfig(): GlobalConfig {
  return loadConfigFile(localConfigPath());
}

export function saveLocalConfig(config: GlobalConfig): void {
  atomicWriteJson(localConfigPath(), config);
}

function loadConfigForScope(scope: ConfigScope): GlobalConfig {
  return scope === "local" ? loadLocalConfig() : loadGlobalConfig();
}

function saveConfigForScope(scope: ConfigScope, config: GlobalConfig): void {
  if (scope === "local") {
    saveLocalConfig(config);
  } else {
    saveGlobalConfig(config);
  }
}

export interface ResolvedValue {
  value: string;
  source: "default" | "config file" | "environment variable";
  scope: ConfigScope;
  configFileValue?: string;
}

export function resolveConfigValue(key: ConfigKey): ResolvedValue {
  const meta = getConfigKeyMeta(key);
  const config = loadConfigForScope(meta.scope);

  const envValue = process.env[meta.envVar];
  const fileValue = config[key];

  if (envValue !== undefined && envValue !== "") {
    return {
      value: envValue,
      source: "environment variable",
      scope: meta.scope,
      configFileValue: fileValue,
    };
  }

  if (fileValue !== undefined) {
    return { value: fileValue, source: "config file", scope: meta.scope };
  }

  return { value: meta.default, source: "default", scope: meta.scope };
}

export function resolveAllConfig(): Array<ResolvedValue & { key: ConfigKey }> {
  return CONFIG_KEYS.map((meta) => ({
    key: meta.key,
    ...resolveConfigValue(meta.key),
  }));
}

export function setConfigValue(key: ConfigKey, value: string): void {
  const meta = getConfigKeyMeta(key);
  const config = loadConfigForScope(meta.scope);
  config[key] = value;
  saveConfigForScope(meta.scope, config);
}

export function resetConfigKey(key: ConfigKey): void {
  const meta = getConfigKeyMeta(key);
  const config = loadConfigForScope(meta.scope);
  delete config[key];
  saveConfigForScope(meta.scope, config);
}

export function resetAllConfig(): void {
  saveGlobalConfig({});
  saveLocalConfig({});
}

// ── Migration ─────────────────────────────────────────────────────────────

let migrationRan = false;

export function migrateConfigIfNeeded(): void {
  if (migrationRan) return;
  migrationRan = true;

  const { existsSync } = require("fs");
  if (existsSync(localConfigPath())) return;

  const shared = loadGlobalConfig();
  const localKeys = CONFIG_KEYS.filter((k) => k.scope === "local");
  const localConfig: GlobalConfig = {};
  let hasLocal = false;

  for (const meta of localKeys) {
    const val = shared[meta.key];
    if (val !== undefined) {
      localConfig[meta.key] = val;
      delete shared[meta.key];
      hasLocal = true;
    }
  }

  if (hasLocal) {
    saveLocalConfig(localConfig);
    saveGlobalConfig(shared);
  }
}
