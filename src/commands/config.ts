import {
  CONFIG_KEYS,
  isValidConfigKey,
  displayConfigValue,
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

// One-time (per `config set`) plain-language disclosure: reranking sends note
// content off the machine.
function printRerankDisclosure(): void {
  const baseUrl = resolveConfigValue("recall.rerank-base-url").value;
  const poolSize = Number(resolveConfigValue("recall.rerank-pool-size").value) || 40;
  console.log("");
  console.log("[mink] notice: relevance reranking is now on.");
  console.log(
    `  'mink recall' will send note titles, tags, paths and excerpts of up to ${poolSize} candidate notes per query to ${baseUrl}.`
  );
  console.log("  Turn it off any time with: mink config recall.rerank off");
  console.log("  Or skip it for one query with: mink recall --no-rerank \"<query>\"");
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

export async function config(rawArgs: string[]): Promise<void> {
  // `mink config set <key> <value>` / `mink config get <key>` are accepted as
  // aliases for the positional forms. Help text, `mink upgrade` and the TUI
  // have long told users to type `config set ...`, which previously failed
  // with "unknown config key: set".
  let args = rawArgs;
  if (args[0] === "set") {
    if (args.length < 3) {
      console.error("Usage: mink config set <key> <value>");
      printValidKeys();
      process.exit(1);
    }
    args = args.slice(1);
  } else if (args[0] === "get") {
    if (args.length !== 2) {
      console.error("Usage: mink config get <key>");
      printValidKeys();
      process.exit(1);
    }
    args = args.slice(1);
  }

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
      let line = `  ${entry.key} = ${displayConfigValue(entry.key, entry.value)} (${entry.scope}, source: ${entry.source})`;
      if (
        entry.source === "environment variable" &&
        entry.configFileValue !== undefined
      ) {
        line += ` [config file value: ${displayConfigValue(entry.key, entry.configFileValue)} — overridden]`;
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
    console.log(`[mink] ${key} = ${displayConfigValue(key, value)}`);
    if (key === "recall.rerank" && value.trim().toLowerCase() === "jev") printRerankDisclosure();
    return;
  }

  // mink config <key> — show one
  const resolved = resolveConfigValue(key);
  let line = `${key} = ${displayConfigValue(key, resolved.value)} (source: ${resolved.source})`;
  if (
    resolved.source === "environment variable" &&
    resolved.configFileValue !== undefined
  ) {
    line += `\n  note: config file value (${displayConfigValue(key, resolved.configFileValue)}) is overridden`;
  }
  console.log(line);
}
