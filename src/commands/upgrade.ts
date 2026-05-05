import { runSelfUpgrade, PACKAGE_NAME, type UpgradeResult } from "../core/self-update";

interface UpgradeArgs {
  check: boolean;
  dryRun: boolean;
  force: boolean;
  yes: boolean;
  help: boolean;
}

function parseArgs(args: string[]): UpgradeArgs {
  const out: UpgradeArgs = {
    check: false,
    dryRun: false,
    force: false,
    yes: false,
    help: false,
  };
  for (const arg of args) {
    switch (arg) {
      case "--check":
        out.check = true;
        break;
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--force":
        out.force = true;
        break;
      case "--yes":
      case "-y":
        out.yes = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
    }
  }
  return out;
}

function printHelp(): void {
  console.log("Usage: mink upgrade [options]");
  console.log("");
  console.log("Check the npm registry for a newer mink release and install it.");
  console.log(`Tracks the 'latest' dist-tag of ${PACKAGE_NAME}.`);
  console.log("");
  console.log("Options:");
  console.log("  --check     Report whether an upgrade is available; do not install");
  console.log("  --dry-run   Resolve everything but do not run the install command");
  console.log("  --force     Install the latest version even if it is not strictly newer");
  console.log("  --yes, -y   Skip the interactive confirmation prompt");
  console.log("  --help, -h  Show this help");
  console.log("");
  console.log("Auto-update on a schedule:");
  console.log("  mink config set cli.auto-update true");
  console.log("  mink config set cli.auto-update-schedule \"0 4 * * *\"");
}

function describeResult(r: UpgradeResult): string {
  switch (r.status) {
    case "up-to-date":
      return `Already up-to-date — ${r.current} matches latest.`;
    case "update-available":
      return `Update available: ${r.current} → ${r.latest}` +
        (r.packageManager ? ` (would install via ${r.packageManager})` : "");
    case "would-upgrade":
      return `Would upgrade: ${r.current} → ${r.latest}\n  command: ${r.command}`;
    case "upgraded":
      return `Upgraded ${r.from} → ${r.to} (via ${r.packageManager}).`;
    case "skipped":
      return `Skipped: ${r.reason}`;
    case "error":
      return `Error: ${r.reason}`;
  }
}

async function confirm(prompt: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  process.stdout.write(prompt);
  return new Promise<boolean>((resolveConfirm) => {
    process.stdin.setEncoding("utf-8");
    process.stdin.once("data", (chunk) => {
      const answer = String(chunk).trim().toLowerCase();
      resolveConfirm(answer === "y" || answer === "yes");
    });
  });
}

export async function upgrade(_cwd: string, args: string[]): Promise<void> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    printHelp();
    return;
  }

  // For interactive runs without --yes/--check/--dry-run/--force, do a check
  // first and ask for confirmation before mutating the global install.
  const isCheckLike = parsed.check || parsed.dryRun;
  if (!isCheckLike && !parsed.yes && process.stdin.isTTY) {
    const probe = await runSelfUpgrade({ source: "manual", checkOnly: true, force: parsed.force });
    console.log(describeResult(probe));
    if (probe.status !== "update-available" && !parsed.force) {
      return;
    }
    const ok = await confirm("Proceed with install? [y/N] ");
    if (!ok) {
      console.log("Aborted.");
      return;
    }
  }

  const result = await runSelfUpgrade({
    source: "manual",
    checkOnly: parsed.check,
    dryRun: parsed.dryRun,
    force: parsed.force,
    interactive: true,
  });

  console.log(describeResult(result));

  if (result.status === "error") {
    process.exit(1);
  }
}
