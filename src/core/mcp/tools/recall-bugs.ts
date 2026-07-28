// Tool: mink_recall_bugs — search the project's bug memory for past bugs
// relevant to a query (and optionally a file), returning root cause and fix
// (spec 24). Backed by the FTS5 bug-memory repository; recall becomes semantic
// once spec 25 lands, with no change to this tool's contract.

import { recallBugs, type BugRecallMatch } from "../../embeddings/recall";
import type { McpTool } from "../tool-types";
import { optionalPositiveInt, optionalString, requireString } from "../tool-types";

function formatMatch(m: BugRecallMatch, rank: number): string {
  const e = m.entry;
  const where = e.lineNumber ? `${e.filePath}:${e.lineNumber}` : e.filePath;
  const tags = e.tags.length ? e.tags.join(", ") : "none";
  const origin = m.project ? `  ·  project: ${m.project}` : "";
  return [
    `${rank}. [score ${m.score.toFixed(3)}] ${e.errorMessage}`,
    `   where: ${where}  ·  seen ${e.occurrenceCount}×  ·  tags: ${tags}${origin}`,
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

    // Hybrid recall: FTS5 fused with semantic vectors when embeddings are
    // enabled and available; otherwise exactly the FTS5 result. May include
    // matches from other projects when cross-project recall is enabled.
    const matches = await recallBugs(ctx.cwd, query, { filePath: file, limit });

    if (matches.length === 0) {
      return `No past bugs found for "${query}".`;
    }

    const local = matches.filter((m) => !m.project).slice(0, limit);
    const cross = matches.filter((m) => m.project).slice(0, limit);

    const sections: string[] = [];
    if (local.length > 0) {
      sections.push(`Found ${local.length} past bug(s) for "${query}":`);
      sections.push(local.map((m, i) => formatMatch(m, i + 1)).join("\n\n"));
    }
    if (cross.length > 0) {
      sections.push(`Related bugs from other projects (${cross.length}):`);
      sections.push(cross.map((m, i) => formatMatch(m, i + 1)).join("\n\n"));
    }
    return sections.join("\n\n");
  },
};
