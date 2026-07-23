import { describe, test, expect, beforeEach } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { useMinkFixture } from "../helpers/mink-fixture";
import { ensureVaultStructure } from "../../src/core/vault";
import {
  auditVault,
  applyDoctorFixes,
  parseDailyStem,
  type DoctorReport,
} from "../../src/core/wiki-doctor";

// existsSync follows symlinks; this checks whether a filesystem entry (file,
// dir, or symlink — broken or not) is present at `path` without following.
function linkEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function writeNote(vaultRoot: string, relativePath: string, content: string): string {
  const full = join(vaultRoot, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
}

function note(opts: {
  title: string;
  aliases?: string[];
  category?: string;
  body?: string;
}): string {
  const now = "2026-01-01T00:00:00.000Z";
  const lines = ["---", `created: "${now}"`, `updated: "${now}"`, "tags: []"];
  if (opts.category) lines.push(`category: ${opts.category}`);
  if (opts.aliases && opts.aliases.length > 0) {
    lines.push(`aliases: [${opts.aliases.join(", ")}]`);
  }
  lines.push("---", "", `# ${opts.title}`, "", opts.body ?? "");
  return lines.join("\n");
}

describe("wiki-doctor", () => {
  const fx = useMinkFixture("mink-doctor");
  let vaultRoot: string;

  beforeEach(() => {
    vaultRoot = fx.current.wikiPath;
    ensureVaultStructure();
  });

  function buildFixtureVault(): void {
    // A note with a title that literally differs from its filename slug —
    // the dominant real-world broken-link pattern (kebab file, Title Case
    // link). No aliases yet, so [[Global Catalog]] below is broken.
    writeNote(
      vaultRoot,
      "resources/global-catalog.md",
      note({ title: "Global Catalog", category: "resources" })
    );

    // Links to it by display title — broken until aliases are backfilled.
    writeNote(
      vaultRoot,
      "inbox/regular-note.md",
      note({
        title: "Regular Note",
        category: "inbox",
        body: "See [[Global Catalog]] for details.",
      })
    );

    // Ambiguous basename: two overview.md notes in different project dirs.
    writeNote(
      vaultRoot,
      "projects/alpha/overview.md",
      note({ title: "Alpha", category: "projects", body: "# Alpha overview" })
    );
    writeNote(
      vaultRoot,
      "projects/beta/overview.md",
      note({ title: "Beta", category: "projects", body: "# Beta overview" })
    );
    // A note inside alpha's own project dir links bare [[overview]] — should
    // resolve to alpha/overview.md (same project dir) once qualified.
    writeNote(
      vaultRoot,
      "projects/alpha/notes.md",
      note({
        title: "Alpha Notes",
        category: "projects",
        body: "Back to [[overview]].",
      })
    );

    // Test pollution: a wiki project dir matching a pinned pattern. Named
    // "scratch.md" (not "overview.md") so it doesn't also collide with the
    // ambiguous-basename scenario above — pollution is quarantined as a
    // whole directory regardless of what's inside it.
    writeNote(
      vaultRoot,
      "projects/mink-init-test-abc123/scratch.md",
      note({ title: "mink-init-test-abc123", category: "projects" })
    );
    // Test pollution: an inbox note matching a pinned pattern.
    writeNote(vaultRoot, "inbox/hello-world-42.md", note({ title: "Hello World", category: "inbox" }));

    // Non-ISO daily note.
    writeNote(
      vaultRoot,
      "areas/daily/01-16-2025.md",
      note({ title: "01-16-2025", category: "areas", body: "Daily notes here." })
    );
    // A daily note that links to the non-ISO one by bare stem.
    writeNote(
      vaultRoot,
      "areas/daily/2025-01-17.md",
      note({ title: "2025-01-17", category: "areas", body: "Yesterday: [[01-16-2025]]." })
    );

    // Broken top-level symlink.
    symlinkSync(join(vaultRoot, "does-not-exist"), join(vaultRoot, "broken-link"));

    // Mink-root pollution: a project state dir matching the pinned pattern.
    const pollutedProjectDir = join(fx.current.minkRoot, "projects", "mink-dash-integ-xyz123");
    mkdirSync(pollutedProjectDir, { recursive: true });
    writeFileSync(join(pollutedProjectDir, "project-meta.json"), JSON.stringify({ name: "fake" }));
  }

  test("audit reports correct counts against the fixture vault", () => {
    buildFixtureVault();
    const report = auditVault();

    expect(report.totalNotes).toBe(9); // excludes templates/, includes all fixture notes
    expect(report.testPollution.wiki.length).toBe(2); // 1 dir + 1 note
    expect(report.testPollution.minkRoot.length).toBe(1);
    expect(report.dailyIssues.length).toBe(1);
    expect(report.dailyIssues[0].renameTo).toBe("2025-01-16");
    expect(report.brokenSymlinks).toEqual(["broken-link"]);
    expect(Object.keys(report.ambiguousBasenames)).toContain("overview.md");
    expect(report.ambiguousBasenames["overview.md"].length).toBe(2);

    // [[Global Catalog]] is broken (no alias yet); [[overview]] is ambiguous.
    expect(report.brokenLinks.some((l) => l.target === "Global Catalog")).toBe(true);
    expect(report.ambiguousLinks.some((l) => l.target === "overview")).toBe(true);

    // global-catalog.md needs an alias (title differs from stem literally).
    expect(report.aliasCandidates.some((a) => a.relativePath === "resources/global-catalog.md")).toBe(
      true
    );
  });

  test("--dry-run touches nothing on disk", () => {
    buildFixtureVault();
    const report = auditVault();

    const pollutedPath = join(vaultRoot, "projects", "mink-init-test-abc123", "scratch.md");
    const helloWorldPath = join(vaultRoot, "inbox", "hello-world-42.md");
    const catalogContentBefore = readFileSync(join(vaultRoot, "resources", "global-catalog.md"), "utf-8");
    const dailyPathBefore = join(vaultRoot, "areas", "daily", "01-16-2025.md");

    const result = applyDoctorFixes(report, { dryRun: true });

    expect(result.dryRun).toBe(true);
    // Nothing physically moved or rewritten.
    expect(existsSync(pollutedPath)).toBe(true);
    expect(existsSync(helloWorldPath)).toBe(true);
    expect(existsSync(dailyPathBefore)).toBe(true);
    expect(readFileSync(join(vaultRoot, "resources", "global-catalog.md"), "utf-8")).toBe(
      catalogContentBefore
    );

    // But the dry run still *simulates* what would happen, so the plan is
    // non-empty and the "after" stats reflect the repair.
    expect(result.quarantinedWikiItems.length).toBe(2);
    expect(result.aliasesAdded.length).toBeGreaterThan(0);
    expect(result.dailiesRenamed.length).toBe(1);
    expect(result.linkHealthAfter.broken).toBeLessThan(result.linkHealthBefore.broken);
  });

  test("--fix quarantines pollution instead of deleting it", () => {
    buildFixtureVault();
    const report = auditVault();
    const result = applyDoctorFixes(report, { dryRun: false });

    const oldDirPath = join(vaultRoot, "projects", "mink-init-test-abc123");
    const oldNotePath = join(vaultRoot, "inbox", "hello-world-42.md");
    expect(existsSync(oldDirPath)).toBe(false);
    expect(existsSync(oldNotePath)).toBe(false);

    const date = new Date().toISOString().slice(0, 10);
    const quarantinedDir = join(vaultRoot, "archives", "_doctor", date, "projects", "mink-init-test-abc123", "scratch.md");
    const quarantinedNote = join(vaultRoot, "archives", "_doctor", date, "inbox", "hello-world-42.md");
    expect(existsSync(quarantinedDir)).toBe(true);
    expect(existsSync(quarantinedNote)).toBe(true);

    const oldMinkRootDir = join(fx.current.minkRoot, "projects", "mink-dash-integ-xyz123");
    expect(existsSync(oldMinkRootDir)).toBe(false);
    const quarantinedMinkRootDir = join(fx.current.minkRoot, ".doctor-quarantine", date, "mink-dash-integ-xyz123");
    expect(existsSync(quarantinedMinkRootDir)).toBe(true);
    expect(existsSync(join(quarantinedMinkRootDir, "project-meta.json"))).toBe(true);
  });

  test("--fix repairs links: alias backfill resolves the broken link, ambiguous link gets qualified, daily gets renamed", () => {
    buildFixtureVault();
    const report = auditVault();
    const beforeBroken = report.linkHealth.broken;
    const result = applyDoctorFixes(report, { dryRun: false });

    // Alias backfilled on global-catalog.md.
    const catalogContent = readFileSync(join(vaultRoot, "resources", "global-catalog.md"), "utf-8");
    expect(catalogContent).toContain("aliases: [Global Catalog]");

    // Ambiguous [[overview]] in alpha/notes.md qualified to alpha's own overview.
    const notesContent = readFileSync(join(vaultRoot, "projects", "alpha", "notes.md"), "utf-8");
    expect(notesContent).toContain("[[projects/alpha/overview|overview]]");

    // Daily note renamed to ISO form, and the inbound link updated.
    expect(existsSync(join(vaultRoot, "areas", "daily", "2025-01-16.md"))).toBe(true);
    expect(existsSync(join(vaultRoot, "areas", "daily", "01-16-2025.md"))).toBe(false);
    const tomorrowContent = readFileSync(join(vaultRoot, "areas", "daily", "2025-01-17.md"), "utf-8");
    expect(tomorrowContent).toContain("[[2025-01-16]]");

    // Link health measurably improved.
    expect(result.linkHealthAfter.broken).toBeLessThan(beforeBroken);
    expect(result.linkHealthAfter.ambiguous).toBeLessThan(result.linkHealthBefore.ambiguous);
  });

  test("running --fix twice is idempotent (second run is a no-op)", () => {
    buildFixtureVault();
    const firstReport = auditVault();
    applyDoctorFixes(firstReport, { dryRun: false });

    const secondReport = auditVault();
    const secondResult = applyDoctorFixes(secondReport, { dryRun: false });

    expect(secondReport.testPollution.wiki.length).toBe(0);
    expect(secondReport.testPollution.minkRoot.length).toBe(0);
    expect(secondReport.dailyIssues.length).toBe(0);
    expect(secondReport.brokenSymlinks.length).toBe(0);

    expect(secondResult.quarantinedWikiItems.length).toBe(0);
    expect(secondResult.quarantinedMinkRootDirs.length).toBe(0);
    expect(secondResult.aliasesAdded.length).toBe(0);
    expect(secondResult.linksQualified.length).toBe(0);
    expect(secondResult.dailiesRenamed.length).toBe(0);
    expect(secondResult.linkHealthBefore).toEqual(secondResult.linkHealthAfter);
  });

  test("unresolvable ambiguous links are reported, not guessed", () => {
    // Two candidates, neither in the linking note's own project dir.
    writeNote(vaultRoot, "resources/duplicate.md", note({ title: "Duplicate A", category: "resources" }));
    writeNote(vaultRoot, "areas/duplicate.md", note({ title: "Duplicate B", category: "areas" }));
    writeNote(
      vaultRoot,
      "inbox/asker.md",
      note({ title: "Asker", category: "inbox", body: "Which one? [[duplicate]]" })
    );

    const report = auditVault();
    const result = applyDoctorFixes(report, { dryRun: false });

    expect(result.unresolvableAmbiguousLinks.length).toBe(1);
    expect(result.unresolvableAmbiguousLinks[0].target).toBe("duplicate");
    // Left untouched — no guessing.
    const content = readFileSync(join(vaultRoot, "inbox", "asker.md"), "utf-8");
    expect(content).toContain("[[duplicate]]");
  });

  test("non-parseable daily filenames are reported only, never renamed", () => {
    writeNote(
      vaultRoot,
      "areas/daily/some-random-thoughts.md",
      note({ title: "some-random-thoughts", category: "areas" })
    );

    const report = auditVault();
    expect(report.dailyIssues.length).toBe(1);
    expect(report.dailyIssues[0].renameTo).toBeNull();

    const result = applyDoctorFixes(report, { dryRun: false });
    expect(result.dailiesRenamed.length).toBe(0);
    expect(result.dailiesUnparsed).toEqual(["areas/daily/some-random-thoughts.md"]);
    expect(existsSync(join(vaultRoot, "areas", "daily", "some-random-thoughts.md"))).toBe(true);
  });

  test("broken symlink is quarantined, not deleted, on --fix", () => {
    symlinkSync(join(vaultRoot, "nowhere"), join(vaultRoot, "dangling"));
    const report = auditVault();
    expect(report.brokenSymlinks).toEqual(["dangling"]);

    const result = applyDoctorFixes(report, { dryRun: false });
    expect(result.brokenSymlinksQuarantined).toEqual(["dangling"]);
    // existsSync follows symlinks, so it's always false for a *broken* link
    // regardless of whether the link entry itself is still there — use
    // lstatSync (which doesn't follow) to check presence/absence for real.
    expect(linkEntryExists(join(vaultRoot, "dangling"))).toBe(false);

    const date = new Date().toISOString().slice(0, 10);
    const quarantined = join(vaultRoot, "archives", "_doctor", date, "dangling");
    expect(linkEntryExists(quarantined)).toBe(true); // symlink preserved, still broken, just moved
  });

  test("parseDailyStem handles ISO passthrough, MM-DD-YYYY, and rejects garbage", () => {
    expect(parseDailyStem("2025-01-16")).toBe("2025-01-16");
    expect(parseDailyStem("01-16-2025")).toBe("2025-01-16");
    expect(parseDailyStem("01_16_2025")).toBe("2025-01-16");
    expect(parseDailyStem("some-random-thoughts")).toBeNull();
    expect(parseDailyStem("99-99-9999")).toBeNull();
  });

  test("templates/ directory is excluded from the audit entirely", () => {
    const { seedTemplates } = require("../../src/core/vault-templates") as typeof import("../../src/core/vault-templates");
    seedTemplates(join(vaultRoot, "templates"));
    writeNote(vaultRoot, "inbox/real-note.md", note({ title: "Real Note", category: "inbox" }));

    const report = auditVault();
    // Only the real note counts — the {{title}}-placeholder templates don't.
    expect(report.totalNotes).toBe(1);
    expect(report.aliasCandidates.length).toBe(1);
    expect(report.aliasCandidates[0].relativePath).toBe("inbox/real-note.md");
  });
});
