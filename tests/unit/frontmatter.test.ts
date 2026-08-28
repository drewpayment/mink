import { describe, test, expect } from "bun:test";

import { parseFrontmatter } from "../../src/core/frontmatter";
import { generateFrontmatter } from "../../src/core/note-writer";

const fm = (...lines: string[]) => `---\n${lines.join("\n")}\n---\n\n# Title\n\nBody.\n`;

describe("parseFrontmatter", () => {
  test("parses scalars and strips surrounding quotes", () => {
    const { frontmatter } = parseFrontmatter(
      fm('created: "2024-01-01T00:00:00Z"', "category: inbox")
    );
    expect(frontmatter.created).toBe("2024-01-01T00:00:00Z");
    expect(frontmatter.category).toBe("inbox");
  });

  test("parses an unquoted flow sequence", () => {
    const { frontmatter } = parseFrontmatter(fm("tags: [alpha, beta]"));
    expect(frontmatter.tags).toEqual(["alpha", "beta"]);
  });

  test("parses an empty flow sequence", () => {
    const { frontmatter } = parseFrontmatter(fm("tags: []"));
    expect(frontmatter.tags).toEqual([]);
  });

  test("returns the body with the frontmatter block removed", () => {
    const { body } = parseFrontmatter(fm("category: inbox"));
    expect(body).toBe("\n# Title\n\nBody.\n");
  });

  test("returns no frontmatter when the content has none", () => {
    const { frontmatter, body } = parseFrontmatter("# Title\n\nBody.\n");
    expect(frontmatter).toEqual({});
    expect(body).toBe("# Title\n\nBody.\n");
  });

  // A naive split(",") tore quoted values apart: note-writer quotes any alias
  // containing a comma, so the alias it deliberately wrote to keep a wikilink
  // alive came back as two useless fragments inside Mink's own indexer.
  test("does not split on a comma inside a double-quoted value", () => {
    const { frontmatter } = parseFrontmatter(
      fm('aliases: ["Auth, Sessions and Tokens", plain]')
    );
    expect(frontmatter.aliases).toEqual(["Auth, Sessions and Tokens", "plain"]);
  });

  test("does not split on a comma inside a single-quoted value", () => {
    const { frontmatter } = parseFrontmatter(
      fm("aliases: ['Auth, Sessions and Tokens', plain]")
    );
    expect(frontmatter.aliases).toEqual(["Auth, Sessions and Tokens", "plain"]);
  });

  test("keeps a colon inside a quoted value", () => {
    const { frontmatter } = parseFrontmatter(fm('aliases: ["Chapter 1: Intro"]'));
    expect(frontmatter.aliases).toEqual(["Chapter 1: Intro"]);
  });

  test("unescapes an escaped double quote", () => {
    const { frontmatter } = parseFrontmatter(fm('aliases: ["The \\"Best\\" Note", plain]'));
    expect(frontmatter.aliases).toEqual(['The "Best" Note', "plain"]);
  });

  test("unescapes a doubled single quote", () => {
    const { frontmatter } = parseFrontmatter(fm("aliases: ['It''s Fine']"));
    expect(frontmatter.aliases).toEqual(["It's Fine"]);
  });

  test("handles several quoted values in one sequence", () => {
    const { frontmatter } = parseFrontmatter(
      fm('aliases: ["A, B", "C: D", plain, "E, F"]')
    );
    expect(frontmatter.aliases).toEqual(["A, B", "C: D", "plain", "E, F"]);
  });

  test("falls back to a lenient strip on malformed escapes rather than dropping the value", () => {
    const { frontmatter } = parseFrontmatter(fm('aliases: ["bad \\q escape"]'));
    expect(frontmatter.aliases).toEqual(["bad \\q escape"]);
  });

  // The two halves of the bug have to agree: note-writer quoting a value is
  // only useful if the shared parser reads that quoting back the same way.
  describe("round-trips with generateFrontmatter", () => {
    const cases: string[][] = [
      ["Auth, Sessions and Tokens"],
      ["Chapter 1: Intro"],
      ['The "Best" Note'],
      ["Auth, Sessions and Tokens", "Chapter 1: Intro", "plain"],
      ["trailing space "],
      ["#hashtag", "*star", "&anchor"],
    ];

    for (const aliases of cases) {
      test(`preserves ${JSON.stringify(aliases)}`, () => {
        const content = `${generateFrontmatter({
          created: "2024-01-01T00:00:00Z",
          updated: "2024-01-01T00:00:00Z",
          tags: [],
          category: "inbox",
          aliases,
        })}\n\n# Title\n\nBody.\n`;

        expect(parseFrontmatter(content).frontmatter.aliases).toEqual(aliases);
      });
    }
  });
});
