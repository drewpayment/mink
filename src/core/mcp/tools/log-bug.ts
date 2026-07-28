// Tool: mink_log_bug — record a bug (error, root cause, fix) into the project's
// bug memory over MCP (spec 24). Re-logging the same (error, file) bumps the
// occurrence count rather than duplicating. Text fields pass through the secret
// redactor before persistence (spec 28 seed).

import { BugMemoryRepo } from "../../../repositories/bug-memory-repo";
import { redactSecrets } from "../../redact";
import type { McpTool } from "../tool-types";
import {
  optionalPositiveInt,
  optionalStringArray,
  requireString,
} from "../tool-types";

export const logBugTool: McpTool = {
  name: "mink_log_bug",
  title: "Log a bug",
  description:
    "Record a bug in this project's bug memory: the error, the file it occurred " +
    "in, its root cause, and the fix. Re-logging the same error in the same " +
    "file increments its occurrence count instead of duplicating. Secret-like " +
    "values are redacted before storage.",
  inputSchema: {
    type: "object",
    properties: {
      error: { type: "string", description: "The error message or symptom." },
      file: { type: "string", description: "Repo-relative file path where it occurred." },
      rootCause: { type: "string", description: "Why it happened." },
      fix: { type: "string", description: "How it was fixed." },
      line: { type: "number", description: "Optional line number." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags." },
    },
    required: ["error", "file", "rootCause", "fix"],
    additionalProperties: false,
  },
  annotations: {
    title: "Log a bug",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
  },
  async handler(args, ctx) {
    const errorMessage = redactSecrets(requireString(args, "error")).text;
    const filePath = requireString(args, "file");
    const rootCause = redactSecrets(requireString(args, "rootCause")).text;
    const fixDescription = redactSecrets(requireString(args, "fix")).text;
    const lineNumber = optionalPositiveInt(args, "line");
    const tags = optionalStringArray(args, "tags") ?? [];

    const repo = BugMemoryRepo.for(ctx.cwd);
    const existing = repo.findDuplicate(errorMessage, filePath);
    const entry = repo.add({
      errorMessage,
      filePath,
      lineNumber,
      rootCause,
      fixDescription,
      tags,
      relatedBugIds: [],
    });

    const where = lineNumber ? `${filePath}:${lineNumber}` : filePath;
    const verb = existing ? `updated (occurrence ${entry.occurrenceCount})` : "logged";
    return `Bug ${verb} as ${entry.id}: ${errorMessage} @ ${where}`;
  },
};
