import { execSync } from "child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join, resolve } from "path";
import { resolveCliPath } from "../commands/init";

export type ServicePlatform = "systemd" | "launchd";

export interface ServiceInvocation {
  /** Absolute path to the executable used in ExecStart / ProgramArguments[0]. */
  executable: string;
  /** Arguments following the executable (e.g. ["daemon", "start"] or ["<cli.js>", "daemon", "start"]). */
  args: string[];
  /** Directory that should be added to PATH for the service's environment. */
  pathDir: string;
}

export interface ServicePaths {
  unitFile: string;
  unitDir: string;
}

export function detectPlatform(): ServicePlatform | null {
  if (process.platform === "linux") return "systemd";
  if (process.platform === "darwin") return "launchd";
  return null;
}

/**
 * Resolve how the service should invoke mink.
 *
 * Prefer argv[1] when it is a bin shim (no .js/.ts extension) — that is the
 * stable, install-method-agnostic entry point (e.g. ~/.bun/bin/mink). Fall
 * back to invoking the compiled bundle via the current interpreter when
 * running from source or from a non-shim entry.
 */
export function resolveServiceInvocation(): ServiceInvocation {
  const entry = process.argv[1];
  if (entry && !/\.(js|ts|mjs|cjs)$/.test(entry) && existsSync(entry)) {
    return {
      executable: entry,
      args: ["daemon", "start"],
      pathDir: dirname(entry),
    };
  }

  const cliPath = resolveCliPath();
  const interpreter = process.execPath;
  return {
    executable: interpreter,
    args: [cliPath, "daemon", "start"],
    pathDir: dirname(interpreter),
  };
}

export function servicePaths(platform: ServicePlatform): ServicePaths {
  const home = homedir();
  if (platform === "systemd") {
    const unitDir = join(home, ".config", "systemd", "user");
    return { unitDir, unitFile: join(unitDir, "mink-daemon.service") };
  }
  const unitDir = join(home, "Library", "LaunchAgents");
  return { unitDir, unitFile: join(unitDir, "com.mink.daemon.plist") };
}

/** Build a systemd user unit file for the mink daemon. */
export function renderSystemdUnit(inv: ServiceInvocation): string {
  const execStart = [inv.executable, ...inv.args].join(" ");
  const stopArgs = inv.args.map((a) => (a === "start" ? "stop" : a));
  const execStop = [inv.executable, ...stopArgs].join(" ");
  const pathEnv = `${inv.pathDir}:/usr/local/bin:/usr/bin:/bin`;

  return [
    "[Unit]",
    "Description=Mink background daemon",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=forking",
    `ExecStart=${execStart}`,
    `ExecStop=${execStop}`,
    "Restart=on-failure",
    "RestartSec=10",
    `Environment="PATH=${pathEnv}"`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

/** Build a launchd user agent plist for the mink daemon. */
export function renderLaunchdPlist(inv: ServiceInvocation, logPath: string): string {
  const programArgs = [inv.executable, ...inv.args]
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join("\n");
  const pathEnv = `${inv.pathDir}:/usr/local/bin:/usr/bin:/bin`;

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    "  <string>com.mink.daemon</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    programArgs,
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>PATH</key>",
    `    <string>${escapeXml(pathEnv)}</string>`,
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(logPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(logPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface InstallOptions {
  force?: boolean;
}

export function installService(options: InstallOptions = {}): void {
  const platform = detectPlatform();
  if (!platform) {
    console.error(
      `[mink] daemon install is not supported on ${process.platform} (supported: linux, darwin)`
    );
    process.exit(1);
  }

  const paths = servicePaths(platform);
  if (existsSync(paths.unitFile) && !options.force) {
    console.error(`[mink] unit file already exists: ${paths.unitFile}`);
    console.error(
      "       re-run with --force to overwrite, or run `mink daemon uninstall` first"
    );
    process.exit(1);
  }

  const inv = resolveServiceInvocation();
  mkdirSync(paths.unitDir, { recursive: true });

  if (platform === "systemd") {
    writeFileSync(paths.unitFile, renderSystemdUnit(inv));
    try {
      execSync("systemctl --user daemon-reload", { stdio: "ignore" });
    } catch {
      // systemctl may be unavailable (e.g. CI, WSL1) — the file is still written.
    }
    console.log(`[mink] wrote ${paths.unitFile}`);
    console.log("[mink] next steps:");
    console.log("  systemctl --user enable --now mink-daemon.service");
    console.log("  # To survive logout (one-time, requires sudo):");
    console.log(`  sudo loginctl enable-linger ${process.env.USER ?? "$USER"}`);
  } else {
    const { schedulerLogPath } = require("./paths") as typeof import("./paths");
    writeFileSync(paths.unitFile, renderLaunchdPlist(inv, schedulerLogPath()));
    console.log(`[mink] wrote ${paths.unitFile}`);
    console.log("[mink] next steps:");
    console.log(`  launchctl load -w ${paths.unitFile}`);
    console.log("  # Launch agents run automatically on login; no lingering needed.");
  }
}

export function uninstallService(): void {
  const platform = detectPlatform();
  if (!platform) {
    console.error(
      `[mink] daemon uninstall is not supported on ${process.platform} (supported: linux, darwin)`
    );
    process.exit(1);
  }

  const paths = servicePaths(platform);
  if (!existsSync(paths.unitFile)) {
    console.log(`[mink] no unit file at ${paths.unitFile} — nothing to uninstall`);
    return;
  }

  if (platform === "systemd") {
    try {
      execSync("systemctl --user disable --now mink-daemon.service", {
        stdio: "ignore",
      });
    } catch {
      // Service may not be enabled / running — proceed to file removal.
    }
    unlinkSync(paths.unitFile);
    try {
      execSync("systemctl --user daemon-reload", { stdio: "ignore" });
    } catch {
      // Ignore.
    }
    console.log(`[mink] removed ${paths.unitFile}`);
  } else {
    try {
      execSync(`launchctl unload -w ${paths.unitFile}`, { stdio: "ignore" });
    } catch {
      // Ignore — may not be loaded.
    }
    unlinkSync(paths.unitFile);
    console.log(`[mink] removed ${paths.unitFile}`);
  }
}
