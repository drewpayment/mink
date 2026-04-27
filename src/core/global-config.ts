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

// ── Typed config groups ───────────────────────────────────────────────────

export interface LearningMemoryAiConfig {
  enabled: boolean;
  scheduledMining: boolean;
  manualTriggers: boolean;
  autoAcceptThreshold: number;
  maxRulesPerRun: number;
  actionLogBytes: number;
}

function parseBool(raw: string, fallback: boolean): boolean {
  const v = raw.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes" || v === "on") return true;
  if (v === "false" || v === "0" || v === "no" || v === "off") return false;
  return fallback;
}

function parseFloatClamped(raw: string, fallback: number, min: number, max: number): number {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function parseIntPositive(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

export function resolveLearningMemoryAi(): LearningMemoryAiConfig {
  return {
    enabled: parseBool(resolveConfigValue("learning.ai.enabled").value, true),
    scheduledMining: parseBool(resolveConfigValue("learning.ai.scheduled-mining").value, true),
    manualTriggers: parseBool(resolveConfigValue("learning.ai.manual-triggers").value, true),
    autoAcceptThreshold: parseFloatClamped(
      resolveConfigValue("learning.ai.auto-accept-threshold").value,
      0.85,
      0,
      1
    ),
    maxRulesPerRun: parseIntPositive(
      resolveConfigValue("learning.ai.max-rules-per-run").value,
      8
    ),
    actionLogBytes: parseIntPositive(
      resolveConfigValue("learning.ai.action-log-bytes").value,
      32_000
    ),
  };
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
