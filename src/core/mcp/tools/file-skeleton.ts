// Tool: mink_file_skeleton — return a structural skeleton of a file (top-level
// declarations, signatures, exports, headings; bodies elided) so the assistant
// can grasp a file's shape without reading it in full (spec 24). Falls back to
// a one-line description when no structure is detectable. Read-only; a missing
// file is a graceful message, not an error.

import { readFileSync, statSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { extractCodeSkeleton } from "../../code-skeleton";
import { extractDescription } from "../../description";
import type { McpTool } from "../tool-types";
import { requireString } from "../tool-types";

const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdx"]);

export const fileSkeletonTool: McpTool = {
  name: "mink_file_skeleton",
  title: "File skeleton",
  description:
    "Return a structural skeleton of a file — its top-level declarations, " +
    "function/class signatures, exports, or headings, with bodies elided — so " +
    "you can understand a file's shape without reading it in full. Path is " +
    "resolved relative to the project root.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path, relative to the project root or absolute." },
    },
    required: ["path"],
    additionalProperties: false,
  },
  annotations: { title: "File skeleton", readOnlyHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const rel = requireString(args, "path");
    const abs = isAbsolute(rel) ? rel : join(ctx.cwd, rel);

    let content: string;
    try {
      const st = statSync(abs);
      if (st.isDirectory()) return `"${rel}" is a directory, not a file.`;
      content = readFileSync(abs, "utf-8");
    } catch {
      return `File not found: ${rel}`;
    }

    const markdown = MARKDOWN_EXT.has(extname(abs).toLowerCase());
    const skeleton = extractCodeSkeleton(content, { markdown });

    if (skeleton) {
      const header =
        `# skeleton: ${rel} — ${skeleton.totalLines} lines, ` +
        `${skeleton.lines.length} signature(s)`;
      return [header, "", ...skeleton.lines].join("\n");
    }

    // No structure detected — the one-line description is still useful.
    return `${rel}: ${extractDescription(abs, content)}`;
  },
};
