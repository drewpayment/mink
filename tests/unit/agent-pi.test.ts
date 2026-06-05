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
    // Spawn failures resolve to an empty advisory rather than rejecting.
    expect(src).toContain("finish(\"\")");
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
