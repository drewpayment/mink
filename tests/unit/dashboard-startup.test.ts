import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson } from "../../src/core/fs-utils";
import { projectDir } from "../../src/core/paths";
import { resolveStartupCwd } from "../../src/commands/dashboard";
import type { RegisteredProject } from "../../src/core/project-registry";

function makeRegistered(name: string, cwd: string): RegisteredProject {
  return {
    id: `id-${name}`,
    cwd,
    name,
    version: "0.1.0",
  };
}

describe("resolveStartupCwd", () => {
  let initializedCwd: string;

  beforeEach(() => {
    initializedCwd = join(
      tmpdir(),
      `mink-dash-startup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(initializedCwd, { recursive: true });
    const stateDir = projectDir(initializedCwd);
    mkdirSync(stateDir, { recursive: true });
    atomicWriteJson(join(stateDir, "project-meta.json"), {
      cwd: initializedCwd,
      name: "active",
      initTimestamp: "2024-01-01T00:00:00.000Z",
      version: "0.1.0",
    });
  });

  afterEach(() => {
    rmSync(initializedCwd, { recursive: true, force: true });
    try {
      rmSync(projectDir(initializedCwd), { recursive: true, force: true });
    } catch {}
  });

  test("uses cwd directly when it is an initialized mink project", () => {
    const result = resolveStartupCwd(initializedCwd, []);
    expect(result.kind).toBe("active");
    if (result.kind === "active") {
      expect(result.cwd).toBe(initializedCwd);
    }
  });

  test("falls back to first registered project (sorted by name) when cwd is unrelated", () => {
    const unrelated = join(tmpdir(), `not-a-mink-project-${Date.now()}`);
    const registered = [
      makeRegistered("zebra", "/tmp/zebra"),
      makeRegistered("alpha", "/tmp/alpha"),
      makeRegistered("mango", "/tmp/mango"),
    ];

    const result = resolveStartupCwd(unrelated, registered);
    expect(result.kind).toBe("fallback");
    if (result.kind === "fallback") {
      expect(result.project.name).toBe("alpha");
      expect(result.cwd).toBe("/tmp/alpha");
    }
  });

  test("returns 'none' when cwd is unrelated and no projects are registered", () => {
    const unrelated = join(tmpdir(), `not-a-mink-project-${Date.now()}`);
    const result = resolveStartupCwd(unrelated, []);
    expect(result.kind).toBe("none");
  });
});
