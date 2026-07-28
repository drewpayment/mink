// Tool contracts for Mink's MCP server (spec 24).
//
// A tool is a declarative record: its wire-facing metadata (name, description,
// JSON Schema for arguments, behavioural annotations) plus an async handler.
// Handlers receive validated-at-the-edges arguments and a ToolContext carrying
// the resolved project working directory, and return the human/agent-readable
// text that becomes the tool result's content.
//
// Two error channels, deliberately distinct:
//   • ToolInputError  → the CALL was malformed (missing/mistyped argument).
//     The protocol maps this to a JSON-RPC INVALID_PARAMS (-32602) error.
//   • McpToolError    → the tool RAN and failed (storage error, etc.).
//     The protocol maps this to a tools/call result with isError: true, so the
//     model sees the message and can adapt rather than the session erroring out.
// A normal "nothing found / graceful miss" is NOT an error — return descriptive
// text with no throw (mirrors `mink retrieve`'s treatment of an expired token).

export interface ToolContext {
  /** Working directory whose project slice the tool operates on. */
  cwd: string;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * MCP tool behavioural hints (2025-06-18 `ToolAnnotations`). Advisory only —
 * they help a host reason about a tool without changing protocol semantics.
 */
export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  /** Human-facing display title (distinct from the programmatic `name`). */
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

/** Malformed call — the arguments did not satisfy the tool's contract. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

/** The tool executed and failed. Surfaced to the model as isError: true. */
export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

/** Coerce the params bag into a plain object, rejecting arrays/primitives. */
export function asArgs(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) return {};
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new ToolInputError("arguments must be an object");
  }
  return params as Record<string, unknown>;
}

export function requireString(
  args: Record<string, unknown>,
  key: string
): string {
  const v = args[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new ToolInputError(`missing or empty required string argument: "${key}"`);
  }
  return v;
}

export function optionalString(
  args: Record<string, unknown>,
  key: string
): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") {
    throw new ToolInputError(`argument "${key}" must be a string`);
  }
  return v;
}

export function optionalStringArray(
  args: Record<string, unknown>,
  key: string
): string[] | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new ToolInputError(`argument "${key}" must be an array of strings`);
  }
  return v as string[];
}

export function optionalPositiveInt(
  args: Record<string, unknown>,
  key: string
): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) {
    throw new ToolInputError(`argument "${key}" must be a positive integer`);
  }
  return v;
}
