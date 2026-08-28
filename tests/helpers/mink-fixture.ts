// Shared test isolation fixture.
//
// Root cause of the "test pollution" issue tracked in
// docs/plans/2026-07-agent-retrieval-and-chat.md (Phase 0): tests that call
// into `init`, `startDashboardServer`, or anything that touches the wiki
// vault need BOTH env vars overridden, not just one —
//   - MINK_ROOT_OVERRIDE routes project state (paths.ts / minkRoot()).
//   - MINK_WIKI_PATH routes the notes vault (vault.ts / resolveVaultPath()).
// `wiki.path`'s default is a hardcoded "~/.mink/wiki" string that does NOT
// derive from MINK_ROOT_OVERRIDE, so a test that only sets the former still
// writes real notes into the developer's actual vault the moment it touches
// anything wiki-related (e.g. `init()`'s project-overview seeding). That's
// exactly how `mink-init-test-*`, `mink-refresh-cwd-*`, and
// `mink-targets-cwd-*` ended up as real notes under ~/.mink/wiki/projects/.
//
// Use `useMinkFixture()` in any test file whose code path might touch mink
// state or the wiki — it isolates both, on every test, automatically.

import { afterEach, beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

const REAL_MINK_ROOT = join(homedir(), ".mink");
const REAL_WIKI_PATH = join(REAL_MINK_ROOT, "wiki");

export interface MinkFixture {
  /** A fresh temp directory standing in for a project's cwd. */
  cwd: string;
  /** A fresh temp directory standing in for `~/.mink`. */
  minkRoot: string;
  /** A fresh temp directory standing in for `~/.mink/wiki`. */
  wikiPath: string;
}

interface SavedEnv {
  MINK_ROOT_OVERRIDE: string | undefined;
  MINK_WIKI_PATH: string | undefined;
}

/**
 * Creates isolated temp directories and points MINK_ROOT_OVERRIDE /
 * MINK_WIKI_PATH at them. Throws if, after setting the overrides, the
 * resolved mink root or wiki path still lands on the real user vault —
 * a fast, loud failure instead of silent pollution.
 *
 * Caller owns cleanup: call the returned `cleanup()` (or use
 * `useMinkFixture()` below for automatic beforeEach/afterEach wiring).
 */
export function createMinkFixture(prefix = "mink-test"): MinkFixture & { cleanup(): void } {
  const minkRoot = mkdtempSync(join(tmpdir(), `${prefix}-root-`));
  const wikiPath = join(minkRoot, "wiki");
  const cwd = mkdtempSync(join(tmpdir(), `${prefix}-cwd-`));

  const saved: SavedEnv = {
    MINK_ROOT_OVERRIDE: process.env.MINK_ROOT_OVERRIDE,
    MINK_WIKI_PATH: process.env.MINK_WIKI_PATH,
  };

  process.env.MINK_ROOT_OVERRIDE = minkRoot;
  process.env.MINK_WIKI_PATH = wikiPath;

  assertMinkTestIsolation();

  return {
    cwd,
    minkRoot,
    wikiPath,
    cleanup() {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(minkRoot, { recursive: true, force: true });
      restoreEnv("MINK_ROOT_OVERRIDE", saved.MINK_ROOT_OVERRIDE);
      restoreEnv("MINK_WIKI_PATH", saved.MINK_WIKI_PATH);
    },
  };
}

function restoreEnv(key: "MINK_ROOT_OVERRIDE" | "MINK_WIKI_PATH", value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

/**
 * Registers beforeEach/afterEach hooks that create a fresh MinkFixture for
 * every test in the current describe block and tear it down after. Returns
 * a getter object; read `.current` inside each `test()` body (the fixture
 * doesn't exist yet when this function itself runs).
 *
 * Usage:
 *   const fx = useMinkFixture("mink-refresh");
 *   test("...", async () => {
 *     await init(fx.current.cwd, { targets: ["claude"] });
 *   });
 */
export function useMinkFixture(prefix = "mink-test"): { current: MinkFixture } {
  const holder = { current: undefined as unknown as MinkFixture };
  let cleanupFn: (() => void) | null = null;

  beforeEach(() => {
    const fx = createMinkFixture(prefix);
    cleanupFn = fx.cleanup;
    holder.current = fx;
  });

  afterEach(() => {
    cleanupFn?.();
    cleanupFn = null;
  });

  return holder;
}

/**
 * Throws if the mink root or wiki path currently resolved by the
 * application's own path helpers point at the real user vault. Call this
 * after setting MINK_ROOT_OVERRIDE/MINK_WIKI_PATH (createMinkFixture does
 * this automatically) to catch isolation bugs immediately rather than after
 * a test has already written into ~/.mink.
 */
export function assertMinkTestIsolation(): void {
  // Lazy require: keeps this helper import-order-agnostic with respect to
  // src/core/paths.ts's own module-level MINK_ROOT_OVERRIDE snapshot.
  const { minkRoot } = require("../../src/core/paths") as typeof import("../../src/core/paths");
  const { resolveVaultPath } = require("../../src/core/vault") as typeof import("../../src/core/vault");

  const resolvedRoot = minkRoot();
  if (resolvedRoot === REAL_MINK_ROOT || resolvedRoot.startsWith(REAL_MINK_ROOT + "/")) {
    throw new Error(
      `[mink test isolation] resolved mink root "${resolvedRoot}" points at the real user vault ` +
        `(${REAL_MINK_ROOT}). Set MINK_ROOT_OVERRIDE to a temp directory before running this code — ` +
        `use createMinkFixture()/useMinkFixture() from tests/helpers/mink-fixture.ts.`
    );
  }

  let resolvedWiki: string;
  try {
    resolvedWiki = resolveVaultPath();
  } catch {
    return;
  }
  if (resolvedWiki === REAL_WIKI_PATH || resolvedWiki.startsWith(REAL_WIKI_PATH + "/")) {
    throw new Error(
      `[mink test isolation] resolved wiki path "${resolvedWiki}" points at the real user vault ` +
        `(${REAL_WIKI_PATH}). Set MINK_WIKI_PATH to a temp directory before running this code — ` +
        `use createMinkFixture()/useMinkFixture() from tests/helpers/mink-fixture.ts.`
    );
  }
}

export const REAL_MINK_ROOT_FOR_TESTS = REAL_MINK_ROOT;
export const REAL_WIKI_PATH_FOR_TESTS = REAL_WIKI_PATH;
