import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { detectDevCommand } from "../../../src/core/design-eval/server-detect";

describe("detectDevCommand", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mink-server-detect-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns 'npm run dev' when dev script exists", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { dev: "next dev", build: "next build" } })
    );
    expect(detectDevCommand(tmpDir)).toBe("npm run dev");
  });

  test("falls back to start when no dev script", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { start: "node server.js", build: "tsc" } })
    );
    expect(detectDevCommand(tmpDir)).toBe("npm run start");
  });

  test("falls back to serve when no dev or start", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { serve: "vite preview", build: "tsc" } })
    );
    expect(detectDevCommand(tmpDir)).toBe("npm run serve");
  });

  test("returns null when no scripts at all", () => {
    writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test" }));
    expect(detectDevCommand(tmpDir)).toBeNull();
  });

  test("returns null when no package.json", () => {
    expect(detectDevCommand(tmpDir)).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    writeFileSync(join(tmpDir, "package.json"), "not json{{{");
    expect(detectDevCommand(tmpDir)).toBeNull();
  });

  test("prefers dev over start", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        scripts: { start: "node server.js", dev: "next dev" },
      })
    );
    expect(detectDevCommand(tmpDir)).toBe("npm run dev");
  });
});
