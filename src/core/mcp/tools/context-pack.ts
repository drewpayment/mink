// Tool: mink_context_pack — return the project's cache-friendly context pack
// (spec 26) so an MCP client can pin it as a stable prefix instead of
// rediscovering the project each session.

import { buildContextPack } from "../../context-pack";
import type { McpTool } from "../tool-types";
import { optionalPositiveInt } from "../tool-types";

export const contextPackTool: McpTool = {
  name: "mink_context_pack",
  title: "Project context pack",
  description:
    "Return a deterministic, cache-friendly context prefix for this project — " +
    "learned rules, recurring bugs, and a file-index skeleton, bounded by a " +
    "token budget. Load it once at the start of a session and reuse it.",
  inputSchema: {
    type: "object",
    properties: {
      budget: { type: "number", description: "Token budget for the pack (optional)." },
    },
    additionalProperties: false,
  },
  annotations: { title: "Project context pack", readOnlyHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const budgetTokens = optionalPositiveInt(args, "budget");
    return buildContextPack(ctx.cwd, budgetTokens ? { budgetTokens } : {});
  },
};
