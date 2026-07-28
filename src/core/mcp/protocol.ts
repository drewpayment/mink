// MCP method router for Mink's server (spec 24).
//
// The protocol layer is deterministic and transport-agnostic: given a parsed
// JSON value (one message) it returns the JSON-RPC response to send, or null
// for notifications (which receive no reply). The only side effects it performs
// are the tool handler invocations it dispatches — everything else is pure,
// making the full method matrix unit-testable without spawning a process.
//
// Implemented surface (MCP 2025-06-18, back-compatible with 2024-11-05):
//   • initialize                 → capabilities + serverInfo, version negotiated
//   • notifications/initialized  → acknowledged silently (no reply)
//   • ping                       → {}
//   • tools/list                 → the tool registry as wire descriptors
//   • tools/call                 → invoke a tool, wrap result/error per MCP
//   • anything else              → METHOD_NOT_FOUND

import {
  JsonRpcErrorCode,
  asJsonRpcRequest,
  extractId,
  isNotification,
  makeError,
  makeResult,
  type JsonRpcResponse,
} from "./jsonrpc";
import {
  ToolInputError,
  asArgs,
  type McpTool,
  type ToolContext,
} from "./tool-types";
import { buildToolRegistry } from "./tools";

// Protocol versions this server understands, newest first. On initialize we
// echo the client's version when supported, else offer our latest.
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2024-11-05"] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export interface ServerInfo {
  name: string;
  version: string;
}

const INSTRUCTIONS =
  "Mink exposes this project's cross-session memory. Retrieve a compressed " +
  "tool output's original with mink_retrieve. (Additional recall and capture " +
  "tools are added in later phases.)";

export class McpProtocol {
  private readonly tools: Map<string, McpTool>;

  constructor(
    private readonly serverInfo: ServerInfo,
    private readonly ctx: ToolContext,
    tools: McpTool[] = buildToolRegistry()
  ) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  /**
   * Route one parsed message. Returns the response to send, or null when no
   * response is warranted (a notification). Never throws: internal failures
   * become INTERNAL_ERROR responses.
   */
  async dispatch(value: unknown): Promise<JsonRpcResponse | null> {
    const req = asJsonRpcRequest(value);
    if (!req) {
      return makeError(
        extractId(value),
        JsonRpcErrorCode.INVALID_REQUEST,
        "Invalid Request: not a well-formed JSON-RPC 2.0 message"
      );
    }

    const notification = isNotification(req);
    const id = notification ? null : (req.id as string | number | null);

    try {
      switch (req.method) {
        case "initialize":
          return notification ? null : makeResult(id, this.handleInitialize(req.params));

        case "notifications/initialized":
        case "notifications/cancelled":
          return null; // fire-and-forget lifecycle notifications

        case "ping":
          return notification ? null : makeResult(id, {});

        case "tools/list":
          return notification ? null : makeResult(id, { tools: this.toolDescriptors() });

        case "tools/call":
          if (notification) return null;
          return await this.handleToolsCall(id, req.params);

        default:
          if (notification) return null; // unknown notifications are ignored
          return makeError(
            id,
            JsonRpcErrorCode.METHOD_NOT_FOUND,
            `Method not found: ${req.method}`
          );
      }
    } catch (err) {
      if (notification) return null;
      return makeError(
        id,
        JsonRpcErrorCode.INTERNAL_ERROR,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  private handleInitialize(params: unknown): unknown {
    const requested =
      params && typeof params === "object" && !Array.isArray(params)
        ? (params as Record<string, unknown>).protocolVersion
        : undefined;
    const protocolVersion =
      typeof requested === "string" &&
      (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
        ? requested
        : LATEST_PROTOCOL_VERSION;

    return {
      protocolVersion,
      capabilities: { tools: { listChanged: false } },
      serverInfo: this.serverInfo,
      instructions: INSTRUCTIONS,
    };
  }

  private toolDescriptors() {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    }));
  }

  private async handleToolsCall(
    id: string | number | null,
    params: unknown
  ): Promise<JsonRpcResponse> {
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return makeError(
        id,
        JsonRpcErrorCode.INVALID_PARAMS,
        "Invalid params: expected an object with a tool name"
      );
    }
    const name = (params as Record<string, unknown>).name;
    if (typeof name !== "string") {
      return makeError(id, JsonRpcErrorCode.INVALID_PARAMS, "Invalid params: missing tool name");
    }
    const tool = this.tools.get(name);
    if (!tool) {
      return makeError(id, JsonRpcErrorCode.INVALID_PARAMS, `Unknown tool: ${name}`);
    }

    let args: Record<string, unknown>;
    try {
      args = asArgs((params as Record<string, unknown>).arguments);
    } catch (err) {
      return makeError(
        id,
        JsonRpcErrorCode.INVALID_PARAMS,
        err instanceof Error ? err.message : String(err)
      );
    }

    try {
      const text = await tool.handler(args, this.ctx);
      return makeResult(id, {
        content: [{ type: "text", text }],
        isError: false,
      });
    } catch (err) {
      // A malformed call is a protocol-level INVALID_PARAMS; a genuine tool
      // failure becomes an isError result so the model can read and adapt.
      if (err instanceof ToolInputError) {
        return makeError(id, JsonRpcErrorCode.INVALID_PARAMS, err.message);
      }
      return makeResult(id, {
        content: [
          { type: "text", text: err instanceof Error ? err.message : String(err) },
        ],
        isError: true,
      });
    }
  }
}
