import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  AGENTS,
  detectAgents,
  resolveTargetsFromFlag,
} from "../../src/core/agent-detect";

describe("detectAgents", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-detect-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns an entry for every supported agent", () => {
    const info = detectAgents(dir);
    expect(info.map((a) => a.id).sort()).toEqual(["claude", "pi"]);
  });

  test("reports the project-config signal when .pi/ exists", () => {
    mkdirSync(join(dir, ".pi"), { recursive: true });
    const pi = detectAgents(dir).find((a) => a.id === "pi")!;
    expect(pi.detected).toBe(true);
    expect(pi.signals.some((s) => s.includes(".pi/"))).toBe(true);
  });

  test("reports the project-config signal when .claude/ exists", () => {
    mkdirSync(join(dir, ".claude"), { recursive: true });
    const claude = detectAgents(dir).find((a) => a.id === "claude")!;
    expect(claude.detected).toBe(true);
    expect(claude.signals.some((s) => s.includes(".claude/"))).toBe(true);
  });
});

describe("resolveTargetsFromFlag", () => {
  test("'all' expands to every agent", () => {
    expect(resolveTargetsFromFlag("all").sort()).toEqual(
      AGENTS.map((a) => a.id).sort()
    );
  });

  test("single id resolves to that agent", () => {
    expect(resolveTargetsFromFlag("pi")).toEqual(["pi"]);
    expect(resolveTargetsFromFlag("claude")).toEqual(["claude"]);
  });

  test("comma-separated list resolves each valid id", () => {
    expect(resolveTargetsFromFlag("claude,pi").sort()).toEqual(["claude", "pi"]);
  });

  test("is case-insensitive and trims whitespace", () => {
    expect(resolveTargetsFromFlag("  PI , Claude ").sort()).toEqual([
      "claude",
      "pi",
    ]);
  });

  test("drops unknown ids", () => {
    expect(resolveTargetsFromFlag("pi,bogus")).toEqual(["pi"]);
    expect(resolveTargetsFromFlag("nope")).toEqual([]);
  });
});
