import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  seedTemplates,
  loadTemplate,
  fillTemplate,
  DEFAULT_TEMPLATES,
} from "../../src/core/vault-templates";

describe("vault-templates", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("DEFAULT_TEMPLATES", () => {
    test("contains expected template names", () => {
      expect(DEFAULT_TEMPLATES["quick-capture"]).toBeDefined();
      expect(DEFAULT_TEMPLATES["daily-note"]).toBeDefined();
      expect(DEFAULT_TEMPLATES["meeting"]).toBeDefined();
      expect(DEFAULT_TEMPLATES["project"]).toBeDefined();
      expect(DEFAULT_TEMPLATES["area"]).toBeDefined();
      expect(DEFAULT_TEMPLATES["person"]).toBeDefined();
    });

    test("all templates contain frontmatter", () => {
      for (const [, content] of Object.entries(DEFAULT_TEMPLATES)) {
        expect(content).toContain("---");
        expect(content).toContain("created:");
        expect(content).toContain("updated:");
      }
    });

    test("all templates contain {{created}} placeholder", () => {
      for (const [, content] of Object.entries(DEFAULT_TEMPLATES)) {
        expect(content).toContain("{{created}}");
        expect(content).toContain("{{updated}}");
      }
    });
  });

  describe("seedTemplates", () => {
    test("creates template files in directory", () => {
      seedTemplates(tempDir);

      for (const name of Object.keys(DEFAULT_TEMPLATES)) {
        const filePath = join(tempDir, `${name}.md`);
        expect(existsSync(filePath)).toBe(true);
      }
    });

    test("does not overwrite existing templates", () => {
      const customContent = "# My Custom Template\n";
      writeFileSync(join(tempDir, "quick-capture.md"), customContent);

      seedTemplates(tempDir);

      const content = readFileSync(join(tempDir, "quick-capture.md"), "utf-8");
      expect(content).toBe(customContent);
    });

    test("creates missing templates alongside existing ones", () => {
      writeFileSync(join(tempDir, "quick-capture.md"), "custom");

      seedTemplates(tempDir);

      // Existing file preserved
      expect(readFileSync(join(tempDir, "quick-capture.md"), "utf-8")).toBe(
        "custom"
      );
      // Other templates created
      expect(existsSync(join(tempDir, "daily-note.md"))).toBe(true);
      expect(existsSync(join(tempDir, "meeting.md"))).toBe(true);
    });

    test("creates directory if it does not exist", () => {
      const nestedDir = join(tempDir, "nested", "templates");
      seedTemplates(nestedDir);
      expect(existsSync(nestedDir)).toBe(true);
    });

    test("is idempotent", () => {
      seedTemplates(tempDir);
      seedTemplates(tempDir);

      for (const name of Object.keys(DEFAULT_TEMPLATES)) {
        expect(existsSync(join(tempDir, `${name}.md`))).toBe(true);
      }
    });
  });

  describe("fillTemplate", () => {
    test("replaces single variable", () => {
      const result = fillTemplate("Hello {{name}}!", { name: "World" });
      expect(result).toBe("Hello World!");
    });

    test("replaces multiple variables", () => {
      const result = fillTemplate("{{greeting}} {{name}}!", {
        greeting: "Hello",
        name: "World",
      });
      expect(result).toBe("Hello World!");
    });

    test("replaces all occurrences of same variable", () => {
      const result = fillTemplate("{{x}} and {{x}} again", { x: "value" });
      expect(result).toBe("value and value again");
    });

    test("leaves unmatched placeholders intact", () => {
      const result = fillTemplate("{{known}} and {{unknown}}", {
        known: "replaced",
      });
      expect(result).toBe("replaced and {{unknown}}");
    });

    test("handles empty vars", () => {
      const result = fillTemplate("No vars here.", {});
      expect(result).toBe("No vars here.");
    });

    test("handles empty template", () => {
      const result = fillTemplate("", { key: "value" });
      expect(result).toBe("");
    });

    test("handles vars with special characters in values", () => {
      const result = fillTemplate("Path: {{path}}", {
        path: "/home/user/.mink/wiki",
      });
      expect(result).toBe("Path: /home/user/.mink/wiki");
    });
  });

  describe("loadTemplate", () => {
    test("loads template from disk", () => {
      seedTemplates(tempDir);
      const result = loadTemplate(tempDir, "quick-capture", {
        title: "My Note",
        body: "Note content",
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("# My Note");
      expect(result).toContain("Note content");
      expect(result).toContain("2024-01-01T00:00:00Z");
    });

    test("falls back to DEFAULT_TEMPLATES when file not on disk", () => {
      // Don't seed templates - directory exists but is empty
      const result = loadTemplate(tempDir, "quick-capture", {
        title: "Fallback",
        body: "Content",
        created: "2024-01-01T00:00:00Z",
        updated: "2024-01-01T00:00:00Z",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("# Fallback");
    });

    test("returns null for unknown template name", () => {
      const result = loadTemplate(tempDir, "nonexistent", {
        title: "Test",
      });
      expect(result).toBeNull();
    });

    test("loads custom template from disk", () => {
      const customTemplate = "# {{title}}\n\nCustom: {{body}}";
      writeFileSync(join(tempDir, "custom.md"), customTemplate);

      const result = loadTemplate(tempDir, "custom", {
        title: "Custom Note",
        body: "Custom body",
      });

      expect(result).toBe("# Custom Note\n\nCustom: Custom body");
    });

    test("fills daily-note template variables", () => {
      const result = loadTemplate(tempDir, "daily-note", {
        date: "2024-01-15",
        created: "2024-01-15T08:00:00Z",
        updated: "2024-01-15T08:00:00Z",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("# 2024-01-15");
      expect(result).toContain("tags: [daily]");
      expect(result).toContain("## Focus");
    });

    test("fills meeting template variables", () => {
      const result = loadTemplate(tempDir, "meeting", {
        title: "Sprint Planning",
        date: "2024-01-15",
        created: "2024-01-15T10:00:00Z",
        updated: "2024-01-15T10:00:00Z",
      });

      expect(result).not.toBeNull();
      expect(result).toContain("# Sprint Planning");
      expect(result).toContain("**Date**: 2024-01-15");
      expect(result).toContain("## Action Items");
    });
  });
});
