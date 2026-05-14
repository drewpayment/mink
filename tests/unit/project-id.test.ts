import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execSync } from "child_process";
import {
  generateProjectId,
  resolveProjectIdentity,
  readProjectOverride,
  validateProjectIdentifier,
} from "../../src/core/project-id";

describe("generateProjectId", () => {
  test("returns slugified basename with hash suffix", () => {
    const id = generateProjectId("/Users/drew/dev/my-project");
    // Format: <slug>-<6 hex chars>
    expect(id).toMatch(/^my-project-[a-f0-9]{6}$/);
  });

  test("is deterministic for the same path", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/dev/my-project");
    expect(a).toBe(b);
  });

  test("produces different IDs for same basename in different directories", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/work/my-project");
    expect(a).not.toBe(b);
  });

  test("handles uppercase and special characters in basename", () => {
    const id = generateProjectId("/Users/drew/dev/My Cool_Project!");
    expect(id).toMatch(/^my-cool-project-[a-f0-9]{6}$/);
  });

  test("handles trailing slashes", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/dev/my-project/");
    expect(a).toBe(b);
  });
});

describe("validateProjectIdentifier", () => {
  test("accepts well-formed identifiers", () => {
    expect(validateProjectIdentifier("my-project")).toBe(true);
    expect(validateProjectIdentifier("svc.api.v2")).toBe(true);
    expect(validateProjectIdentifier("a1b2c3")).toBe(true);
  });

  test("rejects malformed identifiers", () => {
    expect(validateProjectIdentifier("")).toBe(false);
    expect(validateProjectIdentifier("-leading-dash")).toBe(false);
    expect(validateProjectIdentifier("UPPER")).toBe(false);
    expect(validateProjectIdentifier("has spaces")).toBe(false);
    expect(validateProjectIdentifier("a".repeat(129))).toBe(false);
    expect(validateProjectIdentifier(null)).toBe(false);
    expect(validateProjectIdentifier(42)).toBe(false);
  });
});

describe("resolveProjectIdentity (path-derived mode)", () => {
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env.MINK_PROJECTS_IDENTITY;
    process.env.MINK_PROJECTS_IDENTITY = "path-derived";
  });
  afterEach(() => {
    if (prior === undefined) delete process.env.MINK_PROJECTS_IDENTITY;
    else process.env.MINK_PROJECTS_IDENTITY = prior;
  });

  test("returns the path-derived identifier and never consults the override", () => {
    const r = resolveProjectIdentity("/Users/drew/dev/my-project");
    expect(r.source).toBe("path-derived");
    expect(r.id).toBe(generateProjectId("/Users/drew/dev/my-project"));
  });
});

describe("resolveProjectIdentity (git-remote mode)", () => {
  let workdir: string;
  let prior: string | undefined;
  beforeEach(() => {
    prior = process.env.MINK_PROJECTS_IDENTITY;
    process.env.MINK_PROJECTS_IDENTITY = "git-remote";
    workdir = mkdtempSync(join(tmpdir(), "mink-resolver-test-"));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
    if (prior === undefined) delete process.env.MINK_PROJECTS_IDENTITY;
    else process.env.MINK_PROJECTS_IDENTITY = prior;
  });

  function initRepoWithRemote(dir: string, remoteUrl: string): void {
    execSync(`git init -q "${dir}"`);
    execSync(`git -C "${dir}" remote add origin "${remoteUrl}"`);
  }

  test("falls back to path-derived when cwd is not a git repo", () => {
    const r = resolveProjectIdentity(workdir);
    expect(r.source).toBe("path-derived");
  });

  test("falls back to path-derived when git repo has no remote", () => {
    execSync(`git init -q "${workdir}"`);
    const r = resolveProjectIdentity(workdir);
    expect(r.source).toBe("path-derived");
  });

  test("derives stable id from remote + empty subpath at repo root", () => {
    initRepoWithRemote(workdir, "git@github.com:owner/repo.git");
    const r = resolveProjectIdentity(workdir);
    expect(r.source).toBe("git-remote");
    expect(r.id).toMatch(/-[a-f0-9]{6}$/);
  });

  test("two URL forms of the same remote produce the same id", () => {
    const a = mkdtempSync(join(tmpdir(), "mink-a-"));
    const b = mkdtempSync(join(tmpdir(), "mink-b-"));
    try {
      initRepoWithRemote(a, "git@github.com:Owner/Repo.git");
      initRepoWithRemote(b, "https://github.com/owner/repo");
      const ra = resolveProjectIdentity(a);
      const rb = resolveProjectIdentity(b);
      expect(ra.id).toBe(rb.id);
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });

  test("monorepo subdirectories get distinct identifiers", () => {
    initRepoWithRemote(workdir, "git@github.com:org/monorepo.git");
    mkdirSync(join(workdir, "svc-a"), { recursive: true });
    mkdirSync(join(workdir, "svc-b"), { recursive: true });
    const rootId = resolveProjectIdentity(workdir).id;
    const aId = resolveProjectIdentity(join(workdir, "svc-a")).id;
    const bId = resolveProjectIdentity(join(workdir, "svc-b")).id;
    expect(aId).not.toBe(bId);
    expect(aId).not.toBe(rootId);
    expect(bId).not.toBe(rootId);
  });

  test("respects override file when present", () => {
    initRepoWithRemote(workdir, "git@github.com:owner/repo.git");
    mkdirSync(join(workdir, ".mink"), { recursive: true });
    writeFileSync(
      join(workdir, ".mink", "project.json"),
      JSON.stringify({ projectId: "pinned-id" })
    );
    const r = resolveProjectIdentity(workdir);
    expect(r.source).toBe("override");
    expect(r.id).toBe("pinned-id");
  });

  test("rejects malformed override and falls through to git-derived", () => {
    initRepoWithRemote(workdir, "git@github.com:owner/repo.git");
    mkdirSync(join(workdir, ".mink"), { recursive: true });
    writeFileSync(
      join(workdir, ".mink", "project.json"),
      JSON.stringify({ projectId: "Has Spaces" })
    );
    const r = resolveProjectIdentity(workdir);
    expect(r.source).toBe("git-remote");
  });

  test("rejects override that is not valid JSON and falls through", () => {
    initRepoWithRemote(workdir, "git@github.com:owner/repo.git");
    mkdirSync(join(workdir, ".mink"), { recursive: true });
    writeFileSync(join(workdir, ".mink", "project.json"), "{not json");
    const r = resolveProjectIdentity(workdir);
    expect(r.source).toBe("git-remote");
  });
});

describe("readProjectOverride", () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "mink-override-test-"));
  });
  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  test("returns null when override file is missing", () => {
    expect(readProjectOverride(workdir)).toBeNull();
  });

  test("returns the validated identifier", () => {
    mkdirSync(join(workdir, ".mink"), { recursive: true });
    writeFileSync(
      join(workdir, ".mink", "project.json"),
      JSON.stringify({ projectId: "good-id" })
    );
    expect(readProjectOverride(workdir)).toBe("good-id");
  });

  test("returns null when projectId is missing entirely", () => {
    mkdirSync(join(workdir, ".mink"), { recursive: true });
    writeFileSync(
      join(workdir, ".mink", "project.json"),
      JSON.stringify({ other: "field" })
    );
    expect(readProjectOverride(workdir)).toBeNull();
  });
});
