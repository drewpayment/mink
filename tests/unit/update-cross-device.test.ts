import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveLocalCwd, update } from "../../src/commands/update";
import { projectDir, projectMetaPath } from "../../src/core/paths";
import { atomicWriteJson } from "../../src/core/fs-utils";

// See issue #95: `mink update` used to iterate every registered project and
// mkdir into its raw `cwd`, which explodes on macOS when the path belongs to
// another device (autofs sockets under /home/… return ENOTSUP and the whole
// batch aborts). These tests pin the new behavior — foreign projects are
// skipped and one bad project no longer nukes the run.

describe("resolveLocalCwd", () => {
  const local = "/local/path";
  const remote = "/home/other/proj";
  const thisDevice = "device-a";
  const otherDevice = "device-b";

  test("prefers pathsByDevice[currentDevice] when present", () => {
    const got = resolveLocalCwd(
      {
        id: "p",
        cwd: remote,
        name: "p",
        version: "0.1.0",
        aliases: [],
        pathsByDevice: { [thisDevice]: local, [otherDevice]: remote },
      },
      thisDevice
    );
    expect(got).toBe(local);
  });

  test("returns null when pathsByDevice exists but has no entry for us", () => {
    const got = resolveLocalCwd(
      {
        id: "p",
        cwd: remote,
        name: "p",
        version: "0.1.0",
        aliases: [],
        pathsByDevice: { [otherDevice]: remote },
      },
      thisDevice
    );
    expect(got).toBeNull();
  });

  test("falls back to legacy singular cwd when no map is present", () => {
    const got = resolveLocalCwd(
      {
        id: "p",
        cwd: local,
        name: "p",
        version: "0.1.0",
        aliases: [],
        pathsByDevice: {},
      },
      thisDevice
    );
    expect(got).toBe(local);
  });

  test("returns null when neither map nor cwd is usable", () => {
    const got = resolveLocalCwd(
      {
        id: "p",
        cwd: "",
        name: "p",
        version: "0.1.0",
        aliases: [],
        pathsByDevice: {},
      },
      thisDevice
    );
    expect(got).toBeNull();
  });
});

describe("update() cross-device batch", () => {
  let minkRoot: string;
  let localCwd: string;
  const prevRoot = process.env.MINK_ROOT_OVERRIDE;

  beforeEach(() => {
    minkRoot = mkdtempSync(join(tmpdir(), "mink-update-root-"));
    localCwd = mkdtempSync(join(tmpdir(), "mink-update-local-"));
    process.env.MINK_ROOT_OVERRIDE = minkRoot;
    // Seed a stable device id so pathsByDevice lookups are deterministic.
    writeFileSync(join(minkRoot, "device-id"), "test-device\n");
  });

  afterEach(() => {
    rmSync(minkRoot, { recursive: true, force: true });
    rmSync(localCwd, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env.MINK_ROOT_OVERRIDE;
    else process.env.MINK_ROOT_OVERRIDE = prevRoot;
  });

  function registerProject(
    cwd: string,
    name: string,
    pathsByDevice: Record<string, string> | null
  ) {
    const stateDir = projectDir(cwd);
    mkdirSync(stateDir, { recursive: true });
    const meta: Record<string, unknown> = {
      cwd,
      name,
      initTimestamp: "2024-01-01T00:00:00.000Z",
      version: "0.1.0",
    };
    if (pathsByDevice) meta.pathsByDevice = pathsByDevice;
    atomicWriteJson(join(stateDir, "project-meta.json"), meta);
  }

  test("skips projects registered only on other devices", async () => {
    // Foreign project — no entry for us. Path deliberately points at a
    // location that would fail if we tried to mkdir into it.
    registerProject("/home/other-user/foreign-proj", "foreign", {
      "some-other-device": "/home/other-user/foreign-proj",
    });
    // Local project we should actually update.
    registerProject(localCwd, "local", { "test-device": localCwd });

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.join(" "));
    };
    try {
      await update(localCwd, []);
    } finally {
      console.log = origLog;
    }

    // Batch survived — local project got its hooks.
    expect(existsSync(join(localCwd, ".claude", "settings.json"))).toBe(true);
    // And the foreign project was surfaced as skipped, not silently dropped.
    const skipLine = logs.find(
      (l) => l.includes("foreign") || l.includes("not registered on this device")
    );
    expect(skipLine).toBeDefined();
  });

  test("skips projects whose local path is missing on disk", async () => {
    const gonePath = join(tmpdir(), "mink-update-gone-" + Date.now());
    // Register a project pointing at a path that never existed (legacy
    // single-device meta, cwd points at nothing).
    registerProject(gonePath, "gone", null);
    registerProject(localCwd, "local", null);

    await update(localCwd, []);

    expect(existsSync(join(localCwd, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(gonePath, ".claude", "settings.json"))).toBe(false);
  });

  test("preserves pathsByDevice when refreshing metadata", async () => {
    const preserved = {
      "test-device": localCwd,
      "other-device": "/home/other/proj",
    };
    registerProject(localCwd, "local", preserved);

    await update(localCwd, []);

    const meta = JSON.parse(
      readFileSync(projectMetaPath(localCwd), "utf-8")
    ) as Record<string, unknown>;
    expect(meta.pathsByDevice).toEqual(preserved);
    expect(meta.cwd).toBe(localCwd);
    expect(meta.name).toBe("local");
  });
});
