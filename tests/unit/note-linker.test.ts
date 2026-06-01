import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  extractWikilinks,
  insertWikilinks,
  addBacklink,
  updateMasterIndex,
} from "../../src/core/note-linker";

describe("note-linker", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mink-test-"));
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("extractWikilinks", () => {
    test("extracts simple wikilinks", () => {
      const content = "See [[My Note]] and [[Another Note]]";
      const links = extractWikilinks(content);
      expect(links).toEqual(["My Note", "Another Note"]);
    });

    test("extracts wikilinks with display text (pipe syntax)", () => {
      const content = "Check [[My Note|display text]] here";
      const links = extractWikilinks(content);
      expect(links).toEqual(["My Note"]);
    });

    test("returns empty array for content without wikilinks", () => {
      const content = "No links here, just plain text.";
      expect(extractWikilinks(content)).toEqual([]);
    });

    test("deduplicates wikilinks", () => {
      const content = "See [[Note A]] and also [[Note A]] again";
      const links = extractWikilinks(content);
      expect(links).toEqual(["Note A"]);
    });

    test("handles empty string", () => {
      expect(extractWikilinks("")).toEqual([]);
    });

    test("trims whitespace from link targets", () => {
      const content = "[[ My Note ]]";
      const links = extractWikilinks(content);
      expect(links).toEqual(["My Note"]);
    });

    test("handles multiple links on same line", () => {
      const content = "[[A]] [[B]] [[C]]";
      expect(extractWikilinks(content)).toEqual(["A", "B", "C"]);
    });

    test("handles links across multiple lines", () => {
      const content = "Line 1 [[A]]\nLine 2 [[B]]\nLine 3 [[C]]";
      expect(extractWikilinks(content)).toEqual(["A", "B", "C"]);
    });
  });

  describe("insertWikilinks", () => {
    test("inserts wikilink around first occurrence of target text", () => {
      const content = "We use TypeScript for this project.";
      const result = insertWikilinks(content, ["TypeScript"]);
      expect(result).toContain("[[TypeScript]]");
    });

    test("does not insert duplicate wikilinks", () => {
      const content = "Already linked [[TypeScript]] here.";
      const result = insertWikilinks(content, ["TypeScript"]);
      // Should not have double brackets
      expect(result).not.toContain("[[[[TypeScript]]]]");
      expect(result).toContain("[[TypeScript]]");
    });

    test("does not modify frontmatter", () => {
      const content = `---
created: "2024-01-01"
tags: [TypeScript]
---

TypeScript is great.`;
      const result = insertWikilinks(content, ["TypeScript"]);
      // Frontmatter should remain unchanged
      expect(result).toContain("tags: [TypeScript]");
      // Body should get the link
      expect(result).toContain("[[TypeScript]] is great");
    });

    test("handles case-insensitive matching", () => {
      const content = "Using typescript in our project.";
      const result = insertWikilinks(content, ["TypeScript"]);
      expect(result).toContain("[[typescript]]");
    });

    test("handles multiple targets", () => {
      const content = "We use React and TypeScript together.";
      const result = insertWikilinks(content, ["React", "TypeScript"]);
      expect(result).toContain("[[React]]");
      expect(result).toContain("[[TypeScript]]");
    });

    test("returns unchanged content when target not found", () => {
      const content = "Nothing to link here.";
      const result = insertWikilinks(content, ["Nonexistent"]);
      expect(result).toBe(content);
    });

    test("handles empty targets array", () => {
      const content = "Some content.";
      const result = insertWikilinks(content, []);
      expect(result).toBe(content);
    });
  });

  describe("addBacklink", () => {
    test("adds backlink section to file without one", () => {
      const filePath = join(tempDir, "target.md");
      writeFileSync(filePath, "# Target Note\n\nSome content.\n");

      addBacklink(filePath, "Source Note");

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("## Backlinks");
      expect(content).toContain("- [[Source Note]]");
    });

    test("appends to existing backlinks section", () => {
      const filePath = join(tempDir, "target.md");
      writeFileSync(
        filePath,
        "# Target Note\n\nContent.\n\n## Backlinks\n- [[First Note]]\n"
      );

      addBacklink(filePath, "Second Note");

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("- [[First Note]]");
      expect(content).toContain("- [[Second Note]]");
    });

    test("does not add duplicate backlink", () => {
      const filePath = join(tempDir, "target.md");
      writeFileSync(
        filePath,
        "# Target Note\n\nContent.\n\n## Backlinks\n- [[Source Note]]\n"
      );

      addBacklink(filePath, "Source Note");

      const content = readFileSync(filePath, "utf-8");
      const matches = content.match(/\[\[Source Note\]\]/g);
      expect(matches?.length).toBe(1);
    });

    test("does nothing when target file does not exist", () => {
      const filePath = join(tempDir, "nonexistent.md");
      // Should not throw
      addBacklink(filePath, "Source Note");
    });

    test("handles file with only frontmatter", () => {
      const filePath = join(tempDir, "minimal.md");
      writeFileSync(filePath, "---\ncategory: inbox\n---\n");

      addBacklink(filePath, "Source Note");

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("## Backlinks");
      expect(content).toContain("- [[Source Note]]");
    });
  });

  describe("updateMasterIndex — prompt-cache layout", () => {
    let prevWikiPath: string | undefined;
    let vaultPath: string;
    let indexPath: string;

    beforeEach(() => {
      vaultPath = join(tempDir, "wiki");
      indexPath = join(vaultPath, "_index.md");
      prevWikiPath = process.env.MINK_WIKI_PATH;
      // Point the vault root at the test temp dir so updateMasterIndex
      // writes to a location we can read back.
      process.env.MINK_WIKI_PATH = vaultPath;
      mkdirSync(join(vaultPath, "projects"), { recursive: true });
      writeFileSync(join(vaultPath, "projects", "alpha.md"), "# Alpha\n");
    });

    afterEach(() => {
      if (prevWikiPath === undefined) delete process.env.MINK_WIKI_PATH;
      else process.env.MINK_WIKI_PATH = prevWikiPath;
    });

    test("prefix (first 5 lines) contains no volatile content", () => {
      updateMasterIndex(vaultPath);

      const content = readFileSync(indexPath, "utf-8");
      const prefix = content.split("\n").slice(0, 5).join("\n");

      // No ISO timestamps in the prefix
      expect(prefix).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      // No "Last updated" / "Generated" / "updated:" anywhere in the prefix
      expect(prefix.toLowerCase()).not.toContain("last updated");
      expect(prefix.toLowerCase()).not.toContain("generated:");
      expect(prefix).not.toMatch(/^updated:/m);
      // No YAML frontmatter at the top
      expect(prefix.startsWith("---")).toBe(false);
      // Title must be the very first line
      expect(content.split("\n")[0]).toBe("# Knowledge Base");
    });

    test("regenerating with different timestamps yields identical prefix bytes", () => {
      updateMasterIndex(vaultPath);
      const first = readFileSync(indexPath, "utf-8");

      // Force the clock forward enough to produce a different ISO timestamp.
      const realNow = Date.now;
      try {
        Date.now = () => realNow() + 60_000;
        updateMasterIndex(vaultPath);
      } finally {
        Date.now = realNow;
      }
      const second = readFileSync(indexPath, "utf-8");

      // The stable prefix (everything up to the footer marker) must be
      // byte-identical across regenerations so Anthropic's prefix prompt
      // cache stays warm.
      const footerMarker = "<!-- mink:footer";
      const firstPrefix = first.slice(0, first.indexOf(footerMarker));
      const secondPrefix = second.slice(0, second.indexOf(footerMarker));
      expect(firstPrefix).toBe(secondPrefix);

      // And the footer must actually carry the volatile timestamp.
      expect(second).toMatch(/<!-- mink:footer/);
      expect(second).toMatch(/Last updated:/);
    });
  });
});
