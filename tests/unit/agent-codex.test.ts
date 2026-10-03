import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { installCodex, removeCodexHooks, readCodexConfig, codexProjectRoot } from "../../src/core/agent-codex";
import { handleCodexHook } from "../../src/commands/codex-hook";
import { init } from "../../src/commands/init";
import { refreshProjectHooks } from "../../src/core/hook-refresh";
import { projectMetaPath, projectDir, sessionPath } from "../../src/core/paths";
import { atomicWriteJson, safeReadJson } from "../../src/core/fs-utils";
import { getOrCreateDeviceId } from "../../src/core/device";
import { useMinkFixture } from "../helpers/mink-fixture";

describe("experimental Codex adapter", () => {
  const fx = useMinkFixture("mink-codex");
  const event = (name = "SessionStart", id = "thread-one") => ({
    session_id: id, hook_event_name: name, source: "startup",
    transcript_path: "/private/transcript", prompt: "must not persist",
  });
  const receipts = () => {
    const dir = join(projectDir(fx.current.cwd), "state", getOrCreateDeviceId(), "codex-hooks");
    return readdirSync(dir).map((f) => safeReadJson(join(dir, f)) as any);
  };
  const setup = () => {
    const cwd = fx.current.cwd;
    atomicWriteJson(projectMetaPath(cwd), { cwd, name: "codex-project" });
    installCodex(cwd, "/installed/dist/cli.js");
    return cwd;
  };

  test("installs portable lifecycle hooks and shared note skill; repeats are idempotent", () => {
    const cwd = setup();
    const initial = readCodexConfig(cwd);
    installCodex(cwd, "/different/machine/dist/cli.js");
    expect(readCodexConfig(cwd)).toEqual(initial);
    expect(Object.keys(initial.hooks!)).toEqual(["SessionStart", "SessionEnd"]);
    expect(initial.hooks!.SessionStart[0].hooks[0].command).toBe("mink codex-hook");
    expect(existsSync(join(cwd, ".agents", "skills", "mink-note", "SKILL.md"))).toBe(true);
    expect(existsSync(join(cwd, "AGENTS.md"))).toBe(false);
    expect(existsSync(join(cwd, ".codex", "config.toml"))).toBe(false);
  });

  test("preserves other handlers within mixed groups, unknown events and top-level settings", () => {
    const cwd = fx.current.cwd;
    const other = { type: "command", command: "echo keep-this" };
    atomicWriteJson(join(cwd, ".codex", "hooks.json"), {
      description: "user settings", hooks: {
        SessionStart: [{ matcher: "resume", hooks: [other, { type: "command", command: "mink codex-hook" }] }],
        PostToolUse: [{ hooks: [other] }],
      },
    });
    installCodex(cwd, "/pkg/dist/cli.js");
    expect(readCodexConfig(cwd).hooks!.SessionStart[0]).toEqual({ matcher: "resume", hooks: [other] });
    removeCodexHooks(cwd);
    expect(readCodexConfig(cwd)).toEqual({ description: "user settings", hooks: {
      SessionStart: [{ matcher: "resume", hooks: [other] }],
      SessionEnd: [], PostToolUse: [{ hooks: [other] }],
    } });
  });

  test("source paths containing spaces and shell metacharacters remain quoted and replaceable", () => {
    const cwd = fx.current.cwd;
    const path = "/tmp/mink's $(echo unsafe) repo/src/cli.ts";
    installCodex(cwd, path);
    installCodex(cwd, path);
    const config = readCodexConfig(cwd);
    expect(config.hooks!.SessionStart).toHaveLength(1);
    expect(config.hooks!.SessionStart[0].hooks[0].command).toContain("mink'\\''s $(echo unsafe)");
    installCodex(cwd, "/pkg/dist/cli.js");
    expect(readCodexConfig(cwd).hooks!.SessionStart).toHaveLength(1);
  });

  test("invalid existing config fails without replacing it", () => {
    const path = join(fx.current.cwd, ".codex", "hooks.json");
    mkdirSync(join(fx.current.cwd, ".codex"));
    writeFileSync(path, "{broken");
    expect(() => installCodex(fx.current.cwd, "/pkg/dist/cli.js")).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{broken");
  });

  test("startup returns Codex context, preserves shared session state and excludes private input", () => {
    const cwd = setup();
    atomicWriteJson(sessionPath(cwd), { existingClaudeSession: true });
    const response = handleCodexHook(cwd, event()) as any;
    expect(response.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(response.hookSpecificOutput.additionalContext).toContain("compression are not enabled");
    expect(safeReadJson(sessionPath(cwd))).toEqual({ existingClaudeSession: true });
    expect(receipts()).toHaveLength(1);
    expect(JSON.stringify(receipts())).not.toContain("private");
    expect(JSON.stringify(receipts())).not.toContain("thread-one");
    expect(JSON.stringify(receipts())).not.toContain("must not persist");
  });

  test("resume and compact preserve start time; concurrent threads and end events stay separate", () => {
    const cwd = setup();
    handleCodexHook(cwd, event());
    const first = receipts()[0];
    handleCodexHook(cwd, { ...event(), source: "resume" });
    handleCodexHook(cwd, { ...event(), source: "compact" });
    expect(receipts()[0].startedAt).toBe(first.startedAt);
    handleCodexHook(cwd, event("SessionStart", "thread-two"));
    expect(handleCodexHook(cwd, event("SessionEnd"))).toBeNull();
    const after = receipts();
    expect(after).toHaveLength(2);
    expect(after.filter((r) => r.endedAt)).toHaveLength(1);
    const ended = after.find((r) => r.endedAt);
    handleCodexHook(cwd, event("SessionEnd"));
    expect(receipts().find((r) => r.endedAt).endedAt).toBe(ended.endedAt);
  });

  test("Stop, tool payloads, malformed events and unknown session ends are ignored", () => {
    const cwd = setup();
    for (const input of [null, {}, event("Stop"), event("SessionEnd"), {
      ...event("PostToolUse"), tool_response: { content: [{ type: "image", data: "opaque" }] },
    }]) expect(handleCodexHook(cwd, input)).toBeNull();
    expect(existsSync(join(projectDir(cwd), "state", getOrCreateDeviceId(), "codex-hooks"))).toBe(false);
  });

  test("subdirectory invocation resolves the installed project", () => {
    const cwd = setup();
    const nested = join(cwd, "src", "nested");
    mkdirSync(nested, { recursive: true });
    expect(codexProjectRoot(nested)).toBe(cwd);
    handleCodexHook(nested, event());
    expect(receipts()).toHaveLength(1);
  });

  test("init and refresh wire Codex without installing another assistant", async () => {
    const cwd = fx.current.cwd;
    await init(cwd, { targets: ["codex"] });
    expect((safeReadJson(projectMetaPath(cwd)) as any).agents).toEqual(["codex"]);
    expect(refreshProjectHooks(cwd, { force: true }).refreshed).toBe(true);
    expect(readCodexConfig(cwd).hooks!.SessionStart).toHaveLength(1);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
    expect(existsSync(join(cwd, ".pi"))).toBe(false);
  });
});
