// Tool: mink_similar_tasks — find prior sessions similar to the task at hand,
// by the files it touches (Jaccard) or a keyword query, so the assistant can
// reuse a past approach (spec 29).

import { findSimilarTasks, formatSimilarTasks } from "../../similar-tasks";
import type { McpTool } from "../tool-types";
import { ToolInputError, optionalPositiveInt, optionalString, optionalStringArray } from "../tool-types";

export const similarTasksTool: McpTool = {
  name: "mink_similar_tasks",
  title: "Recall similar tasks",
  description:
    "Find prior sessions similar to the current task and reuse their approach. " +
    "Pass the files you're about to work on (ranked by overlap) and/or a " +
    "free-text query (matched against prior sessions' file paths).",
  inputSchema: {
    type: "object",
    properties: {
      files: { type: "array", items: { type: "string" }, description: "Files the task touches." },
      query: { type: "string", description: "Free-text description of the task." },
      limit: { type: "number", description: "Max matches (default 5)." },
    },
    additionalProperties: false,
  },
  annotations: { title: "Recall similar tasks", readOnlyHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const files = optionalStringArray(args, "files");
    const query = optionalString(args, "query");
    const limit = optionalPositiveInt(args, "limit");
    if ((!files || files.length === 0) && (!query || query.length === 0)) {
      throw new ToolInputError("provide `files` and/or `query`");
    }
    return formatSimilarTasks(findSimilarTasks(ctx.cwd, { files, query, limit }));
  },
};
