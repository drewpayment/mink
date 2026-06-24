import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  buildPiExtension,
  installPi,
  removePi,
  piExtensionPath,
  piGuidanceSkillPath,
} from "../../src/core/agent-pi";

describe("buildPiExtension", () => {
  test("targets the portable `mink` bin shim for installed (dist) cli paths", () => {
    const src = buildPiExtension("/usr/local/bin/mink/dist/cli.js");
    expect(src).toContain('const MINK_CMD = "mink";');
    expect(src).toContain("const MINK_BASE_ARGS = [];");
    expect(src).not.toContain("/usr/local/bin");
  });

  test("falls back to `bun run <abs path>` for source-dev mode (.ts)", () => {
    const src = buildPiExtension("/repo/src/cli.ts");
    expect(src).toContain('const MINK_CMD = "bun";');
    expect(src).toContain('"run"');
    expect(src).toContain("/repo/src/cli.ts");
  });

  test("subscribes to the canonical Pi lifecycle and tool events", () => {
    const src = buildPiExtension("/path/cli.js");
    for (const evt of [
      "session_start",
      "agent_end",
      "session_shutdown",
      "tool_call",
      "tool_result",
    ]) {
      expect(src).toContain(`"${evt}"`);
    }
  });

  test("maps Pi file ops to Mink's canonical hook subcommands", () => {
    const src = buildPiExtension("/path/cli.js");
    for (const sub of [
      "session-start",
      "session-stop",
      "pre-read",
      "post-read",
      "pre-write",
      "post-write",
    ]) {
      expect(src).toContain(`"${sub}"`);
    }
    // Normalizes to Mink's Claude-shaped tool schema.
    expect(src).toContain('tool_name: "Read"');
    expect(src).toContain('tool_name: "Write"');
    expect(src).toContain('tool_name: "Edit"');
  });

  test("is a default-export factory and never throws into Pi", () => {
    const src = buildPiExtension("/path/cli.js");
    expect(src).toContain("export default function");
    // Spawn failures resolve to empty streams rather than rejecting.
    expect(src).toContain("finish(\"\", \"\")");
  });

  test("captures child stdout so it can read a compression replacement", () => {
    const src = buildPiExtension("/path/cli.js");
    // stdout is piped (not ignored) so the updatedToolOutput envelope is read.
    expect(src).toContain('stdio: ["pipe", "pipe", "pipe"]');
    expect(src).toContain("child.stdout");
    // Parses Claude Code's PostToolUse replacement envelope off stdout.
    expect(src).toContain("hookSpecificOutput");
    expect(src).toContain("updatedToolOutput");
  });

  test("routes Bash/Grep/Glob/MCP results through the post-tool compression hook", () => {
    const src = buildPiExtension("/path/cli.js");
    expect(src).toContain('"post-tool"');
    expect(src).toContain("compressibleName");
    // Canonical tool-name mapping the post-tool hook accepts.
    expect(src).toContain('return "Bash"');
    expect(src).toContain('return "Grep"');
    expect(src).toContain('return "Glob"');
    expect(src).toContain('startsWith("mcp__")');
  });

  test("substitutes a compression replacement into the tool result content", () => {
    const src = buildPiExtension("/path/cli.js");
    // buildResult swaps the result for the replacement, else appends advisory.
    expect(src).toContain("parseReplacement");
    expect(src).toContain("const buildResult");
    expect(src).toContain("replacement != null");
  });

  test("uses Pi's source-verified tool input field names", () => {
    const src = buildPiExtension("/path/cli.js");
    // read/write/edit all key off `path` (with file_path as a legacy alias).
    expect(src).toContain("input.path ?? input.file_path");
    // Pi's edit tool passes an array of { oldText, newText } replacements.
    expect(src).toContain("input.edits");
    expect(src).toContain("newText");
  });

  test("reads tool_result content from event.content (a content-block array)", () => {
    const src = buildPiExtension("/path/cli.js");
    expect(src).toContain("event?.content");
  });

  test("surfaces advisories by returning a modified tool result", () => {
    const src = buildPiExtension("/path/cli.js");
    // Documented mechanism: return { content, details, isError } from tool_result.
    expect(src).toContain("[...base, { type: \"text\", text: advisory }]");
    expect(src).toContain("isError: event.isError");
  });

  test("ignores extension hot-reloads when starting a session", () => {
    const src = buildPiExtension("/path/cli.js");
    expect(src).toContain('event?.reason === "reload"');
  });
});

