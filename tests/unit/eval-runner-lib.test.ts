// Unit tests for evals/lib.ts — the side-effect-free logic behind the
// mink-agent retrieval eval runner (evals/runner.ts). These are pure/fs
// logic tests: no `claude` CLI, no tokens spent, no touching the real
// ~/.claude/agents — safe to run as part of the normal `bun test` suite,
// unlike the eval harness itself (see evals/README.md).
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  sha256,
  pathMatches,
  grade,
  applyBackupMarker,
  writeBackupMarkerAt,
  readBackupMarkerAt,
  type BackupMarker,
  type EvalCase,
} from "../../evals/lib";

describe("evals/lib pathMatches", () => {
  test("matches the exact path with .md suffix", () => {
    expect(pathMatches("see projects/atlas-web/overview.md for details", "projects/atlas-web/overview.md")).toBe(true);
  });

  test("matches the extensionless form in wikilink syntax", () => {
    expect(
      pathMatches(
        "That's covered in [[projects/atlas-web/overview|Atlas Web Overview]].",
        "projects/atlas-web/overview.md"
      )
    ).toBe(true);
  });

  test("matches the extensionless form in plain prose", () => {
    expect(
      pathMatches("You'll find that in projects/atlas-web/overview, under the intro.", "projects/atlas-web/overview.md")
    ).toBe(true);
  });

  test("does not match a bare, non-directory-qualified basename", () => {
    // "overview" alone should never satisfy a directory-qualified expected path —
    // that's exactly the ambiguity the eval's disambiguation case exists to catch.
    expect(pathMatches("see the overview note for details", "projects/atlas-web/overview.md")).toBe(false);
  });

  test("does not false-positive on a longer sibling path", () => {
    // "projects/atlas-web/overview" must not spuriously match inside
    // "projects/atlas-web/overview-old.md" or "...overview2.md".
    expect(pathMatches("see projects/atlas-web/overview-old.md", "projects/atlas-web/overview.md")).toBe(false);
    expect(pathMatches("see projects/atlas-web/overview2.md", "projects/atlas-web/overview.md")).toBe(false);
  });

  test("matches when the extensionless path is immediately followed by punctuation or end of string", () => {
    expect(pathMatches("It's in projects/atlas-web/overview.", "projects/atlas-web/overview.md")).toBe(true);
    expect(pathMatches("projects/atlas-web/overview", "projects/atlas-web/overview.md")).toBe(true);
  });

  test("non-.md expected paths only match exactly", () => {
    expect(pathMatches("see foo/bar.txt here", "foo/bar.txt")).toBe(true);
    expect(pathMatches("see foo/bar here", "foo/bar.txt")).toBe(false);
  });
});

describe("evals/lib grade", () => {
  function makeCase(overrides: Partial<EvalCase>): EvalCase {
    return {
      id: "test-case",
      category: "title-hit",
      question: "q",
      expected_paths: [],
      expected_substrings: [],
      ...overrides,
    };
  }

  test("non-negative case: echoing the expected substring without citing the path fails", () => {
    const kase = makeCase({
      category: "title-hit",
      expected_paths: ["projects/atlas-web/design-system.md"],
      expected_substrings: ["design system"],
    });
    const result = grade(kase, "Yes, there's a design system doc for Atlas Web covering tokens.");
    expect(result.pass).toBe(false);
  });

  test("non-negative case: citing the expected path passes", () => {
    const kase = makeCase({
      category: "title-hit",
      expected_paths: ["projects/atlas-web/design-system.md"],
      expected_substrings: ["design system"],
    });
    const result = grade(kase, "See projects/atlas-web/design-system.md for the design system doc.");
    expect(result.pass).toBe(true);
  });

  test("graph-hop disambiguation: citing the WRONG note in an ambiguous pair fails even with a substring hit", () => {
    const kase = makeCase({
      category: "graph-hop",
      expected_paths: ["projects/atlas-web/overview.md"],
      expected_substrings: ["Atlas Web"],
    });
    const wrong = grade(kase, "That's covered in projects/orion-api/overview.md, which mentions Atlas Web in passing.");
    expect(wrong.pass).toBe(false);
    const right = grade(kase, "That's projects/atlas-web/overview.md.");
    expect(right.pass).toBe(true);
  });

  test("negative case: an admission phrase passes", () => {
    const kase = makeCase({
      category: "negative",
      expected_paths: [],
      expected_substrings: ["not found", "no note"],
    });
    const result = grade(kase, "I couldn't find any note about that — no note on file.");
    expect(result.pass).toBe(true);
  });

  test("negative case: a fabricated-sounding answer fails", () => {
    const kase = makeCase({
      category: "negative",
      expected_paths: [],
      expected_substrings: ["not found", "no note"],
    });
    const result = grade(kase, "The Atlas Web mobile app is written in Swift.");
    expect(result.pass).toBe(false);
  });
});

