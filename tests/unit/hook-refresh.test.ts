import { describe, expect, test, beforeEach } from "bun:test";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { init } from "../../src/commands/init";
import { refreshHooksIfStale, refreshProjectHooks } from "../../src/core/hook-refresh";
import { safeReadJson, atomicWriteJson } from "../../src/core/fs-utils";
import { projectMetaPath } from "../../src/core/paths";
import { getInstallInfo } from "../../src/core/self-update";
import { useMinkFixture } from "../helpers/mink-fixture";

describe("hook self-heal (refreshProjectHooks)", () => {
  const fx = useMinkFixture("mink-refresh");
  let cwd: string;

  beforeEach(() => {
    cwd = fx.current.cwd;
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "t" }));
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

  const legacyMeta = () => {
    const m = meta()!;
    delete m.agents;
    delete m.hooksVersion;
    m.pathsByDevice = { local: cwd, remote: "/another/device/repo" };
    atomicWriteJson(projectMetaPath(cwd), m);
    return m;
  };

  test("legacy Claude wiring migrates, preserves mixed hooks and metadata, then is idempotent", async () => {
    await init(cwd, { targets: ["claude"] });
    const original = legacyMeta();
    const settingsPath = join(cwd, ".claude", "settings.json");
    const other = { type: "command", command: "echo keep-me" };
    atomicWriteJson(settingsPath, {
      permissions: { allow: ["Read"] },
      hooks: { SessionStart: [{ matcher: "startup", hooks: [
        { type: "command", command: "node /old/install/cli.js session-start" }, other,
      ] }] },
    });
    const r = refreshHooksIfStale(cwd);
    expect(r.refreshed).toBe(true);
    expect(r.agents).toEqual(["claude"]);
    expect(meta()).toEqual({ ...original, agents: ["claude"], hooksVersion: r.version });
    const settings = safeReadJson(settingsPath) as any;
    expect(settings.permissions).toEqual({ allow: ["Read"] });
    expect(settings.hooks.SessionStart[0]).toEqual({ matcher: "startup", hooks: [other] });
    expect(settings.hooks.PostToolUse.some((e: any) => e.matcher === "Bash")).toBe(true);
    expect(existsSync(join(cwd, ".pi"))).toBe(false);
    const contents = readFileSync(settingsPath, "utf8");
    expect(refreshHooksIfStale(cwd).refreshed).toBe(false);
    expect(readFileSync(settingsPath, "utf8")).toBe(contents);
  });

  test("legacy Pi wiring migrates without enabling Claude", async () => {
    await init(cwd, { targets: ["pi"] });
    legacyMeta();
    const r = refreshProjectHooks(cwd, { force: true });
    expect(r.refreshed).toBe(true);
    expect(meta()?.agents).toEqual(["pi"]);
    expect(existsSync(join(cwd, ".claude"))).toBe(false);
  });

  test("legacy mixed installation recovers both agents even with a current stamp", async () => {
    await init(cwd, { targets: ["claude", "pi"] });
    legacyMeta();
    setStamp(getInstallInfo().currentVersion);
    expect(refreshHooksIfStale(cwd).agents).toEqual(["claude", "pi"]);
    expect(meta()?.agents).toEqual(["claude", "pi"]);
  });

  test("host directories and an unrelated mink.ts are not evidence of Mink ownership", () => {
    atomicWriteJson(projectMetaPath(cwd), { cwd, name: "legacy" });
    atomicWriteJson(join(cwd, ".claude", "settings.json"), {
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "echo hello" }] }] },
    });
    mkdirSync(join(cwd, ".pi", "extensions"), { recursive: true });
    writeFileSync(join(cwd, ".pi", "extensions", "mink.ts"), "// User-owned extension\n");
    const before = meta();
    const r = refreshProjectHooks(cwd, { force: true });
    expect(r.refreshed).toBe(false);
    expect(r.reason).toContain("mink init --agent");
    expect(meta()).toEqual(before);
    expect(readFileSync(join(cwd, ".pi", "extensions", "mink.ts"), "utf8")).toBe("// User-owned extension\n");
  });

  test("an explicit empty agents list is respected", async () => {
    await init(cwd, { targets: ["claude"] });
    atomicWriteJson(projectMetaPath(cwd), { ...meta(), agents: [] });
    expect(refreshProjectHooks(cwd, { force: true }).refreshed).toBe(false);
    expect(meta()?.agents).toEqual([]);
  });

  test("failed installation is not stamped as current and can retry", async () => {
    await init(cwd, { targets: ["claude", "pi"] });
    setStamp("0.0.1");
    rmSync(join(cwd, ".pi"), { recursive: true });
    writeFileSync(join(cwd, ".pi"), "blocks directory creation");
    expect(refreshHooksIfStale(cwd).refreshed).toBe(false);
    expect(meta()?.hooksVersion).toBe("0.0.1");
    rmSync(join(cwd, ".pi"));
    expect(refreshHooksIfStale(cwd).refreshed).toBe(true);
  });
});
