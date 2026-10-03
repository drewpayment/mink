import { describe, expect, test } from "bun:test";
import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import { useMinkFixture } from "../helpers/mink-fixture";

describe("Codex CLI hook contract", () => {
  const fx = useMinkFixture("mink-codex-contract");
  const cli = resolve(import.meta.dir, "../../src/cli.ts");
  const run = (args: string[], input = "") => spawnSync(process.execPath, [cli, ...args], {
    cwd: fx.current.cwd,
    env: { ...process.env, MINK_ROOT_OVERRIDE: fx.current.minkRoot, MINK_WIKI_PATH: fx.current.wikiPath },
    input, encoding: "utf8", timeout: 10000,
  });

  test("installed lifecycle commands emit valid Codex JSON and report receipts separately from trust", () => {
    const install = run(["init", "--agent", "codex", "--yes"]);
    expect(install.status).toBe(0);
    expect(install.stdout).toContain("Codex /hooks");
    const config = JSON.parse(readFileSync(join(fx.current.cwd, ".codex", "hooks.json"), "utf8"));
    expect(config.hooks.PostToolUse).toBeUndefined();
    const before = JSON.parse(run(["codex-status"]).stdout);
    expect(before.execution).toBeNull();
    const start = run(["codex-hook"], JSON.stringify({
      hook_event_name: "SessionStart", session_id: "thr_123", source: "startup", cwd: fx.current.cwd,
    }));
    expect(start.status).toBe(0);
    expect(start.stderr).toBe("");
    expect(JSON.parse(start.stdout).hookSpecificOutput.hookEventName).toBe("SessionStart");
    const end = run(["codex-hook"], JSON.stringify({
      hook_event_name: "SessionEnd", session_id: "thr_123", reason: "other", cwd: fx.current.cwd,
    }));
    expect(end.status).toBe(0);
    expect(end.stdout).toBe("");
    const status = JSON.parse(run(["codex-status"]).stdout);
    expect(status.execution.lastEvent).toBe("SessionEnd");
    expect(status.hookTrust).toContain("unknown");
    expect(status.fileAccounting).toBe("not supported");
    expect(status.compression).toContain("disabled");
  });

  test("malformed input and non-lifecycle payloads exit successfully without output", () => {
    for (const input of ["{bad", "null", JSON.stringify({
      hook_event_name: "PostToolUse", session_id: "thr_123", tool_name: "Bash",
      tool_response: { content: [{ type: "image", data: "opaque" }] },
    })]) {
      const result = run(["codex-hook"], input);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
    }
  });
});
