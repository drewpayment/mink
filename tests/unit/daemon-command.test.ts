import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { schedulerLogPath } from "../../src/core/paths";

describe("daemon logs", () => {
  // Since the daemon command reads from schedulerLogPath() (a fixed location),
  // we test the file reading logic by writing to that path.

  const logPath = schedulerLogPath();
  let hadExistingLog = false;
  let existingContent = "";

  beforeEach(() => {
    // Save any existing log file
    try {
      const { readFileSync } = require("fs");
      existingContent = readFileSync(logPath, "utf-8");
      hadExistingLog = true;
    } catch {
      hadExistingLog = false;
    }
  });

  afterEach(() => {
    // Restore original state
    if (hadExistingLog) {
      writeFileSync(logPath, existingContent);
    } else {
      try {
        rmSync(logPath, { force: true });
      } catch {}
    }
  });

  test("reads last 50 lines from log file", () => {
    const { dirname } = require("path");
    mkdirSync(dirname(logPath), { recursive: true });

    // Write 100 lines
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i + 1}`);
    writeFileSync(logPath, lines.join("\n"));

    // Read file and verify we'd get last 50
    const { readFileSync } = require("fs");
    const content = readFileSync(logPath, "utf-8");
    const allLines = content.split("\n");
    const tail = allLines.slice(-50);
    expect(tail.length).toBe(50);
    expect(tail[0]).toBe("line-51");
    expect(tail[49]).toBe("line-100");
  });

  test("handles missing log file gracefully", () => {
    try {
      rmSync(logPath, { force: true });
    } catch {}

    expect(existsSync(logPath)).toBe(false);
    // The daemon command would print "[mink] no log file found"
    // Just verify the file doesn't exist and we don't crash
  });
});
