import { describe, test, expect } from "bun:test";
import { homedir } from "os";
import { join } from "path";
import {
  renderSystemdUnit,
  renderLaunchdPlist,
  servicePaths,
  detectPlatform,
  resolveServiceInvocation,
  type ServiceInvocation,
} from "../../src/core/daemon-service";

const sampleInv: ServiceInvocation = {
  executable: "/home/test/.bun/bin/mink",
  args: ["daemon", "start"],
  pathDir: "/home/test/.bun/bin",
};

describe("renderSystemdUnit", () => {
  test("produces a valid [Unit]/[Service]/[Install] structure", () => {
    const unit = renderSystemdUnit(sampleInv);
    expect(unit).toContain("[Unit]");
    expect(unit).toContain("[Service]");
    expect(unit).toContain("[Install]");
    expect(unit).toContain("Type=forking");
    expect(unit).toContain("Restart=on-failure");
    expect(unit).toContain("WantedBy=default.target");
  });

  test("embeds ExecStart with daemon start and ExecStop with daemon stop", () => {
    const unit = renderSystemdUnit(sampleInv);
    expect(unit).toContain(
      "ExecStart=/home/test/.bun/bin/mink daemon start"
    );
    expect(unit).toContain(
      "ExecStop=/home/test/.bun/bin/mink daemon stop"
    );
  });

  test("prepends the invocation's directory to PATH", () => {
    const unit = renderSystemdUnit(sampleInv);
    expect(unit).toMatch(
      /Environment="PATH=\/home\/test\/\.bun\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin"/
    );
  });

  test("handles interpreter + cli.js invocations", () => {
    const inv: ServiceInvocation = {
      executable: "/usr/bin/node",
      args: ["/opt/mink/dist/cli.js", "daemon", "start"],
      pathDir: "/usr/bin",
    };
    const unit = renderSystemdUnit(inv);
    expect(unit).toContain(
      "ExecStart=/usr/bin/node /opt/mink/dist/cli.js daemon start"
    );
    expect(unit).toContain(
      "ExecStop=/usr/bin/node /opt/mink/dist/cli.js daemon stop"
    );
  });
});

describe("renderLaunchdPlist", () => {
  const logPath = "/Users/test/.mink/scheduler.log";

  test("produces a valid plist document", () => {
    const plist = renderLaunchdPlist(sampleInv, logPath);
    expect(plist).toContain('<?xml version="1.0"');
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain("<key>Label</key>");
    expect(plist).toContain("<string>com.mink.daemon</string>");
  });

  test("wraps each ProgramArgument in <string>", () => {
    const plist = renderLaunchdPlist(sampleInv, logPath);
    expect(plist).toContain("<string>/home/test/.bun/bin/mink</string>");
    expect(plist).toContain("<string>daemon</string>");
    expect(plist).toContain("<string>start</string>");
  });

  test("sets RunAtLoad and KeepAlive for auto-restart on crash", () => {
    const plist = renderLaunchdPlist(sampleInv, logPath);
    expect(plist).toContain("<key>RunAtLoad</key>");
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).toContain("<key>KeepAlive</key>");
    expect(plist).toContain("<key>SuccessfulExit</key>");
  });

  test("routes stdout and stderr to the scheduler log path", () => {
    const plist = renderLaunchdPlist(sampleInv, logPath);
    expect(plist).toContain(`<string>${logPath}</string>`);
    expect(plist).toContain("<key>StandardOutPath</key>");
    expect(plist).toContain("<key>StandardErrorPath</key>");
  });

  test("xml-escapes paths with special characters", () => {
    const inv: ServiceInvocation = {
      executable: "/opt/Applications/Mink & Co/mink",
      args: ["daemon", "start"],
      pathDir: "/opt/Applications/Mink & Co",
    };
    const plist = renderLaunchdPlist(inv, logPath);
    expect(plist).toContain("Mink &amp; Co");
    expect(plist).not.toContain("Mink & Co</string>");
  });
});

describe("servicePaths", () => {
  test("systemd uses ~/.config/systemd/user", () => {
    const paths = servicePaths("systemd");
    expect(paths.unitDir).toBe(join(homedir(), ".config", "systemd", "user"));
    expect(paths.unitFile).toBe(
      join(homedir(), ".config", "systemd", "user", "mink-daemon.service")
    );
  });

  test("launchd uses ~/Library/LaunchAgents", () => {
    const paths = servicePaths("launchd");
    expect(paths.unitDir).toBe(join(homedir(), "Library", "LaunchAgents"));
    expect(paths.unitFile).toBe(
      join(homedir(), "Library", "LaunchAgents", "com.mink.daemon.plist")
    );
  });
});

describe("detectPlatform", () => {
  test("maps the current process.platform to a supported service platform", () => {
    const expected =
      process.platform === "linux"
        ? "systemd"
        : process.platform === "darwin"
          ? "launchd"
          : null;
    expect(detectPlatform()).toBe(expected);
  });
});

describe("resolveServiceInvocation", () => {
  test("returns an absolute executable and a non-empty pathDir", () => {
    const inv = resolveServiceInvocation();
    expect(inv.executable.length).toBeGreaterThan(0);
    expect(inv.executable.startsWith("/")).toBe(true);
    expect(inv.pathDir.length).toBeGreaterThan(0);
    expect(inv.args[inv.args.length - 2]).toBe("daemon");
    expect(inv.args[inv.args.length - 1]).toBe("start");
  });
});
