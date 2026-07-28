// MCP stdio transport for Mink (spec 24).
//
// A thin I/O shell around the pure protocol router. It frames the byte stream
// as newline-delimited JSON (one message per line, no embedded newlines — the
// MCP stdio contract), decodes each frame, hands it to the protocol, and writes
// the response back as its own line. stdout carries ONLY protocol frames; all
// diagnostics go to stderr so the channel stays clean.
//
// Design for testability: `handleLine` is a pure-ish single-frame entry point
// (parse → dispatch → serialize) usable directly in unit tests, and `serve`
// accepts injectable input/output so integration tests can drive it with an
// in-memory stream instead of a real process.
//
// Requests are processed sequentially in arrival order. A local server has a
// single client; serializing keeps responses ordered and avoids concurrent
// writes interleaving on the same DB connection, at negligible cost.

import type { Readable } from "node:stream";
import {
  JsonRpcErrorCode,
  makeError,
  parseJson,
  serialize,
} from "./jsonrpc";
import { McpProtocol, type ServerInfo } from "./protocol";
import type { McpTool, ToolContext } from "./tool-types";

// Guards against a client (or a corrupt pipe) sending an unbounded frame with
// no newline. Requests are tiny; 16 MiB is far above any legitimate call.
const MAX_FRAME_BYTES = 16 * 1024 * 1024;

export interface McpServerOptions {
  cwd: string;
  serverInfo: ServerInfo;
  tools?: McpTool[];
}

export interface ServeIo {
  input?: Readable;
  /** Write one already-serialized frame; the transport appends the newline. */
  write?: (line: string) => void;
}

export class McpServer {
  private readonly protocol: McpProtocol;

  constructor(opts: McpServerOptions) {
    const ctx: ToolContext = { cwd: opts.cwd };
    this.protocol = new McpProtocol(opts.serverInfo, ctx, opts.tools);
  }

  /**
   * Process a single frame. Returns the response frame to write, or null for
   * notifications / blank lines (nothing to send). Never throws.
   */
  async handleLine(line: string): Promise<string | null> {
    const trimmed = line.trim();
    if (trimmed.length === 0) return null;

    const parsed = parseJson(trimmed);
    if (!parsed.ok) {
      // Unparseable frame ⇒ id is unknowable ⇒ null per JSON-RPC.
      return serialize(
        makeError(null, JsonRpcErrorCode.PARSE_ERROR, parsed.error.message, parsed.error.data)
      );
    }

    // JSON-RPC batch (permitted by the 2024-11-05 revision we advertise): an
    // array of messages yields an array of responses, omitting notifications.
    // An empty batch is itself an invalid request.
    if (Array.isArray(parsed.value)) {
      if (parsed.value.length === 0) {
        return serialize(
          makeError(null, JsonRpcErrorCode.INVALID_REQUEST, "Invalid Request: empty batch")
        );
      }
      const responses = [];
      for (const item of parsed.value) {
        const r = await this.protocol.dispatch(item);
        if (r) responses.push(r);
      }
      return responses.length > 0 ? JSON.stringify(responses) : null;
    }

    const response = await this.protocol.dispatch(parsed.value);
    return response ? serialize(response) : null;
  }

  /**
   * Run the transport loop until the input stream ends. Resolves on end/close.
   * Rejects only on a stream `error` event.
   */
  serve(io: ServeIo = {}): Promise<void> {
    const input = io.input ?? process.stdin;
    const write = io.write ?? ((line: string) => void process.stdout.write(line + "\n"));

    // Some streams need an explicit encoding + resume to flow.
    input.setEncoding?.("utf8");

    let buffer = "";
    let chain: Promise<void> = Promise.resolve();
    let settled = false;

    return new Promise<void>((resolve, reject) => {
      const enqueue = (line: string) => {
        chain = chain
          .then(async () => {
            const out = await this.handleLine(line);
            if (out !== null) write(out);
          })
          .catch((err) => {
            // Keep the loop alive on a per-frame failure.
            process.stderr.write(
              `[mink mcp] frame processing error: ${err instanceof Error ? err.message : String(err)}\n`
            );
          });
      };

      const finish = () => {
        if (settled) return;
        settled = true;
        const tail = buffer;
        buffer = "";
        if (tail.trim().length > 0) enqueue(tail);
        chain.then(() => resolve()).catch(() => resolve());
      };

      input.on("data", (chunk: string | Buffer) => {
        buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

        // Drain complete frames first, so a large chunk carrying many valid
        // frames is never discarded.
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          enqueue(line);
        }

        // Only an unterminated partial remains; trip the guard only when that
        // single partial frame exceeds the cap.
        if (buffer.length > MAX_FRAME_BYTES) {
          buffer = "";
          write(
            serialize(
              makeError(null, JsonRpcErrorCode.PARSE_ERROR, "Frame exceeds maximum size")
            )
          );
        }
      });

      input.on("end", finish);
      input.on("close", finish);
      input.on("error", (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      input.resume?.();
    });
  }
}
