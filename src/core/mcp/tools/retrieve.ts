// Tool: mink_retrieve — return the byte-exact original of a previously
// compressed tool output (spec 22 §Reversibility, exposed over MCP by spec 24).
//
// This closes the compression loop as a first-class pull affordance: when Mink
// substitutes a large tool output with a compact summary, it embeds a retrieval
// token. The assistant calls this tool with that token to recover the full
// original on demand. An unknown or expired token is a graceful miss (normal
// text result), never an error — the assistant is never stranded.

import { CompressionCacheRepo } from "../../../repositories/compression-cache-repo";
import type { McpTool } from "../tool-types";
import { requireString } from "../tool-types";

export const retrieveTool: McpTool = {
  name: "mink_retrieve",
  title: "Retrieve compressed output",
  description:
    "Return the byte-exact original of a tool output that Mink previously " +
    "compressed, given its retrieval token (e.g. \"mc-1a2b3c4d\"). Use this " +
    "when a compressed result omitted content you now need. Returns a graceful " +
    "notice if the token is unknown or its retention window has elapsed.",
  inputSchema: {
    type: "object",
    properties: {
      token: {
        type: "string",
        description: "The retrieval token embedded in the compressed result.",
      },
    },
    required: ["token"],
    additionalProperties: false,
  },
  annotations: {
    title: "Retrieve compressed output",
    readOnlyHint: true,
    openWorldHint: false,
  },
  async handler(args, ctx) {
    const token = requireString(args, "token");

    let entry = null;
    try {
      entry = CompressionCacheRepo.for(ctx.cwd).get(token);
    } catch {
      // Treat any storage error as a miss — never throw at the assistant.
      entry = null;
    }

    if (!entry) {
      return `No retrievable output for token "${token}" (unknown or expired).`;
    }

    return entry.content;
  },
};
