import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getProjectMeta,
  addProjectAlias,
  setProjectPathForDevice,
  findProjectDirByIdOrAlias,
  listRegisteredProjects,
} from "../../src/core/project-registry";

let mockRoot: string;

beforeEach(() => {
  mockRoot = mkdtempSync(join(tmpdir(), "mink-registry-test-"));
  process.env.MINK_ROOT_OVERRIDE = mockRoot;
});

afterEach(() => {
  delete process.env.MINK_ROOT_OVERRIDE;
  rmSync(mockRoot, { recursive: true, force: true });
});

function seedProject(id: string, meta: Record<string, unknown>): string {
  const projDir = join(mockRoot, "projects", id);
  mkdirSync(projDir, { recursive: true });
  writeFileSync(join(projDir, "project-meta.json"), JSON.stringify(meta));
  return projDir;
}

describe("getProjectMeta", () => {
  test("reads legacy v2 meta without aliases or pathsByDevice", () => {
    const dir = seedProject("legacy", {
      cwd: "/path/legacy",
      name: "legacy",
      version: "0.1.0",
      initTimestamp: "2026-01-01T00:00:00Z",
    });
    const meta = getProjectMeta(dir);
    expect(meta).not.toBeNull();
    expect(meta!.cwd).toBe("/path/legacy");
    expect(meta!.aliases).toBeUndefined();
    expect(meta!.pathsByDevice).toBeUndefined();
  });

  test("reads v3 meta with aliases and pathsByDevice", () => {
    const dir = seedProject("modern", {
      cwd: "/path/modern",
      name: "modern",
      version: "0.1.0",
      initTimestamp: "2026-01-01T00:00:00Z",
      aliases: ["old-id-1", "old-id-2"],
      pathsByDevice: { "dev-A": "/path/modern-a", "dev-B": "/path/modern-b" },
    });
    const meta = getProjectMeta(dir);
    expect(meta!.aliases).toEqual(["old-id-1", "old-id-2"]);
    expect(meta!.pathsByDevice).toEqual({
      "dev-A": "/path/modern-a",
      "dev-B": "/path/modern-b",
    });
  });

  test("filters out non-string entries from aliases and pathsByDevice", () => {
    const dir = seedProject("corrupt", {
      cwd: "/path/c",
      name: "c",
      aliases: ["good", 42, null, "also-good"],
      pathsByDevice: { good: "/p", broken: 99 },
    });
    const meta = getProjectMeta(dir);
    expect(meta!.aliases).toEqual(["good", "also-good"]);
    expect(meta!.pathsByDevice).toEqual({ good: "/p" });
  });
});

describe("addProjectAlias", () => {
  test("appends an alias and deduplicates", () => {
    const dir = seedProject("p", { cwd: "/p", name: "p" });
    expect(addProjectAlias(dir, "old-a")).toBe(true);
    expect(addProjectAlias(dir, "old-a")).toBe(false);
    expect(addProjectAlias(dir, "old-b")).toBe(true);
    const meta = getProjectMeta(dir);
    expect(meta!.aliases).toEqual(["old-a", "old-b"]);
  });

  test("preserves unknown fields on write", () => {
    const dir = seedProject("p", {
      cwd: "/p",
      name: "p",
      projectType: "notes",
      futureField: { nested: true },
    });
    addProjectAlias(dir, "old-id");
    const raw = JSON.parse(
      readFileSync(join(dir, "project-meta.json"), "utf-8")
    );
    expect(raw.projectType).toBe("notes");
    expect(raw.futureField).toEqual({ nested: true });
    expect(raw.aliases).toEqual(["old-id"]);
  });
});

describe("setProjectPathForDevice", () => {
  test("seeds map from legacy singular cwd when the map is empty", () => {
    const dir = seedProject("p", { cwd: "/old-cwd", name: "p" });
    setProjectPathForDevice(dir, "dev-NEW", "/new-cwd");
    const meta = getProjectMeta(dir);
    // The legacy cwd was kept under a deterministic device id (the prior
    // owner). The new device's entry was added too.
    expect(meta!.pathsByDevice).toBeDefined();
    expect(meta!.pathsByDevice!["dev-NEW"]).toBe("/new-cwd");
  });

  test("overwrites only the current device's entry", () => {
    const dir = seedProject("p", {
      cwd: "/p",
      name: "p",
      pathsByDevice: { "dev-A": "/a", "dev-B": "/b" },
    });
    setProjectPathForDevice(dir, "dev-A", "/new-a");
    const meta = getProjectMeta(dir);
    expect(meta!.pathsByDevice).toEqual({
      "dev-A": "/new-a",
      "dev-B": "/b",
    });
  });
});

describe("findProjectDirByIdOrAlias", () => {
  test("returns the primary directory when the id matches a directory name", () => {
    const dir = seedProject("primary", { cwd: "/p", name: "primary" });
    expect(findProjectDirByIdOrAlias("primary")).toBe(dir);
  });

  test("walks alias lists when the id is not a directory name", () => {
    const dir = seedProject("new-id", {
      cwd: "/p",
      name: "new-id",
      aliases: ["old-id-A", "old-id-B"],
    });
    expect(findProjectDirByIdOrAlias("old-id-A")).toBe(dir);
    expect(findProjectDirByIdOrAlias("old-id-B")).toBe(dir);
    expect(findProjectDirByIdOrAlias("never-existed")).toBeNull();
  });
});

describe("listRegisteredProjects", () => {
  test("surfaces aliases and pathsByDevice on the registered project record", () => {
    seedProject("p", {
      cwd: "/p",
      name: "p",
      aliases: ["legacy"],
      pathsByDevice: { d1: "/p1" },
    });
    const list = listRegisteredProjects();
    const found = list.find((p) => p.id === "p");
    expect(found).toBeDefined();
    expect(found!.aliases).toEqual(["legacy"]);
    expect(found!.pathsByDevice).toEqual({ d1: "/p1" });
  });
});
