import { join, resolve, dirname } from "path";
import { homedir } from "os";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { createHash } from "crypto";
import { spawnSync } from "child_process";
import { minkRoot } from "../core/paths";
import { resolveVaultPath } from "../core/vault";

const AGENT_NAME = "mink-agent";
const TEMPLATE_FILE = `${AGENT_NAME}.md.tmpl`;
const INSTALLED_FILE = `${AGENT_NAME}.md`;

function getAgentTemplatePath(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  while (true) {
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "agents", TEMPLATE_FILE))
    ) {
      return join(dir, "agents", TEMPLATE_FILE);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(
    dirname(new URL(import.meta.url).pathname),
    "../../agents",
    TEMPLATE_FILE
  );
}

function getMinkVersion(): string {
  let dir = dirname(new URL(import.meta.url).pathname);
  while (true) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name && pkg.version) return pkg.version;
      } catch {
        // fall through
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "unknown";
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function claudeAgentsDir(): string {
  return join(homedir(), ".claude", "agents");
}

function installedAgentPath(): string {
  return join(claudeAgentsDir(), INSTALLED_FILE);
}

interface InstallResult {
  action: "installed" | "updated" | "unchanged" | "skipped";
  path: string;
}

function installAgentDefinition(opts: { force: boolean; skip: boolean }): InstallResult {
  const templatePath = getAgentTemplatePath();
  if (!existsSync(templatePath)) {
    throw new Error(
      `[mink agent] bundled agent template not found at ${templatePath}\n` +
        "  This usually means the package was installed without bundled assets."
    );
  }

  const installed = installedAgentPath();

  if (opts.skip && existsSync(installed)) {
    return { action: "skipped", path: installed };
  }

  const template = readFileSync(templatePath, "utf-8");
  const rendered = renderTemplate(template, {
    MINK_ROOT: minkRoot(),
    VAULT_PATH: resolveVaultPath(),
    MINK_VERSION: getMinkVersion(),
  });

  const exists = existsSync(installed);
  if (!opts.force && exists) {
    const current = readFileSync(installed, "utf-8");
    if (sha256(current) === sha256(rendered)) {
      return { action: "unchanged", path: installed };
    }
  }

  mkdirSync(claudeAgentsDir(), { recursive: true });
  writeFileSync(installed, rendered);
  return {
    action: exists ? "updated" : "installed",
    path: installed,
  };
}

function isClaudeOnPath(): boolean {
  const result = spawnSync("claude", ["--version"], {
    stdio: "ignore",
  });
  return !result.error && result.status === 0;
}

interface ParsedArgs {
  noUpdate: boolean;
  reinstall: boolean;
  passthrough: string[];
  showHelp: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const out: ParsedArgs = {
    noUpdate: false,
    reinstall: false,
    passthrough: [],
    showHelp: false,
  };
  let inPassthrough = false;
  for (const arg of args) {
    if (inPassthrough) {
      out.passthrough.push(arg);
      continue;
    }
    if (arg === "--") {
      inPassthrough = true;
      continue;
    }
    if (arg === "--no-update") {
      out.noUpdate = true;
      continue;
    }
    if (arg === "--reinstall") {
      out.reinstall = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      out.showHelp = true;
      continue;
    }
    out.passthrough.push(arg);
  }
  return out;
}

function printHelp(): void {
  console.log("Usage: mink agent [options] [-- <claude args...>]");
  console.log();
  console.log("Open an interactive Claude Code session in your mink home with");
  console.log("the mink-agent persona — a proactive note/wiki assistant.");
  console.log();
  console.log("Options:");
  console.log("  --no-update    Don't refresh ~/.claude/agents/mink-agent.md if it exists");
  console.log("  --reinstall    Force overwrite the installed agent definition");
  console.log("  -- <args>      Forward remaining arguments to `claude`");
  console.log();
  console.log("Environment:");
  console.log("  MINK_AGENT_NO_UPDATE=1   Equivalent to --no-update");
  console.log();
  console.log("The agent is bound to your mink root and resolved vault path. Changing");
  console.log("`mink config wiki.path` triggers a refresh on the next launch.");
}

export async function agent(_cwd: string, rawArgs: string[]): Promise<void> {
  const args = parseArgs(rawArgs);

  if (args.showHelp) {
    printHelp();
    return;
  }

  const skipUpdate = args.noUpdate || process.env.MINK_AGENT_NO_UPDATE === "1";

  const root = minkRoot();
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }

  let result: InstallResult;
  try {
    result = installAgentDefinition({
      force: args.reinstall,
      skip: skipUpdate && !args.reinstall,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(msg);
    process.exit(1);
  }

  switch (result.action) {
    case "installed":
      console.log(`[mink] installed mink-agent definition (v${getMinkVersion()}) -> ${result.path}`);
      break;
    case "updated":
      console.log(`[mink] updated mink-agent definition -> ${result.path}`);
      break;
    case "unchanged":
    case "skipped":
      // silent
      break;
  }

  if (!isClaudeOnPath()) {
    console.error("[mink agent] `claude` (Claude Code CLI) was not found on PATH.");
    console.error("  Install Claude Code: https://claude.com/claude-code");
    process.exit(1);
  }

  const claudeArgs = ["--agent", AGENT_NAME, ...args.passthrough];
  const child = spawnSync("claude", claudeArgs, {
    cwd: root,
    stdio: "inherit",
  });

  if (child.error) {
    console.error(`[mink agent] failed to launch claude: ${child.error.message}`);
    process.exit(1);
  }
  if (typeof child.status === "number") {
    process.exit(child.status);
  }
}
