// Tool registry — the single source of truth for which tools the MCP server
// exposes. buildToolRegistry() returns the ordered list; the protocol layer
// indexes it by name. Adding a capability means adding its module here and
// nowhere else (spec 24, delivered phase by phase).

import type { McpTool } from "../tool-types";
import { retrieveTool } from "./retrieve";

/** Assemble the full tool set. Order here is the order clients see in tools/list. */
export function buildToolRegistry(): McpTool[] {
  return [
    // Phase 1 — reversible-cache retrieval
    retrieveTool,
  ];
}
