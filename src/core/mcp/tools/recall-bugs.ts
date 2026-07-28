// Tool: mink_recall_bugs — search the project's bug memory for past bugs
// relevant to a query (and optionally a file), returning root cause and fix
// (spec 24). Backed by the FTS5 bug-memory repository; recall becomes semantic
// once spec 25 lands, with no change to this tool's contract.

import { BugMemoryRepo } from "../../../repositories/bug-memory-repo";
import type { SimilarityMatch } from "../../../types/bug-memory";
import type { McpTool } from "../tool-types";
import { optionalPositiveInt, optionalString, requireString } from "../tool-types";

function formatMatch(m: SimilarityMatch, rank: number): string {
  const e = m.entry;
  const where = e.lineNumber ? `${e.filePath}:${e.lineNumber}` : e.filePath;
  const tags = e.tags.length ? e.tags.join(", ") : "none";
  return [
    `${rank}. [score ${m.score.toFixed(2)}] ${e.errorMessage}`,
    `   where: ${where}  ·  seen ${e.occurrenceCount}×  ·  tags: ${tags}`,
    `   root cause: ${e.rootCause}`,
    `   fix: ${e.fixDescription}`,
    m.matchReasons.length ? `   matched on: ${m.matchReasons.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const recallBugsTool: McpTool = {
  name: "mink_recall_bugs",
  title: "Recall past bugs",
  description:
    "Search this project's bug memory for past bugs relevant to a query, with " +
    "their root cause and fix. Optionally bias toward a specific file. Consult " +
    "before debugging so you don't re-solve a problem that was already fixed.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Error text, symptom, or keywords to search for." },
      file: { type: "string", description: "Optional repo-relative file path to bias results toward." },
      limit: { type: "number", description: "Max matches to return (default 10)." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { title: "Recall past bugs", readOnlyHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const query = requireString(args, "query");
    const file = optionalString(args, "file");
    const limit = optionalPositiveInt(args, "limit") ?? 10;

    const matches = BugMemoryRepo.for(ctx.cwd).searchBugs(
      query,
      file ? { filePath: file } : undefined
    );

    if (matches.length === 0) {
      return `No past bugs found for "${query}".`;
    }

    const top = matches.slice(0, limit);
    const header =
      `Found ${matches.length} past bug(s) for "${query}"` +
      (matches.length > top.length ? ` (showing ${top.length}):` : ":");
    return [header, "", ...top.map((m, i) => formatMatch(m, i + 1))].join("\n\n");
  },
};
