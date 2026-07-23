import { describe, expect, test, beforeEach } from "bun:test";
import { existsSync, writeFileSync } from "fs";
import { join } from "path";
import { init } from "../../src/commands/init";
import { safeReadJson } from "../../src/core/fs-utils";
import { projectMetaPath } from "../../src/core/paths";
import { useMinkFixture } from "../helpers/mink-fixture";

describe("init with explicit targets", () => {
  const fx = useMinkFixture("mink-targets");
  let cwd: string;

  beforeEach(() => {
    cwd = fx.current.cwd;
    // A package.json lets seed/scan run without surprises.
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "t" }));
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
