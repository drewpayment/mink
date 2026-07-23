// Regression guard for the test-pollution root cause fixed in
// docs/plans/2026-07-agent-retrieval-and-chat.md Phase 0: tests that call
// `init()` or `startDashboardServer()` write real state through
// src/core/paths.ts / src/core/vault.ts, and both silently fall back to the
// real user's `~/.mink` (and `~/.mink/wiki`) unless MINK_ROOT_OVERRIDE /
// MINK_WIKI_PATH are set for the duration of the test.
//
// Two things are checked here:
//   1. A repo-wide static scan — any test file that calls one of the known
//      risky entry points must also reference the isolation mechanism
//      somewhere in the same file. This is deliberately conservative (file-
//      level, not per-describe-block) so it can't be defeated by adding an
//      isolated describe block elsewhere in a file that still has an
//      unisolated one.
//   2. The isolation primitives themselves (assertMinkTestIsolation /
//      createMinkFixture) behave correctly — both the failure and success
//      paths — so a future refactor of tests/helpers/mink-fixture.ts can't
//      silently defang the guard.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import {
  assertMinkTestIsolation,
  createMinkFixture,
  REAL_MINK_ROOT_FOR_TESTS,
} from "../helpers/mink-fixture";

const TEST_ROOT_DIRS = [import.meta.dir, join(import.meta.dir, "..", "integration")];

// Entry points responsible for every pollution pattern seen in the real
// vault audit (mink-init-test-*, mink-refresh-cwd-*, mink-targets-cwd-*
// via init(); mink-dash-integ-* via startDashboardServer()/projectDir()).
const RISKY_CALL_PATTERNS: RegExp[] = [/\binit\s*\(/, /\bstartDashboardServer\s*\(/];

const ISOLATION_MARKERS = ["MINK_ROOT_OVERRIDE", "useMinkFixture", "createMinkFixture"];

function listTestFiles(dir: string): string[] {
  const files: string[] = [];
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTestFiles(full));
    } else if (entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("test isolation guard", () => {
  test("every test file calling init()/startDashboardServer() also isolates MINK_ROOT_OVERRIDE", () => {
    const offenders: string[] = [];

    for (const dir of TEST_ROOT_DIRS) {
      for (const file of listTestFiles(dir)) {
        if (file.includes(`${join("tests", "helpers")}`)) continue;
        if (statSync(file).isDirectory()) continue;
        const content = readFileSync(file, "utf-8");
        const looksRisky = RISKY_CALL_PATTERNS.some((re) => re.test(content));
        if (!looksRisky) continue;
        const isolated = ISOLATION_MARKERS.some((marker) => content.includes(marker));
        if (!isolated) offenders.push(file);
      }
    }

    if (offenders.length > 0) {
      throw new Error(
        "The following test files call init()/startDashboardServer() without isolating " +
          "MINK_ROOT_OVERRIDE — use createMinkFixture()/useMinkFixture() from " +
          "tests/helpers/mink-fixture.ts, or they will write into the real ~/.mink:\n" +
          offenders.map((f) => `  - ${f}`).join("\n")
      );
    }
    expect(offenders).toEqual([]);
  });

  test("assertMinkTestIsolation throws when the mink root resolves to the real vault", () => {
    const prevRoot = process.env.MINK_ROOT_OVERRIDE;
    const prevWiki = process.env.MINK_WIKI_PATH;
    delete process.env.MINK_ROOT_OVERRIDE;
    delete process.env.MINK_WIKI_PATH;
    try {
      expect(() => assertMinkTestIsolation()).toThrow();
    } finally {
      if (prevRoot === undefined) delete process.env.MINK_ROOT_OVERRIDE;
      else process.env.MINK_ROOT_OVERRIDE = prevRoot;
      if (prevWiki === undefined) delete process.env.MINK_WIKI_PATH;
      else process.env.MINK_WIKI_PATH = prevWiki;
    }
  });

  test("createMinkFixture resolves both root and wiki path away from the real vault", () => {
    const fx = createMinkFixture("mink-guard-check");
    try {
      expect(fx.minkRoot).not.toBe(REAL_MINK_ROOT_FOR_TESTS);
      expect(fx.minkRoot.startsWith(REAL_MINK_ROOT_FOR_TESTS)).toBe(false);
      expect(fx.wikiPath.startsWith(fx.minkRoot)).toBe(true);
      expect(() => assertMinkTestIsolation()).not.toThrow();
    } finally {
      fx.cleanup();
    }
  });
});