describe("evals/lib applyBackupMarker (crash-safety guard)", () => {
  let dir: string;
  let installedPath: string;
  let backupPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-eval-lib-test-"));
    installedPath = join(dir, "mink-agent.md");
    backupPath = `${installedPath}.eval-backup`;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("restores the prior definition when the current file still matches our install hash", () => {
    writeFileSync(installedPath, "USERS_REAL_DEFINITION");
    const fixtureContent = "FIXTURE_RENDERED_V1";
    const marker: BackupMarker = {
      existed: true,
      content: "USERS_REAL_DEFINITION",
      installedHash: sha256(fixtureContent),
    };
    writeFileSync(installedPath, fixtureContent); // simulate the install step
    writeBackupMarkerAt(backupPath, marker);

    const outcome = applyBackupMarker(installedPath, backupPath, marker, { saveStaleAside: true });

    expect(outcome).toBe("restored");
    expect(readFileSync(installedPath, "utf-8")).toBe("USERS_REAL_DEFINITION");
    expect(existsSync(backupPath)).toBe(false);
  });

  test("removes the file when nothing existed before and the hash still matches", () => {
    const fixtureContent = "FIXTURE_RENDERED_V2";
    const marker: BackupMarker = { existed: false, content: null, installedHash: sha256(fixtureContent) };
    writeFileSync(installedPath, fixtureContent);
    writeBackupMarkerAt(backupPath, marker);

    const outcome = applyBackupMarker(installedPath, backupPath, marker, { saveStaleAside: true });

    expect(outcome).toBe("removed");
    expect(existsSync(installedPath)).toBe(false);
    expect(existsSync(backupPath)).toBe(false);
  });

  test("does NOT overwrite a fresh reinstall when the hash no longer matches (existed:true case)", () => {
    // Simulates: hard kill stranded the fixture definition, user noticed and
    // ran `mink agent` to reinstall a good one, THEN the eval runs again.
    const staleFixtureContent = "FIXTURE_RENDERED_STALE";
    const marker: BackupMarker = {
      existed: true,
      content: "OLD_REAL_DEFINITION",
      installedHash: sha256(staleFixtureContent),
    };
    writeBackupMarkerAt(backupPath, marker);
    // The user's fresh reinstall — NOT what the marker expects to find.
    writeFileSync(installedPath, "FRESH_GOOD_REINSTALL");

    const outcome = applyBackupMarker(installedPath, backupPath, marker, { saveStaleAside: true });

    expect(outcome).toBe("skipped-mismatch");
    // The fresh reinstall must be untouched — this is the bug being guarded against.
    expect(readFileSync(installedPath, "utf-8")).toBe("FRESH_GOOD_REINSTALL");
    expect(existsSync(backupPath)).toBe(false); // stale marker is cleared either way
    expect(existsSync(`${backupPath}.stale`)).toBe(true); // but saved aside for inspection
  });

  test("does NOT delete a fresh reinstall when the marker recorded existed:false", () => {
    // The most dangerous case: existed:false means restore() would normally
    // unlink the file outright. Must not do that to a fresh reinstall.
    const staleFixtureContent = "FIXTURE_RENDERED_STALE_2";
    const marker: BackupMarker = { existed: false, content: null, installedHash: sha256(staleFixtureContent) };
    writeBackupMarkerAt(backupPath, marker);
    writeFileSync(installedPath, "FRESH_GOOD_REINSTALL_2");

    const outcome = applyBackupMarker(installedPath, backupPath, marker, { saveStaleAside: true });

    expect(outcome).toBe("skipped-mismatch");
    expect(existsSync(installedPath)).toBe(true);
    expect(readFileSync(installedPath, "utf-8")).toBe("FRESH_GOOD_REINSTALL_2");
  });

  test("treats a deleted file as a mismatch too (never silently recreates it)", () => {
    const fixtureContent = "FIXTURE_RENDERED_V3";
    const marker: BackupMarker = {
      existed: true,
      content: "SOME_REAL_DEFINITION",
      installedHash: sha256(fixtureContent),
    };
    writeBackupMarkerAt(backupPath, marker);
    // installedPath does not exist at all.

    const outcome = applyBackupMarker(installedPath, backupPath, marker, { saveStaleAside: true });

    expect(outcome).toBe("skipped-mismatch");
    expect(existsSync(installedPath)).toBe(false);
  });

  test("is idempotent — a second call after a successful restore is a clean no-op via readBackupMarkerAt", () => {
    writeFileSync(installedPath, "USERS_REAL_DEFINITION_3");
    const fixtureContent = "FIXTURE_RENDERED_V4";
    const marker: BackupMarker = {
      existed: true,
      content: "USERS_REAL_DEFINITION_3",
      installedHash: sha256(fixtureContent),
    };
    writeFileSync(installedPath, fixtureContent);
    writeBackupMarkerAt(backupPath, marker);

    expect(applyBackupMarker(installedPath, backupPath, marker, { saveStaleAside: true })).toBe("restored");
    // Marker is gone now — the runner's real code checks readBackupMarkerAt()
    // before calling applyBackupMarker() again, which is what makes double
    // calls (finally block + a stray signal) safe in practice.
    expect(readBackupMarkerAt(backupPath)).toBeNull();
  });
});
