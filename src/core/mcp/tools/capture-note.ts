// Tool: mink_capture_note — capture a note into the cross-project vault over
// MCP (spec 24), the same path as `mink note`. Content is passed through the
// secret redactor before it touches disk (spec 28 seed), since captured notes
// may be synced to a git remote.

import { createNote } from "../../note-writer";
import { updateVaultIndexForFile } from "../../note-index";
import { updateMasterIndex } from "../../note-linker";
import { isVaultInitialized, isWikiEnabled, resolveVaultPath } from "../../vault";
import { redactSecrets } from "../../redact";
import type { NoteCategory } from "../../../types/note";
import type { McpTool } from "../tool-types";
import {
  ToolInputError,
  optionalString,
  optionalStringArray,
  requireString,
} from "../tool-types";

const CATEGORIES: NoteCategory[] = ["inbox", "projects", "areas", "resources", "archives"];

function deriveTitle(body: string): string {
  const first = body
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const base = first ?? "Untitled note";
  return base.length > 72 ? base.slice(0, 69).trimEnd() + "…" : base;
}

export const captureNoteTool: McpTool = {
  name: "mink_capture_note",
  title: "Capture a note",
  description:
    "Capture a note into the user's cross-project knowledge vault. The body is " +
    "required; the title is derived from the first line when omitted. Secret-" +
    "like values are redacted before the note is written.",
  inputSchema: {
    type: "object",
    properties: {
      body: { type: "string", description: "The note content (markdown)." },
      title: { type: "string", description: "Optional title; derived from the first line if omitted." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags." },
      category: {
        type: "string",
        description: "Vault category (default: inbox).",
        enum: CATEGORIES,
      },
    },
    required: ["body"],
    additionalProperties: false,
  },
  annotations: {
    title: "Capture a note",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
  },
  async handler(args) {
    if (!isWikiEnabled()) {
      return "The wiki is not enabled, so notes cannot be captured. Enable it with `mink config wiki.enabled true`.";
    }
    if (!isVaultInitialized()) {
      return "The wiki vault is not initialized. Run `mink wiki init` first.";
    }

    const body = requireString(args, "body");
    const titleArg = optionalString(args, "title");
    const tags = optionalStringArray(args, "tags") ?? [];

    const categoryArg = optionalString(args, "category");
    let category: NoteCategory = "inbox";
    if (categoryArg) {
      if (!CATEGORIES.includes(categoryArg as NoteCategory)) {
        throw new ToolInputError(
          `unknown category "${categoryArg}". Valid: ${CATEGORIES.join(", ")}`
        );
      }
      category = categoryArg as NoteCategory;
    }

    const safeBody = redactSecrets(body);
    const safeTitle = redactSecrets(titleArg ?? deriveTitle(body)).text;
    const redactions = safeBody.redactions;

    const now = new Date().toISOString();
    const result = createNote({
      title: safeTitle,
      category,
      tags,
      created: now,
      updated: now,
      body: safeBody.text,
    });
    const root = resolveVaultPath();
    updateVaultIndexForFile(result.filePath, result.content);
    updateMasterIndex(root);

    const rel = result.filePath.startsWith(root + "/")
      ? result.filePath.slice(root.length + 1)
      : result.filePath;
    const note = redactions > 0 ? ` (${redactions} secret-like value(s) redacted)` : "";
    return `Captured note "${safeTitle}" to ${rel}${note}.`;
  },
};
