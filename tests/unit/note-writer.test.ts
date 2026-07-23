import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  slugifyTitle,
  generateFrontmatter,
  createNote,
  appendToDaily,
  upsertFrontmatterAliases,
} from "../../src/core/note-writer";
import { ensureVaultStructure } from "../../src/core/vault";

describe("note-writer", () => {
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

  describe("slugifyTitle", () => {
    test("converts to lowercase", () => {
      expect(slugifyTitle("Hello World")).toBe("hello-world");
    });

    test("replaces spaces with hyphens", () => {
      expect(slugifyTitle("my great note")).toBe("my-great-note");
    });

    test("removes special characters", () => {
      expect(slugifyTitle("Hello! World? #1")).toBe("hello-world-1");
    });

    test("collapses multiple hyphens", () => {
      expect(slugifyTitle("hello---world")).toBe("hello-world");
    });

    test("trims leading and trailing hyphens", () => {
      expect(slugifyTitle("-hello-")).toBe("hello");
    });

    test("truncates to 80 characters", () => {
      const long = "a".repeat(100);
      expect(slugifyTitle(long).length).toBeLessThanOrEqual(80);
    });

    test("handles empty string", () => {
      expect(slugifyTitle("")).toBe("");
    });

    test("handles string with only special characters", () => {
      expect(slugifyTitle("!@#$%")).toBe("");
    });

    test("handles mixed case and numbers", () => {
      expect(slugifyTitle("React v18.2 Setup Guide")).toBe(
        "react-v182-setup-guide"
      );
    });
  });

  describe("generateFrontmatter", () => {
    test("generates valid frontmatter with tags", () => {
      const result = generateFrontmatter({
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        tags: ["typescript", "testing"],
        category: "inbox",
      });
      expect(result).toContain("---");
      expect(result).toContain('created: "2024-01-01T00:00:00Z"');
      expect(result).toContain('updated: "2024-01-01T00:00:00Z"');
      expect(result).toContain("tags: [typescript, testing]");
      expect(result).toContain("category: inbox");
    });

    test("generates empty tags array", () => {
      const result = generateFrontmatter({
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        tags: [],
        category: "inbox",
      });
      expect(result).toContain("tags: []");
    });

    test("includes sourceProject when provided", () => {
      const result = generateFrontmatter({
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        tags: [],
        category: "projects",
        sourceProject: "my-app",
      });
      expect(result).toContain("source_project: my-app");
    });

    test("omits sourceProject when not provided", () => {
      const result = generateFrontmatter({
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        tags: [],
        category: "inbox",
      });
      expect(result).not.toContain("source_project");
    });

    test("includes aliases when provided", () => {
      const result = generateFrontmatter({
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        tags: [],
        category: "inbox",
        aliases: ["alias1", "alias2"],
      });
      expect(result).toContain("aliases: [alias1, alias2]");
    });

    test("includes extra fields when provided", () => {
      const result = generateFrontmatter({
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        tags: [],
        category: "inbox",
        extra: { status: "draft", priority: 1 },
      });
      expect(result).toContain('status: "draft"');
      expect(result).toContain("priority: 1");
    });

    test("frontmatter starts and ends with ---", () => {
      const result = generateFrontmatter({
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        tags: [],
        category: "inbox",
      });
      expect(result.startsWith("---")).toBe(true);
      expect(result.endsWith("---")).toBe(true);
    });
  });

  describe("createNote", () => {
    test("creates a note file on disk", () => {
      const result = createNote({
        title: "Test Note",
        category: "inbox",
        tags: ["test"],
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        body: "This is a test.",
      });

      expect(existsSync(result.filePath)).toBe(true);
      expect(result.filePath).toContain("test-note.md");
      expect(result.content).toContain("# Test Note");
      expect(result.content).toContain("This is a test.");
    });

    test("creates note in correct category directory", () => {
      const result = createNote({
        title: "Project Note",
        category: "projects",
        tags: [],
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        body: "Content here.",
        projectSlug: "my-app",
      });

      expect(result.filePath).toContain(join("projects", "my-app"));
    });

    test("includes frontmatter in created note", () => {
      const result = createNote({
        title: "FM Test",
        category: "inbox",
        tags: ["tag1"],
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        body: "Body text.",
      });

      const content = readFileSync(result.filePath, "utf-8");
      expect(content).toContain("---");
      expect(content).toContain("tags: [tag1]");
      expect(content).toContain("category: inbox");
    });

    test("uses template when specified", () => {
      const result = createNote({
        title: "Meeting Notes",
        category: "areas",
        tags: ["meeting"],
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        body: "Discussion items.",
        template: "meeting",
      });

      const content = readFileSync(result.filePath, "utf-8");
      expect(content).toContain("## Agenda");
      expect(content).toContain("## Action Items");
    });

    test("falls back to default content when template not found", () => {
      const result = createNote({
        title: "No Template",
        category: "inbox",
        tags: [],
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
        body: "Just a note.",
        template: "nonexistent-template",
      });

      const content = readFileSync(result.filePath, "utf-8");
      expect(content).toContain("# No Template");
      expect(content).toContain("Just a note.");
    });
  });

  describe("appendToDaily", () => {
    test("creates new daily note when none exists", () => {
      const filePath = appendToDaily("2024-01-15", "Today's note content");

      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("2024-01-15");
      // The daily-note template uses structured sections (Focus, Notes, Tasks, Reflections)
      // and does not embed the body content directly into the template
      expect(content).toContain("## Focus");
      expect(content).toContain("tags: [daily]");
    });

    test("appends to existing daily note", () => {
      // Create initial daily note (structured template, content not embedded)
      appendToDaily("2024-01-15", "First entry");

      // Append more content - this adds a timestamped section
      const filePath = appendToDaily("2024-01-15", "Second entry");

      const content = readFileSync(filePath, "utf-8");
      // Second append adds content with a timestamp header
      expect(content).toContain("Second entry");
    });

    test("daily note file is in areas/daily directory", () => {
      const filePath = appendToDaily("2024-01-15", "content");
      expect(filePath).toContain(join("areas", "daily", "2024-01-15.md"));
    });

    test("appended content has timestamp header", () => {
      appendToDaily("2024-01-15", "First");
      appendToDaily("2024-01-15", "Second");

      const filePath = join(tempDir, "areas", "daily", "2024-01-15.md");
      const content = readFileSync(filePath, "utf-8");
      // The append adds a ## HH:MM header
      expect(content).toMatch(/## \d{2}:\d{2}/);
    });
  });

  describe("upsertFrontmatterAliases", () => {
    function fm(body: string, extra = ""): string {
      return `---\ncreated: "2026-01-01T00:00:00.000Z"\ntags: []${extra}\n---\n\n${body}\n`;
    }

    test("quotes an alias value containing a colon (proven repro: 'Chapter 1: Intro')", () => {
      // Regression for a real bug: an unquoted colon inside a YAML flow
      // sequence reopens it as a nested mapping, so
      // `aliases: [Chapter 1: Intro]` does NOT parse as the single string
      // "Chapter 1: Intro" — it parses as a mapping `Chapter 1` -> `Intro`.
      const result = upsertFrontmatterAliases(fm("# Chapter 1: Intro"), ["Chapter 1: Intro"]);
      expect(result).toContain('aliases: ["Chapter 1: Intro"]');
      // Explicitly assert the malformed unquoted form is NOT produced.
      expect(result).not.toContain("aliases: [Chapter 1: Intro]");
    });

    test("quotes values with other YAML flow-indicator characters", () => {
      const result = upsertFrontmatterAliases(fm("# x"), ["a, b", "100%", "#hashtag", "a & b"]);
      expect(result).toContain('"a, b"');
      expect(result).toContain('"100%"');
      expect(result).toContain('"#hashtag"');
      expect(result).toContain('"a & b"');
    });

    test("leaves a plain alphanumeric alias unquoted", () => {
      const result = upsertFrontmatterAliases(fm("# x"), ["Global Catalog"]);
      expect(result).toContain("aliases: [Global Catalog]");
    });

    test("does not touch a body that opens with a '---' thematic break followed by prose", () => {
      // No `key:` line inside the block — this is markdown prose that
      // happens to start with a horizontal rule, not frontmatter. Splicing
      // an aliases: line into it would corrupt the note body.
      const body = "---\nJust a paragraph that starts with a rule above it.\n\nMore prose.\n";
      const result = upsertFrontmatterAliases(body, ["Some Title"]);
      expect(result).toBe(body);
    });

    test("does not touch content whose first line is not exactly '---'", () => {
      const body = "----\ncreated: x\n----\n\n# Title\n";
      const result = upsertFrontmatterAliases(body, ["Title"]);
      expect(result).toBe(body);
    });

    test("still recognizes real frontmatter with only one field", () => {
      const body = "---\ntags: []\n---\n\n# Title\n";
      const result = upsertFrontmatterAliases(body, ["Title"]);
      expect(result).toContain("aliases: [Title]");
    });

    test("normalizes CRLF frontmatter to LF when rebuilding the block", () => {
      const crlf = '---\r\ncreated: "2026-01-01T00:00:00.000Z"\r\ntags: []\r\n---\r\n\r\n# Title\r\n';
      const result = upsertFrontmatterAliases(crlf, ["Title"]);
      // Between the opening and closing "---" delimiters, the rebuilt
      // frontmatter is LF-only — even though the input was CRLF and the
      // untouched body after the closing delimiter keeps its original
      // line endings.
      const between = result.split("---")[1];
      expect(between).not.toContain("\r");
      expect(between).toContain("aliases: [Title]");
    });

    test("merges into an existing aliases array without duplicating, still quoting new unsafe values", () => {
      const body = fm("# x", "\naliases: [Existing]");
      const result = upsertFrontmatterAliases(body, ["Existing", "New: Value"]);
      expect(result).toContain('aliases: [Existing, "New: Value"]');
    });
  });
});