// Drives the *generated* extension against a fake `mink` on PATH to prove the
// compression wiring end-to-end: spawn the hook, read its stdout envelope, and
// substitute the replacement into the Pi tool result.
describe("Pi extension behavior — compression wiring", () => {
  let dir: string;
  let binDir: string;
  let prevPath: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-pi-behavior-"));
    binDir = mkdtempSync(join(tmpdir(), "mink-pi-bin-"));
    prevPath = process.env.PATH;
  });

  afterEach(() => {
    if (prevPath !== undefined) process.env.PATH = prevPath;
    rmSync(dir, { recursive: true, force: true });
    rmSync(binDir, { recursive: true, force: true });
  });

  // Write a fake `mink` that discards stdin and, for `post-tool`, prints the
  // Claude-Code updatedToolOutput envelope on stdout. Other subcommands are
  // silent (the no-op path). `replacement` of null makes post-tool silent too.
  function installFakeMink(replacement: string | null): void {
    const body =
      replacement == null
        ? `cat >/dev/null 2>&1; exit 0`
        : `cat >/dev/null 2>&1
if [ "$1" = "post-tool" ] || [ "$1" = "post-read" ]; then
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PostToolUse","updatedToolOutput":${JSON.stringify(
    replacement
  )}}}'
fi
exit 0`;
    const p = join(binDir, "mink");
    require("fs").writeFileSync(p, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    process.env.PATH = `${binDir}:${process.env.PATH}`;
  }

  async function loadExtension(): Promise<(pi: unknown) => void> {
    // cli.js form → generated MINK_CMD = "mink" (resolved from PATH).
    const src = buildPiExtension("/pkg/dist/cli.js");
    const file = join(dir, `ext-${Math.random().toString(36).slice(2)}.ts`);
    require("fs").writeFileSync(file, src);
    const mod = await import(require("url").pathToFileURL(file).href);
    return mod.default as (pi: unknown) => void;
  }

  function makePi(handlers: Record<string, Function>) {
    return { ctx: { cwd: dir }, on: (evt: string, fn: Function) => (handlers[evt] = fn) };
  }

  test("substitutes a Bash result with the post-tool compression replacement", async () => {
    installFakeMink("COMPRESSED_OUTPUT");
    const handlers: Record<string, Function> = {};
    (await loadExtension())(makePi(handlers));

    const result = await handlers["tool_result"]({
      toolName: "bash",
      toolCallId: "c1",
      content: [{ type: "text", text: "x".repeat(5000) }],
      isError: false,
    });

    expect(result).toBeDefined();
    expect(result.content).toEqual([{ type: "text", text: "COMPRESSED_OUTPUT" }]);
    expect(result.isError).toBe(false);
  });

  test("leaves the result untouched when the hook emits no replacement", async () => {
    installFakeMink(null);
    const handlers: Record<string, Function> = {};
    (await loadExtension())(makePi(handlers));

    const result = await handlers["tool_result"]({
      toolName: "bash",
      toolCallId: "c2",
      content: [{ type: "text", text: "small" }],
      isError: false,
    });

    // No replacement, no advisory → undefined (Pi keeps the original result).
    expect(result).toBeUndefined();
  });

  test("ignores non-compressible tools (returns undefined)", async () => {
    installFakeMink("SHOULD_NOT_APPEAR");
    const handlers: Record<string, Function> = {};
    (await loadExtension())(makePi(handlers));

    const result = await handlers["tool_result"]({
      toolName: "browser",
      toolCallId: "c3",
      content: [{ type: "text", text: "page" }],
      isError: false,
    });

    expect(result).toBeUndefined();
  });
});

describe("installPi / removePi", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-pi-install-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes the extension and guidance skill", () => {
    const r = installPi(dir, "/path/cli.js");
    expect(existsSync(r.extensionPath)).toBe(true);
    expect(r.extensionPath).toBe(piExtensionPath(dir));
    expect(existsSync(r.guidancePath)).toBe(true);
    expect(r.guidancePath).toBe(piGuidanceSkillPath(dir));

    const guidance = readFileSync(r.guidancePath, "utf-8");
    expect(guidance).toContain("name: mink");
    expect(guidance).toContain("@drewpayment/mink");
    expect(guidance).toContain(".pi/extensions/mink.ts");
  });

  test("copies the mink-note skill from the package source", () => {
    const r = installPi(dir, "/path/cli.js");
    // The package ships skills/mink-note, so the copy should succeed.
    expect(r.notePath).not.toBeNull();
    expect(existsSync(r.notePath!)).toBe(true);
    expect(readFileSync(r.notePath!, "utf-8")).toContain("mink-note");
  });

  test("is idempotent — re-install overwrites, does not duplicate", () => {
    installPi(dir, "/path/cli.js");
    installPi(dir, "/path/cli.js");
    const src = readFileSync(piExtensionPath(dir), "utf-8");
    // A single AUTO-GENERATED header — the file was replaced, not appended.
    expect(src.split("AUTO-GENERATED").length - 1).toBe(1);
  });

  test("removePi deletes only Mink's Pi wiring", () => {
    const r = installPi(dir, "/path/cli.js");
    removePi(dir);
    expect(existsSync(r.extensionPath)).toBe(false);
    expect(existsSync(join(dir, ".pi", "skills", "mink"))).toBe(false);
    expect(existsSync(join(dir, ".pi", "skills", "mink-note"))).toBe(false);
  });
});
