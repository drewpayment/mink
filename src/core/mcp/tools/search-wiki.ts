// Tool: mink_search_wiki — search the user's cross-project knowledge vault
// (notes/wiki) by keyword (spec 24). The vault is global, not project-scoped,
// so this tool ignores the request cwd. Gracefully reports when the wiki is
// disabled or uninitialized rather than erroring.

import { searchVaultIndex } from "../../note-index";
import { isVaultInitialized, isWikiEnabled } from "../../vault";
import type { McpTool } from "../tool-types";
import { optionalPositiveInt, requireString } from "../tool-types";

export const searchWikiTool: McpTool = {
  name: "mink_search_wiki",
  title: "Search the wiki",
  description:
    "Search the user's cross-project knowledge vault (notes/wiki) by keyword " +
    "across note titles, descriptions, tags, and paths. Returns matching notes " +
    "with their category and vault path.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Keywords to match against notes." },
      limit: { type: "number", description: "Max notes to return (default 10)." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { title: "Search the wiki", readOnlyHint: true, openWorldHint: false },
  async handler(args) {
    const query = requireString(args, "query");
    const limit = optionalPositiveInt(args, "limit") ?? 10;

    if (!isWikiEnabled()) {
      return "The wiki is not enabled. Enable it with `mink config wiki.enabled true`.";
    }
    if (!isVaultInitialized()) {
      return "The wiki vault is not initialized. Run `mink wiki init` first.";
    }

    const results = searchVaultIndex(query);
    if (results.length === 0) {
      return `No wiki notes found for "${query}".`;
    }

    const top = results.slice(0, limit);
    const header =
      `Found ${results.length} note(s) for "${query}"` +
      (results.length > top.length ? ` (showing ${top.length}):` : ":");
    const lines = top.map(
      (r, i) =>
        `${i + 1}. ${r.title} — ${r.description || "(no description)"}\n` +
        `   [${r.category}] ${r.filePath}  ·  tags: ${r.tags.join(", ") || "none"}`
    );
    return [header, "", ...lines].join("\n");
  },
};
