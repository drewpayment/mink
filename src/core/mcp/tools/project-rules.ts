// Tool: mink_project_rules — return the project's learned rules (user
// preferences, key learnings, do-not-repeat items, decision log) accumulated
// across sessions (spec 24). Backed by the merged learning memory. Consult
// before generating code so past corrections are respected.

import { aggregateLearningMemory } from "../../state-aggregator";
import { totalEntryCount } from "../../learning-memory";
import type { SectionName } from "../../../types/learning-memory";
import type { McpTool } from "../tool-types";
import { ToolInputError, optionalString } from "../tool-types";

const SECTIONS: SectionName[] = [
  "User Preferences",
  "Key Learnings",
  "Do-Not-Repeat",
  "Decision Log",
];

export const projectRulesTool: McpTool = {
  name: "mink_project_rules",
  title: "Project rules & learnings",
  description:
    "Return this project's learned rules — user preferences, key learnings, " +
    "do-not-repeat items, and the decision log — accumulated across sessions. " +
    "Consult before generating code so prior corrections are respected. " +
    "Optionally restrict to a single section.",
  inputSchema: {
    type: "object",
    properties: {
      section: {
        type: "string",
        description: "Optional section filter.",
        enum: SECTIONS,
      },
    },
    additionalProperties: false,
  },
  annotations: { title: "Project rules & learnings", readOnlyHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const section = optionalString(args, "section");
    const memory = aggregateLearningMemory(ctx.cwd);

    if (totalEntryCount(memory) === 0) {
      return "No learned rules recorded for this project yet.";
    }

    let wanted: SectionName[] = SECTIONS;
    if (section) {
      wanted = SECTIONS.filter((s) => s.toLowerCase() === section.toLowerCase());
      if (wanted.length === 0) {
        throw new ToolInputError(
          `unknown section "${section}". Valid: ${SECTIONS.join(", ")}`
        );
      }
    }

    const parts: string[] = [];
    for (const s of wanted) {
      const entries = memory.sections[s] ?? [];
      if (entries.length === 0) continue;
      parts.push(`## ${s}`);
      for (const entry of entries) parts.push(`- ${entry}`);
      parts.push("");
    }

    return parts.length > 0
      ? parts.join("\n").trimEnd()
      : "No entries in the requested section.";
  },
};
