import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { projectDir, projectMetaPath, minkRoot } from "../../src/core/paths";
import { listRegisteredProjects } from "../../src/core/project-registry";
import { atomicWriteJson } from "../../src/core/fs-utils";

function createTempProject(): string {
  const name = `mink-update-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = join(tmpdir(), name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("project registry", () => {
  let testCwd: string;

  beforeEach(() => {
    testCwd = createTempProject();
  });

  afterEach(() => {
    rmSync(testCwd, { recursive: true, force: true });
    try {
      rmSync(projectDir(testCwd), { recursive: true, force: true });
    } catch {}
  });

  test("listRegisteredProjects finds projects with meta", () => {
    const stateDir = projectDir(testCwd);
    mkdirSync(stateDir, { recursive: true });
    atomicWriteJson(join(stateDir, "project-meta.json"), {
      cwd: testCwd,
      name: "test-project",
      initTimestamp: "2024-01-01T00:00:00.000Z",
      version: "0.1.0",
    });

    const projects = listRegisteredProjects();
    const found = projects.find((p) => p.cwd === testCwd);
    expect(found).toBeDefined();
    expect(found!.name).toBe("test-project");
    expect(found!.version).toBe("0.1.0");
  });

  test("listRegisteredProjects skips dirs without meta", () => {
    const stateDir = projectDir(testCwd);
    mkdirSync(stateDir, { recursive: true });
    // Don't write project-meta.json

    const projects = listRegisteredProjects();
    const found = projects.find((p) => p.cwd === testCwd);
    expect(found).toBeUndefined();
  });
});
