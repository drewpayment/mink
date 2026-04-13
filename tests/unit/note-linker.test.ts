import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  extractWikilinks,
  insertWikilinks,
  addBacklink,
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
});
