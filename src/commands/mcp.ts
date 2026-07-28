// `mink mcp` — run Mink as a Model Context Protocol server over stdio (spec 24).
//
// This is the "pull" surface: where the lifecycle hooks push context into the
// assistant, the MCP server lets any MCP-capable assistant pull exactly the
// context it needs, on demand, as tools. It speaks JSON-RPC 2.0 over
// newline-delimited stdio; stdout is reserved for protocol frames, so every
// diagnostic is written to stderr.
//
// Unlike Mink's one-shot hook commands, this process is long-lived. It must not
// exit on a per-request error, and it must checkpoint the SQLite WAL before
// exiting so a concurrent `mink sync` never stages a torn database.

import { McpServer } from "../core/mcp/server";
import { minkVersion } from "../core/version";
import { checkpointAndCloseAll } from "../storage/db";

const USAGE = `mink mcp — run Mink as a Model Context Protocol server (stdio)

Exposes this project's Mink state to any MCP-capable assistant as tools, so the
assistant can pull context on demand instead of only receiving it via hooks.

Speaks JSON-RPC 2.0 over newline-delimited stdio. stdout carries protocol
frames only; logs go to stderr.

Usage: mink mcp [--help]

Configure your MCP client to launch \`mink mcp\` with the cwd set to your
project root, so tools resolve against that project's Mink state.`;

export async function mcp(cwd: string, args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return;
  }

  const version = minkVersion();
  const server = new McpServer({
    cwd,
    serverInfo: { name: "mink", version },
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      checkpointAndCloseAll();
    } catch {
      // best effort — we're exiting anyway
    }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.stderr.write(`[mink mcp] ready (mink ${version}) — stdio transport, cwd=${cwd}\n`);

  try {
    await server.serve();
  } catch (err) {
    // A stdin transport error (e.g. a broken pipe) should end the server
    // cleanly, not surface as an unhandled rejection out of the CLI dispatcher.
    process.stderr.write(
      `[mink mcp] transport error: ${err instanceof Error ? err.message : String(err)}\n`
    );
  } finally {
    if (!shuttingDown) {
      try {
        checkpointAndCloseAll();
      } catch {
        // best effort
      }
    }
  }
}
