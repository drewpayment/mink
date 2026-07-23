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

  // ── Adversarial-review regression tests ─────────────────────────────────
  // Each test below encodes a concrete repro from the Phase 0 review that
  // proved a real-data-corruption or false-positive path.

  describe("B1: daily rename never overwrites an existing destination", () => {
    test("a junk duplicate is reported as a conflict and left untouched — the real file is not destroyed", () => {
      const realContent = note({
        title: "2025-01-16",
        category: "areas",
        body: "Real, hand-written content that must survive.",
      });
      writeNote(vaultRoot, "areas/daily/2025-01-16.md", realContent);
      writeNote(
        vaultRoot,
        "areas/daily/01-16-2025.md",
        note({ title: "01-16-2025", category: "areas", body: "Junk duplicate." })
      );

      const report = auditVault();
      const issue = report.dailyIssues.find((d) => d.relativePath === "areas/daily/01-16-2025.md");
      expect(issue?.renameTo).toBe("2025-01-16");
      expect(issue?.conflict).toBe(true);

      const result = applyDoctorFixes(report, { dryRun: false });

      expect(result.dailiesRenamed).toEqual([]);
      expect(result.dailiesConflicted).toEqual([
        { from: "areas/daily/01-16-2025.md", wouldBe: "areas/daily/2025-01-16.md" },
      ]);

      // The real file is byte-for-byte untouched.
      expect(readFileSync(join(vaultRoot, "areas", "daily", "2025-01-16.md"), "utf-8")).toBe(
        realContent
      );
      // The junk duplicate is still there too — neither side was deleted.
      expect(existsSync(join(vaultRoot, "areas", "daily", "01-16-2025.md"))).toBe(true);
    });
  });

  describe("B2: alias values containing YAML flow-indicator characters are quoted", () => {
    test("a title containing a colon does not corrupt the frontmatter (proven repro: 'Chapter 1: Intro')", () => {
      writeNote(
        vaultRoot,
        "inbox/chapter-1-intro.md",
        note({ title: "Chapter 1: Intro", category: "inbox" })
      );

      const report = auditVault();
      applyDoctorFixes(report, { dryRun: false });

      const content = readFileSync(join(vaultRoot, "inbox", "chapter-1-intro.md"), "utf-8");
      expect(content).toContain('aliases: ["Chapter 1: Intro"]');
      // The unquoted form would parse as a nested YAML mapping, not a string.
      expect(content).not.toContain("aliases: [Chapter 1: Intro]");
    });
  });

  describe("B3: alias backfill never promotes a fallback title into an alias", () => {
    test("a note with no H1/frontmatter title (fallback: first body line) is not flagged or aliased", () => {
      // No H1, no frontmatter `title:` — extractNoteTitle falls back to the
      // first non-empty body line, which reads like a sentence, not a name.
      const raw = [
        "---",
        'created: "2026-01-01T00:00:00.000Z"',
        "tags: []",
        "category: inbox",
        "---",
        "",
        "This project needs work on some new features soon.",
        "",
      ].join("\n");
      writeNote(vaultRoot, "inbox/no-title.md", raw);

      const report = auditVault();
      expect(report.aliasCandidates.some((a) => a.relativePath === "inbox/no-title.md")).toBe(false);

      applyDoctorFixes(report, { dryRun: false });
      const content = readFileSync(join(vaultRoot, "inbox", "no-title.md"), "utf-8");
      expect(content).not.toContain("aliases:");
    });

    test("multiple untitled notes don't all get a shared 'Untitled' alias", () => {
      const raw = ['---', 'created: "2026-01-01T00:00:00.000Z"', "tags: []", "---", "", ""].join(
        "\n"
      );
      writeNote(vaultRoot, "inbox/blank-a.md", raw);
      writeNote(vaultRoot, "inbox/blank-b.md", raw);

      const report = auditVault();
      expect(report.aliasCandidates.length).toBe(0);

      const result = applyDoctorFixes(report, { dryRun: false });
      expect(result.aliasesAdded).toEqual([]);
    });

    test("a real H1 that doesn't correspond to the filename (slugify mismatch) is not aliased", () => {
      // Title and filename are two deliberately different, unrelated names
      // — not the kebab-slug-vs-Title-Case pattern this backfill targets.
      writeNote(
        vaultRoot,
        "projects/foo/notes.md",
        note({ title: "Completely Unrelated Name", category: "projects" })
      );

      const report = auditVault();
      expect(report.aliasCandidates.some((a) => a.relativePath === "projects/foo/notes.md")).toBe(
        false
      );

      applyDoctorFixes(report, { dryRun: false });
      const content = readFileSync(join(vaultRoot, "projects", "foo", "notes.md"), "utf-8");
      expect(content).not.toContain("aliases:");
    });

    test("still backfills the target pattern: real H1 that slugifies back to the stem", () => {
      writeNote(
        vaultRoot,
        "resources/global-catalog.md",
        note({ title: "Global Catalog", category: "resources" })
      );
      const report = auditVault();
      expect(report.aliasCandidates.some((a) => a.relativePath === "resources/global-catalog.md")).toBe(
        true
      );
      applyDoctorFixes(report, { dryRun: false });
      const content = readFileSync(join(vaultRoot, "resources", "global-catalog.md"), "utf-8");
      expect(content).toContain("aliases: [Global Catalog]");
    });
  });

  describe("S1: pollution note patterns are scoped to inbox/ and anchored to a generated suffix", () => {
    test("legitimate titles sharing a pollution prefix are never flagged", () => {
      writeNote(
        vaultRoot,
        "resources/sync-architecture.md",
        note({ title: "Sync Architecture", category: "resources" })
      );
      writeNote(
        vaultRoot,
        "inbox/hello-world-in-rust.md",
        note({ title: "Hello World In Rust", category: "inbox" })
      );

      const report = auditVault();
      expect(report.testPollution.wiki).toEqual([]);
    });

    test("a generated-suffix match outside inbox/ is not flagged (scoping)", () => {
      writeNote(
        vaultRoot,
        "projects/foo/sync-a1b2.md",
        note({ title: "sync-a1b2", category: "projects" })
      );

      const report = auditVault();
      expect(report.testPollution.wiki).toEqual([]);
    });

    test("a real generated-suffix pollution note inside inbox/ is still caught", () => {
      writeNote(
        vaultRoot,
        "inbox/hello-world-a1b2.md",
        note({ title: "hello-world-a1b2", category: "inbox" })
      );
      writeNote(
        vaultRoot,
        "inbox/sync-1784821784685.md",
        note({ title: "sync-1784821784685", category: "inbox" })
      );

      const report = auditVault();
      const flagged = report.testPollution.wiki.map((p) => p.relativePath).sort();
      expect(flagged).toEqual(["inbox/hello-world-a1b2.md", "inbox/sync-1784821784685.md"]);
    });
  });

  describe("S3: MM-DD-YYYY vs DD-MM-YYYY ambiguity is never guessed", () => {
    test("parseDailyStem returns null when both components could be a month (proven repro: '03-04-2025')", () => {
      expect(parseDailyStem("03-04-2025")).toBeNull();
    });

    test("an ambiguous daily filename is reported only, never renamed", () => {
      writeNote(
        vaultRoot,
        "areas/daily/03-04-2025.md",
        note({ title: "03-04-2025", category: "areas" })
      );

      const report = auditVault();
      const issue = report.dailyIssues.find((d) => d.relativePath === "areas/daily/03-04-2025.md");
      expect(issue?.renameTo).toBeNull();

      const result = applyDoctorFixes(report, { dryRun: false });
      expect(result.dailiesRenamed).toEqual([]);
      expect(result.dailiesUnparsed).toEqual(["areas/daily/03-04-2025.md"]);
      expect(existsSync(join(vaultRoot, "areas", "daily", "03-04-2025.md"))).toBe(true);
    });

    test("the unambiguous case (day > 12) still renames", () => {
      expect(parseDailyStem("01-16-2025")).toBe("2025-01-16");
    });
  });

  describe("S4: rebuilt index excludes the doctor's own quarantine subtree", () => {
    test("quarantined notes don't reappear in the vault index after a fix run", async () => {
      writeNote(
        vaultRoot,
        "inbox/hello-world-a1b2.md",
        note({ title: "hello-world-a1b2", category: "inbox" })
      );
      const { loadVaultIndex } = await import("../../src/core/note-index");

      const report = auditVault();
      applyDoctorFixes(report, { dryRun: false });

      const index = loadVaultIndex();
      const indexed = Object.keys(index.entries);
      expect(indexed.some((p) => p.includes("hello-world-a1b2"))).toBe(false);
      expect(indexed.some((p) => p.startsWith("archives/_doctor/"))).toBe(false);
    });
  });

  describe("S5: wikilink subpaths (#heading / ^block) survive resolution and rewriting", () => {
    test("ambiguous-link qualification preserves a #Heading subpath", () => {
      writeNote(
        vaultRoot,
        "projects/alpha/overview.md",
        note({ title: "Alpha", category: "projects" })
      );
      writeNote(vaultRoot, "projects/beta/overview.md", note({ title: "Beta", category: "projects" }));
      writeNote(
        vaultRoot,
        "projects/alpha/notes.md",
        note({
          title: "Alpha Notes",
          category: "projects",
          body: "See [[overview#Key Decisions]] for context.",
        })
      );

      const report = auditVault();
      const result = applyDoctorFixes(report, { dryRun: false });

      expect(result.linksQualified.length).toBe(1);
      const content = readFileSync(join(vaultRoot, "projects", "alpha", "notes.md"), "utf-8");
      expect(content).toContain("[[projects/alpha/overview#Key Decisions|overview#Key Decisions]]");
    });

    test("daily-note rename preserves a #Heading subpath on inbound links", () => {
      writeNote(
        vaultRoot,
        "areas/daily/01-16-2025.md",
        note({ title: "01-16-2025", category: "areas" })
      );
      writeNote(
        vaultRoot,
        "areas/daily/2025-01-17.md",
        note({
          title: "2025-01-17",
          category: "areas",
          body: "Yesterday: [[01-16-2025#morning]].",
        })
      );

      const report = auditVault();
      applyDoctorFixes(report, { dryRun: false });

      const content = readFileSync(join(vaultRoot, "areas", "daily", "2025-01-17.md"), "utf-8");
      expect(content).toContain("[[2025-01-16#morning]]");
    });

    test("a #Heading link to an aliased note resolves (not broken) once the alias exists", () => {
      writeNote(
        vaultRoot,
        "resources/global-catalog.md",
        note({ title: "Global Catalog", category: "resources" })
      );
      writeNote(
        vaultRoot,
        "inbox/regular-note.md",
        note({
          title: "Regular Note",
          category: "inbox",
          body: "See [[Global Catalog#Intro]] for details.",
        })
      );

      const report = auditVault();
      expect(report.brokenLinks.some((l) => l.target === "Global Catalog#Intro")).toBe(true);

      const result = applyDoctorFixes(report, { dryRun: false });
      expect(result.linkHealthAfter.broken).toBe(0);
    });
  });
});
