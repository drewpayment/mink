import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { init } from "../../src/commands/init";
import { refreshHooksIfStale, refreshProjectHooks } from "../../src/core/hook-refresh";
import { safeReadJson, atomicWriteJson } from "../../src/core/fs-utils";
import { projectMetaPath } from "../../src/core/paths";
import { getInstallInfo } from "../../src/core/self-update";

describe("hook self-heal (refreshProjectHooks)", () => {
  let cwd: string;
  let minkRoot: string;
  const prevRoot = process.env.MINK_ROOT_OVERRIDE;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "mink-refresh-cwd-"));
    minkRoot = mkdtempSync(join(tmpdir(), "mink-refresh-root-"));
    process.env.MINK_ROOT_OVERRIDE = minkRoot;
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "t" }));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(minkRoot, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.MINK_ROOT_OVERRIDE;
    else process.env.MINK_ROOT_OVERRIDE = prevRoot;
  });

  const meta = () => safeReadJson(projectMetaPath(cwd)) as Record<string, unknown> | null;
  const setStamp = (v: string | null) => {
    const m = meta()!;
    if (v === null) delete m.hooksVersion;
    else m.hooksVersion = v;
    atomicWriteJson(projectMetaPath(cwd), m);
  };

  test("init stamps the current Mink version", async () => {
    await init(cwd, { targets: ["claude"] });
    expect(meta()?.hooksVersion).toBe(getInstallInfo().currentVersion);
  });

  test("up-to-date stamp is a no-op", async () => {
    await init(cwd, { targets: ["claude"] });
    const r = refreshHooksIfStale(cwd);
    expect(r.refreshed).toBe(false);
    expect(r.agents).toEqual(["claude"]);
  });

  test("a stale stamp regenerates the configured hooks and re-stamps", async () => {
    await init(cwd, { targets: ["claude"] });
    setStamp("0.0.1"); // pretend an older version generated the hooks
    rmSync(join(cwd, ".claude", "settings.json"), { force: true });

    const r = refreshHooksIfStale(cwd);
    expect(r.refreshed).toBe(true);
    expect(r.agents).toEqual(["claude"]);
    // Hooks were regenerated...
    expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(true);
    // ...and the stamp now matches the running version.
    expect(meta()?.hooksVersion).toBe(getInstallInfo().currentVersion);
  });

  test("only regenerates the agents the project already uses", async () => {
    await init(cwd, { targets: ["pi"] });
    setStamp("0.0.1");
    rmSync(join(cwd, ".pi"), { recursive: true, force: true });

    const r = refreshHooksIfStale(cwd);
    expect(r.refreshed).toBe(true);
    expect(existsSync(join(cwd, ".pi", "extensions", "mink.ts"))).toBe(true);
    // A pi-only project must not gain Claude wiring.
    expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(false);
  });

  test("force regenerates even when the stamp is current", async () => {
    await init(cwd, { targets: ["claude"] });
    rmSync(join(cwd, ".claude", "settings.json"), { force: true });

    const r = refreshProjectHooks(cwd, { force: true });
    expect(r.refreshed).toBe(true);
    expect(existsSync(join(cwd, ".claude", "settings.json"))).toBe(true);
  });

  test("a project that was never initialized here is skipped", () => {
    const r = refreshHooksIfStale(cwd);
    expect(r.refreshed).toBe(false);
    expect(r.agents).toEqual([]);
  });
});
