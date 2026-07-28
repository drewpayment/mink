// JSON-RPC 2.0 primitives for Mink's MCP server (spec 24).
//
// This module is intentionally pure and dependency-free: it knows how to parse
// a single JSON-RPC frame, classify it, and construct well-formed success and
// error responses. It performs NO I/O and holds NO state, so it is exhaustively
// unit-testable in isolation. The transport (server.ts) and the method router
// (protocol.ts) build on top of it.
//
// The MCP stdio transport frames messages as newline-delimited JSON — one
// complete JSON value per line, with no embedded newlines. Framing lives in
// server.ts; this module operates on a single already-delimited string.

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId; // absent ⇒ notification (no response is emitted)
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcErrorResponse;

// Standard JSON-RPC 2.0 error codes. Application-specific codes (if ever needed)
// must live outside the reserved -32768..-32000 range.
export const JsonRpcErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

export type ParseOutcome =
  | { ok: true; value: unknown }
  | { ok: false; error: JsonRpcErrorObject };

/**
 * Parse a single frame's text into a JSON value. Never throws: a malformed
 * frame yields a structured PARSE_ERROR outcome so the caller can respond
 * gracefully instead of crashing the server loop.
 */
export function parseJson(line: string): ParseOutcome {
  try {
    return { ok: true, value: JSON.parse(line) };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: JsonRpcErrorCode.PARSE_ERROR,
        message: "Parse error: invalid JSON",
        data: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/** A JSON-RPC id must be a string, number, or null (JSON-RPC 2.0 §4). */
export function isValidId(id: unknown): id is JsonRpcId {
  return typeof id === "string" || typeof id === "number" || id === null;
}

/**
 * Structural validation of a parsed value as a JSON-RPC request/notification.
 * Returns the narrowed request on success, or null if the shape is invalid.
 */
export function asJsonRpcRequest(value: unknown): JsonRpcRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  if (obj.jsonrpc !== "2.0") return null;
  if (typeof obj.method !== "string") return null;
  if ("id" in obj && !isValidId(obj.id)) return null;
  return obj as unknown as JsonRpcRequest;
}

/** A request with no `id` field is a notification: it receives no response. */
export function isNotification(req: JsonRpcRequest): boolean {
  return !("id" in req) || req.id === undefined;
}

/**
 * Best-effort id extraction for error responses to malformed input. Per the
 * JSON-RPC spec, if the id cannot be determined it must be null.
 */
export function extractId(value: unknown): JsonRpcId {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const id = (value as Record<string, unknown>).id;
    if (isValidId(id)) return id;
  }
  return null;
}

export function makeResult(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id, result };
}

export function makeError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcErrorResponse {
  const error: JsonRpcErrorObject = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: "2.0", id, error };
}

/** Serialize a response to a single-line frame (no embedded newlines). */
export function serialize(msg: JsonRpcResponse): string {
  return JSON.stringify(msg);
}
