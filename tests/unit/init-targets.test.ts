import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { init } from "../../src/commands/init";
import { safeReadJson } from "../../src/core/fs-utils";
import { projectMetaPath } from "../../src/core/paths";

describe("init with explicit targets", () => {
  let cwd: string;
  let minkRoot: string;
  const prevRoot = process.env.MINK_ROOT_OVERRIDE;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mink-targets-cwd-"));
    minkRoot = mkdtempSync(join(tmpdir(), "mink-targets-root-"));
    process.env.MINK_ROOT_OVERRIDE = minkRoot;
    // A package.json lets seed/scan run without surprises.
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "t" }));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(minkRoot, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.MINK_ROOT_OVERRIDE;
    else process.env.MINK_ROOT_OVERRIDE = prevRoot;
  });

  const meta = () =>
    safeReadJson(projectMetaPath(cwd)) as Record<string, unknown> | null;

  test("targeting only pi wires .pi/ and not .claude/", async () => {
    await init(cwd, { targets: ["pi"] });

    expect(existsSync(join(cwd, ".pi", "extensions", "mink.ts"))).toBe(true);
    expect(existsSync(join(cwd, ".pi", "skills", "mink", "SKILL.md"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(false);
    expect(meta()?.agents).toEqual(["pi"]);
  });

  test("targeting only claude wires .claude/ and not .pi/", async () => {
    await init(cwd, { targets: ["claude"] });

    expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(cwd, ".claude", "rules", "mink.md"))).toBe(true);
    expect(existsSync(join(cwd, ".pi", "extensions", "mink.ts"))).toBe(false);
    expect(meta()?.agents).toEqual(["claude"]);
  });

  test("targeting all wires both hosts", async () => {
    await init(cwd, { targets: ["claude", "pi"] });

    expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(cwd, ".pi", "extensions", "mink.ts"))).toBe(true);
    expect((meta()?.agents as string[]).sort()).toEqual(["claude", "pi"]);
  });

  test("single-target re-init unions agents rather than unwiring the other", async () => {
    await init(cwd, { targets: ["claude"] });
    await init(cwd, { targets: ["pi"] });

    // Both remain wired on disk and recorded in metadata.
    expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(cwd, ".pi", "extensions", "mink.ts"))).toBe(true);
    expect((meta()?.agents as string[]).sort()).toEqual(["claude", "pi"]);
  });
});
