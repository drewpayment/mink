import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, writeFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  extractNoteTitle,
  extractNoteTags,
  extractNoteCategory,
  buildEntryFromContent,
  createEmptyVaultIndex,
  updateVaultEntry,
  removeVaultEntry,
  loadVaultIndex,
  saveVaultIndex,
  searchVaultIndex,
} from "../../src/core/note-index";
import { ensureVaultStructure } from "../../src/core/vault";

describe("note-index", () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mink-test-"));
    originalEnv = process.env.MINK_WIKI_PATH;
    process.env.MINK_WIKI_PATH = tempDir;
    ensureVaultStructure();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MINK_WIKI_PATH;
    } else {
      process.env.MINK_WIKI_PATH = originalEnv;
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("extractNoteTitle", () => {
    test("extracts title from H1 heading", () => {
      const content = "---\ncategory: inbox\n---\n\n# My Note Title\n\nBody text.";
      expect(extractNoteTitle(content)).toBe("My Note Title");
    });

    test("extracts title from frontmatter title field", () => {
      const content = '---\ntitle: "Frontmatter Title"\n---\n\nBody text.';
      expect(extractNoteTitle(content)).toBe("Frontmatter Title");
    });

    test("prefers H1 heading over frontmatter title", () => {
      const content =
        '---\ntitle: "FM Title"\n---\n\n# Heading Title\n\nBody text.';
      expect(extractNoteTitle(content)).toBe("Heading Title");
    });

    test("returns first line after frontmatter when no heading", () => {
      const content = "---\ncategory: inbox\n---\n\nSome plain text here.";
      expect(extractNoteTitle(content)).toBe("Some plain text here.");
    });

    test("returns Untitled for empty content", () => {
      expect(extractNoteTitle("")).toBe("Untitled");
    });

    test("returns Untitled for content with only frontmatter", () => {
      const content = "---\ncategory: inbox\n---";
      expect(extractNoteTitle(content)).toBe("Untitled");
    });

    test("handles content without frontmatter", () => {
      const content = "# Simple Note\n\nBody text.";
      expect(extractNoteTitle(content)).toBe("Simple Note");
    });

    test("trims whitespace from title", () => {
      const content = "#   Spaced Title   \n\nBody.";
      expect(extractNoteTitle(content)).toBe("Spaced Title");
    });
  });

  describe("extractNoteTags", () => {
    test("extracts inline tags array", () => {
      const content = "---\ntags: [typescript, testing, bun]\n---\n\n# Note";
      expect(extractNoteTags(content)).toEqual(["typescript", "testing", "bun"]);
    });

    test("extracts quoted tags", () => {
      const content = '---\ntags: ["typescript", "testing"]\n---\n\n# Note';
      expect(extractNoteTags(content)).toEqual(["typescript", "testing"]);
    });

    test("extracts multiline tags", () => {
      const content =
        "---\ntags:\n  - typescript\n  - testing\ncategory: inbox\n---\n\n# Note";
      expect(extractNoteTags(content)).toEqual(["typescript", "testing"]);
    });

    test("returns empty array when no tags", () => {
      const content = "---\ncategory: inbox\n---\n\n# Note";
      expect(extractNoteTags(content)).toEqual([]);
    });

    test("returns empty array for empty content", () => {
      expect(extractNoteTags("")).toEqual([]);
    });

    test("handles single tag", () => {
      const content = "---\ntags: [daily]\n---\n\n# Note";
      expect(extractNoteTags(content)).toEqual(["daily"]);
    });
  });

  describe("extractNoteCategory", () => {
    test("extracts category from frontmatter", () => {
      const content = "---\ncategory: projects\n---\n\n# Note";
      expect(extractNoteCategory(content)).toBe("projects");
    });

    test("returns inbox as default for missing category", () => {
      const content = "---\ntags: [test]\n---\n\n# Note";
      expect(extractNoteCategory(content)).toBe("inbox");
    });

    test("returns inbox for invalid category", () => {
      const content = "---\ncategory: invalid\n---\n\n# Note";
      expect(extractNoteCategory(content)).toBe("inbox");
    });

    test("returns inbox for empty content", () => {
      expect(extractNoteCategory("")).toBe("inbox");
    });

    test("handles all valid categories", () => {
      const categories = ["inbox", "projects", "areas", "resources", "archives"];
      for (const cat of categories) {
        const content = `---\ncategory: ${cat}\n---\n\n# Note`;
        expect(extractNoteCategory(content)).toBe(cat);
      }
    });

    test("strips quotes from category", () => {
      const content = '---\ncategory: "areas"\n---\n\n# Note';
      expect(extractNoteCategory(content)).toBe("areas");
    });
  });

  describe("buildEntryFromContent", () => {
    test("builds complete entry from note content", () => {
      const content = `---
created: "2024-01-01T00:00:00Z"
tags: [typescript, testing]
category: projects
---

# My Project

This is the project description.`;

      const entry = buildEntryFromContent(
        "projects/my-project.md",
        content,
        "2024-01-01T00:00:00Z"
      );

      expect(entry.filePath).toBe("projects/my-project.md");
      expect(entry.title).toBe("My Project");
      expect(entry.tags).toEqual(["typescript", "testing"]);
      expect(entry.category).toBe("projects");
      expect(entry.lastModified).toBe("2024-01-01T00:00:00Z");
      expect(entry.estimatedTokens).toBeGreaterThan(0);
    });

    test("extracts description from first body line", () => {
      const content = `---
category: inbox
---

# Title

First paragraph here.

Second paragraph.`;

      const entry = buildEntryFromContent("inbox/test.md", content, "2024-01-01");
      expect(entry.description).toBe("First paragraph here.");
    });

    test("truncates description to 120 characters", () => {
      const longLine = "A".repeat(200);
      const content = `---
category: inbox
---

# Title

${longLine}`;

      const entry = buildEntryFromContent("inbox/test.md", content, "2024-01-01");
      expect(entry.description.length).toBeLessThanOrEqual(120);
    });

    test("handles content without frontmatter", () => {
      const content = "# Simple Note\n\nBody text here.";
      const entry = buildEntryFromContent("inbox/simple.md", content, "2024-01-01");
      expect(entry.title).toBe("Simple Note");
      expect(entry.category).toBe("inbox");
    });

    test("handles empty body", () => {
      const content = "---\ncategory: inbox\n---\n\n# Title Only";
      const entry = buildEntryFromContent("inbox/empty.md", content, "2024-01-01");
      expect(entry.title).toBe("Title Only");
      expect(entry.description).toBe("");
    });
  });

  describe("vault index CRUD", () => {
    test("createEmptyVaultIndex returns empty structure", () => {
      const index = createEmptyVaultIndex();
      expect(index.totalNotes).toBe(0);
      expect(index.lastScanTimestamp).toBe("");
      expect(Object.keys(index.entries)).toHaveLength(0);
    });

    test("updateVaultEntry adds entry and updates count", () => {
      const index = createEmptyVaultIndex();
      updateVaultEntry(index, {
        filePath: "inbox/test.md",
        title: "Test",
        description: "",
        tags: [],
        category: "inbox",
        estimatedTokens: 10,
        lastModified: "2024-01-01",
      });

      expect(index.totalNotes).toBe(1);
      expect(index.entries["inbox/test.md"]).toBeDefined();
    });

    test("removeVaultEntry removes entry and updates count", () => {
      const index = createEmptyVaultIndex();
      updateVaultEntry(index, {
        filePath: "inbox/test.md",
        title: "Test",
        description: "",
        tags: [],
        category: "inbox",
        estimatedTokens: 10,
        lastModified: "2024-01-01",
      });
      removeVaultEntry(index, "inbox/test.md");

      expect(index.totalNotes).toBe(0);
      expect(index.entries["inbox/test.md"]).toBeUndefined();
    });

    test("save and load round-trip", () => {
      const index = createEmptyVaultIndex();
      updateVaultEntry(index, {
        filePath: "inbox/roundtrip.md",
        title: "Round Trip",
        description: "desc",
        tags: ["test"],
        category: "inbox",
        estimatedTokens: 20,
        lastModified: "2024-01-01",
      });
      index.lastScanTimestamp = "2024-01-01T00:00:00Z";

      saveVaultIndex(index);
      const loaded = loadVaultIndex();

      expect(loaded.totalNotes).toBe(1);
      expect(loaded.entries["inbox/roundtrip.md"].title).toBe("Round Trip");
      expect(loaded.lastScanTimestamp).toBe("2024-01-01T00:00:00Z");
    });

    test("loadVaultIndex returns empty index when file missing", () => {
      const index = loadVaultIndex();
      expect(index.totalNotes).toBe(0);
      expect(Object.keys(index.entries)).toHaveLength(0);
    });
  });

  describe("searchVaultIndex", () => {
    test("searches by title", () => {
      const index = createEmptyVaultIndex();
      updateVaultEntry(index, {
        filePath: "inbox/react.md",
        title: "React Setup Guide",
        description: "How to set up React",
        tags: ["react"],
        category: "inbox",
        estimatedTokens: 50,
        lastModified: "2024-01-01",
      });
      updateVaultEntry(index, {
        filePath: "inbox/vue.md",
        title: "Vue Setup Guide",
        description: "How to set up Vue",
        tags: ["vue"],
        category: "inbox",
        estimatedTokens: 50,
        lastModified: "2024-01-01",
      });
      saveVaultIndex(index);

      const results = searchVaultIndex("React");
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("React Setup Guide");
    });

    test("searches by tag", () => {
      const index = createEmptyVaultIndex();
      updateVaultEntry(index, {
        filePath: "inbox/note.md",
        title: "Some Note",
        description: "A note",
        tags: ["typescript"],
        category: "inbox",
        estimatedTokens: 20,
        lastModified: "2024-01-01",
      });
      saveVaultIndex(index);

      const results = searchVaultIndex("typescript");
      expect(results.length).toBe(1);
    });

    test("searches by description", () => {
      const index = createEmptyVaultIndex();
      updateVaultEntry(index, {
        filePath: "inbox/note.md",
        title: "Some Title",
        description: "Contains unique keyword foobar",
        tags: [],
        category: "inbox",
        estimatedTokens: 20,
        lastModified: "2024-01-01",
      });
      saveVaultIndex(index);

      const results = searchVaultIndex("foobar");
      expect(results.length).toBe(1);
    });

    test("searches by file path", () => {
      const index = createEmptyVaultIndex();
      updateVaultEntry(index, {
        filePath: "projects/my-app/setup.md",
        title: "Setup",
        description: "",
        tags: [],
        category: "projects",
        estimatedTokens: 10,
        lastModified: "2024-01-01",
      });
      saveVaultIndex(index);

      const results = searchVaultIndex("my-app");
      expect(results.length).toBe(1);
    });

    test("returns empty array for no matches", () => {
      const index = createEmptyVaultIndex();
      saveVaultIndex(index);

      const results = searchVaultIndex("nonexistent");
      expect(results.length).toBe(0);
    });

    test("case-insensitive search", () => {
      const index = createEmptyVaultIndex();
      updateVaultEntry(index, {
        filePath: "inbox/note.md",
        title: "TypeScript Guide",
        description: "",
        tags: [],
        category: "inbox",
        estimatedTokens: 10,
        lastModified: "2024-01-01",
      });
      saveVaultIndex(index);

      const results = searchVaultIndex("typescript");
      expect(results.length).toBe(1);
    });
  });
});
