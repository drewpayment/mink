// Tool: mink_file_skeleton — return a structural skeleton of a file (top-level
// declarations, signatures, exports, headings; bodies elided) so the assistant
// can grasp a file's shape without reading it in full (spec 24). Falls back to
// a one-line description when no structure is detectable. Read-only; a missing
// file is a graceful message, not an error.

import { readFileSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { extractCodeSkeleton } from "../../code-skeleton";
import { extractDescription } from "../../description";
import { redactSecrets } from "../../redact";
import type { McpTool } from "../tool-types";
import { requireString } from "../tool-types";

const MARKDOWN_EXT = new Set([".md", ".markdown", ".mdx"]);

// Cap the read: the tool exists to avoid consuming whole files, and the server
// is long-lived, so never buffer an arbitrarily large file into memory.
const MAX_SKELETON_BYTES = 2 * 1024 * 1024; // 2 MiB

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
    const root = resolve(ctx.cwd);
    // resolve() collapses `..` and returns an absolute path as-is, so this
    // catches both traversal (`../../etc/passwd`) and absolute paths outside
    // the project. Confine reads to the project root — this tool must not be a
    // general file-read primitive for the assistant.
    const abs = resolve(root, rel);
    if (abs !== root && !abs.startsWith(root + sep)) {
      return `Refusing to read "${rel}": outside the project root.`;
    }

    let content: string;
    try {
      const st = statSync(abs);
      if (st.isDirectory()) return `"${rel}" is a directory, not a file.`;
      if (st.size > MAX_SKELETON_BYTES) {
        return `File too large to skeletonize: ${rel} (${st.size} bytes, limit ${MAX_SKELETON_BYTES}).`;
      }
      content = readFileSync(abs, "utf-8");
    } catch {
      return `File not found: ${rel}`;
    }

    const markdown = MARKDOWN_EXT.has(extname(abs).toLowerCase());
    const skeleton = extractCodeSkeleton(content, { markdown });

    // Redact defensively: even an in-project file (e.g. a committed .env) can
    // carry secrets, and read tools otherwise apply no redaction.
    if (skeleton) {
      const header =
        `# skeleton: ${rel} — ${skeleton.totalLines} lines, ` +
        `${skeleton.lines.length} signature(s)`;
      return redactSecrets([header, "", ...skeleton.lines].join("\n")).text;
    }

    // No structure detected — the one-line description is still useful.
    return redactSecrets(`${rel}: ${extractDescription(abs, content)}`).text;
  },
};
