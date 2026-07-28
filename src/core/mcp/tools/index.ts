// Tool registry — the single source of truth for which tools the MCP server
// exposes. buildToolRegistry() returns the ordered list; the protocol layer
// indexes it by name. Adding a capability means adding its module here and
// nowhere else (spec 24, delivered phase by phase).

import type { McpTool } from "../tool-types";
import { retrieveTool } from "./retrieve";
import { recallBugsTool } from "./recall-bugs";
import { searchWikiTool } from "./search-wiki";
import { fileSkeletonTool } from "./file-skeleton";
import { projectRulesTool } from "./project-rules";
import { captureNoteTool } from "./capture-note";
import { logBugTool } from "./log-bug";
import { contextPackTool } from "./context-pack";
import { similarTasksTool } from "./similar-tasks";

/** Assemble the full tool set. Order here is the order clients see in tools/list. */
export function buildToolRegistry(): McpTool[] {
  return [
    // Phase 1 — reversible-cache retrieval
    retrieveTool,
    // Phase 2 — read/pull tools
    recallBugsTool,
    searchWikiTool,
    fileSkeletonTool,
    projectRulesTool,
    // Phase 3 — write/capture tools (redacted before persistence)
    captureNoteTool,
    logBugTool,
    // Context pack (spec 26)
    contextPackTool,
    // Similar-task recall (spec 29)
    similarTasksTool,
  ];
}
