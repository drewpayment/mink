import {
  CONFIG_KEYS,
  isValidConfigKey,
} from "../types/config";
import {
  resolveConfigValue,
  resolveAllConfig,
  setConfigValue,
  resetConfigKey,
  resetAllConfig,
} from "../core/global-config";

function printValidKeys(): void {
  console.error("Valid keys:");
  for (const meta of CONFIG_KEYS) {
    console.error(`  ${meta.key} — ${meta.description}`);
  }
}

function readLineFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    process.stdin.resume();
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (data) => {
      process.stdin.pause();
      resolve(String(data).trim());
    });
  });
}

export async function config(args: string[]): Promise<void> {
  // mink config --reset-all
  if (args.includes("--reset-all")) {
    process.stdout.write(
      "[mink] reset all settings to defaults? (yes/no): "
    );
    const answer = await readLineFromStdin();
    if (answer === "yes" || answer === "y") {
      resetAllConfig();
      console.log("[mink] all settings reset to defaults");
    } else {
      console.log("[mink] cancelled");
    }
    return;
  }

  // mink config --reset <key>
  const resetIdx = args.indexOf("--reset");
  if (resetIdx !== -1) {
    const key = args[resetIdx + 1];
    if (!key) {
      console.error("Usage: mink config --reset <key>");
      printValidKeys();
      process.exit(1);
    }
    if (!isValidConfigKey(key)) {
      console.error(`[mink] unknown config key: ${key}`);
      printValidKeys();
      process.exit(1);
    }
    resetConfigKey(key);
    console.log(`[mink] ${key} reset to default`);
    return;
  }

  // mink config (no args) — show all
  if (args.length === 0) {
    const all = resolveAllConfig();
    console.log("[mink] configuration:");
    for (const entry of all) {
      let line = `  ${entry.key} = ${entry.value} (${entry.scope}, source: ${entry.source})`;
      if (
        entry.source === "environment variable" &&
        entry.configFileValue !== undefined
      ) {
        line += ` [config file value: ${entry.configFileValue} — overridden]`;
      }
      console.log(line);
    }
    return;
  }

  const key = args[0];
  if (!isValidConfigKey(key)) {
    console.error(`[mink] unknown config key: ${key}`);
    printValidKeys();
    process.exit(1);
  }

  // mink config <key> <value> — set
  if (args.length >= 2) {
    const value = args.slice(1).join(" ");
    setConfigValue(key, value);
    console.log(`[mink] ${key} = ${value}`);
    return;
  }

  // mink config <key> — show one
  const resolved = resolveConfigValue(key);
  let line = `${key} = ${resolved.value} (source: ${resolved.source})`;
  if (
    resolved.source === "environment variable" &&
    resolved.configFileValue !== undefined
  ) {
    line += `\n  note: config file value (${resolved.configFileValue}) is overridden`;
  }
  console.log(line);
}
