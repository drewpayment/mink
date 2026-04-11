import { globalConfigPath } from "./paths";
import { safeReadJson, atomicWriteJson } from "./fs-utils";
import {
  CONFIG_KEYS,
  isValidConfigKey,
  getConfigKeyMeta,
  type GlobalConfig,
  type ConfigKey,
} from "../types/config";

export function loadGlobalConfig(): GlobalConfig {
  const raw = safeReadJson(globalConfigPath());
  if (raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    console.warn("[mink] warning: corrupt config file at " + globalConfigPath());
    return {};
  }
  return raw as GlobalConfig;
}

export function saveGlobalConfig(config: GlobalConfig): void {
  atomicWriteJson(globalConfigPath(), config);
}

export interface ResolvedValue {
  value: string;
  source: "default" | "config file" | "environment variable";
  configFileValue?: string;
}

export function resolveConfigValue(key: ConfigKey): ResolvedValue {
  const meta = getConfigKeyMeta(key);
  const config = loadGlobalConfig();

  const envValue = process.env[meta.envVar];
  const fileValue = config[key];

  if (envValue !== undefined && envValue !== "") {
    return {
      value: envValue,
      source: "environment variable",
      configFileValue: fileValue,
    };
  }

  if (fileValue !== undefined) {
    return { value: fileValue, source: "config file" };
  }

  return { value: meta.default, source: "default" };
}

export function resolveAllConfig(): Array<ResolvedValue & { key: ConfigKey }> {
  return CONFIG_KEYS.map((meta) => ({
    key: meta.key,
    ...resolveConfigValue(meta.key),
  }));
}

export function setConfigValue(key: ConfigKey, value: string): void {
  const config = loadGlobalConfig();
  config[key] = value;
  saveGlobalConfig(config);
}

export function resetConfigKey(key: ConfigKey): void {
  const config = loadGlobalConfig();
  delete config[key];
  saveGlobalConfig(config);
}

export function resetAllConfig(): void {
  saveGlobalConfig({});
}
