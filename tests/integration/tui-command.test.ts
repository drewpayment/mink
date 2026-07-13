import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson } from "../../src/core/fs-utils";
import { projectDir } from "../../src/core/paths";
import { tui } from "../../src/commands/tui";

// The tui command must never touch the terminal (no alternate-screen/raw-mode
// escape codes, no lingering timers or listeners) when stdout isn't a real
// TTY — this is the guard that protects piped/CI invocations like
// `mink tui | cat`. We simulate that by flipping process.stdout.isTTY off
// for the duration of the call, matching how the command's isInteractive()
// check reads it.

describe("tui command — non-TTY guard", () => {
  let projectCwd: string;
  let originalStdoutIsTTY: boolean | undefined;
  let originalStdinIsTTY: boolean | undefined;
  let logs: string[];
  let originalLog: typeof console.log;

  beforeEach(() => {
    projectCwd = join(tmpdir(), `mink-tui-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(projectCwd, { recursive: true });
    const stateDir = projectDir(projectCwd);
    mkdirSync(stateDir, { recursive: true });
    atomicWriteJson(join(stateDir, "project-meta.json"), {
      cwd: projectCwd,
      name: "tui-cmd-fixture",
      initTimestamp: "2024-01-01T00:00:00.000Z",
      version: "0.1.0",
    });

    originalStdoutIsTTY = process.stdout.isTTY;
    originalStdinIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    logs = [];
    originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdoutIsTTY, configurable: true });
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdinIsTTY, configurable: true });
    console.log = originalLog;
    rmSync(projectCwd, { recursive: true, force: true });
    try {
      rmSync(projectDir(projectCwd), { recursive: true, force: true });
    } catch {}
  });

  test("returns cleanly with a notice and no ANSI escape codes", async () => {
    await tui(projectCwd, []);

    expect(logs.length).toBeGreaterThan(0);
    const combined = logs.join("\n");
    expect(combined).toContain("mink tui requires an interactive terminal");
    expect(combined).not.toContain("\x1b");
  });

  test("does not leave stdin in raw mode or subscribe listeners", async () => {
    const dataListenersBefore = process.stdin.listenerCount("data");
    const resizeListenersBefore = process.stdout.listenerCount("resize");

    await tui(projectCwd, []);

    expect(process.stdin.listenerCount("data")).toBe(dataListenersBefore);
    expect(process.stdout.listenerCount("resize")).toBe(resizeListenersBefore);
  });
});
