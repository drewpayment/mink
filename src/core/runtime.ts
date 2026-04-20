/**
 * Cross-runtime utilities — Bun-first with Node.js fallbacks.
 *
 * Detects the runtime once at import time and exports helpers that
 * abstract over Bun.serve / node:http, Bun.file / fs, and Bun.spawn / child_process.
 */

import { readFile, stat } from "fs/promises";
import { spawn as nodeSpawn } from "child_process";

export const isBun = typeof globalThis.Bun !== "undefined";

// ── File helpers ──────────────────────────────────────────────────────────

export interface RuntimeFile {
  exists(): Promise<boolean>;
  bytes(): Promise<Uint8Array>;
}

/**
 * Returns a lightweight file handle with `.exists()` and `.bytes()`.
 * Uses Bun.file when available, otherwise falls back to fs.
 */
export function runtimeFile(path: string): RuntimeFile {
  if (isBun) {
    const f = Bun.file(path);
    return {
      exists: () => f.exists(),
      bytes: () => f.arrayBuffer().then((ab) => new Uint8Array(ab)),
    };
  }
  return {
    async exists() {
      try {
        await stat(path);
        return true;
      } catch {
        return false;
      }
    },
    async bytes() {
      return readFile(path);
    },
  };
}

// ── Spawn helper ──────────────────────────────────────────────────────────

export type SpawnStdio = "ignore" | "pipe" | number;

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdout?: SpawnStdio;
  stderr?: SpawnStdio;
  stdin?: "ignore";
}

export interface SpawnedProcess {
  pid: number;
  unref(): void;
}

/**
 * Fire-and-forget process spawning. Uses Bun.spawn when available,
 * otherwise child_process.spawn with detached + unref.
 */
export function runtimeSpawn(
  cmd: string[],
  opts: SpawnOptions = {}
): SpawnedProcess {
  if (isBun) {
    const proc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env,
      stdout: opts.stdout ?? "ignore",
      stderr: opts.stderr ?? "ignore",
      stdin: opts.stdin ?? "ignore",
    });
    return { pid: proc.pid, unref: () => proc.unref() };
  }

  const [bin, ...args] = cmd;
  const proc = nodeSpawn(bin, args, {
    cwd: opts.cwd,
    env: opts.env as NodeJS.ProcessEnv,
    stdio: [
      opts.stdin ?? "ignore",
      opts.stdout ?? "ignore",
      opts.stderr ?? "ignore",
    ],
    detached: true,
  });
  proc.unref();
  return { pid: proc.pid ?? -1, unref: () => {} };
}

// ── HTTP Server ───────────────────────────────────────────────────────────

export interface RuntimeServer {
  port: number;
  stop(closeConnections?: boolean): void;
}

type FetchHandler = (req: Request) => Response | Promise<Response>;

interface ServeOptions {
  port: number;
  hostname: string;
  idleTimeout?: number;
  fetch: FetchHandler;
}

/**
 * Start an HTTP server using Bun.serve or node:http.
 * The fetch handler uses standard Web API Request/Response in both runtimes.
 */
export async function runtimeServe(opts: ServeOptions): Promise<RuntimeServer> {
  if (isBun) {
    const server = Bun.serve({
      port: opts.port,
      hostname: opts.hostname,
      idleTimeout: opts.idleTimeout ?? 0,
      fetch: opts.fetch,
    });
    return {
      port: server.port as number,
      stop: (close) => server.stop(close),
    };
  }

  // Node.js fallback using node:http
  const { createServer } = await import("node:http");
  const { Readable } = await import("node:stream");

  return new Promise<RuntimeServer>((resolve) => {
    const httpServer = createServer(async (req, res) => {
      // Build a Web API Request from the Node IncomingMessage
      const url = `http://${opts.hostname}:${opts.port}${req.url ?? "/"}`;
      const headers = new Headers();
      for (const [key, val] of Object.entries(req.headers)) {
        if (val) headers.set(key, Array.isArray(val) ? val.join(", ") : val);
      }

      let body: BodyInit | null = null;
      if (req.method !== "GET" && req.method !== "HEAD") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        body = Buffer.concat(chunks);
      }

      const request = new Request(url, {
        method: req.method,
        headers,
        body,
        // @ts-expect-error -- Node 18+ supports duplex on Request
        duplex: body ? "half" : undefined,
      });

      try {
        const response = await opts.fetch(request);

        res.writeHead(response.status, Object.fromEntries(response.headers));

        if (!response.body) {
          res.end();
          return;
        }

        // Stream the response body
        const reader = response.body.getReader();
        const nodeStream = new Readable({
          async read() {
            try {
              const { done, value } = await reader.read();
              if (done) {
                this.push(null);
              } else {
                this.push(Buffer.from(value));
              }
            } catch {
              this.push(null);
            }
          },
        });

        // Clean up SSE streams when client disconnects
        res.on("close", () => {
          reader.cancel().catch(() => {});
          nodeStream.destroy();
        });

        nodeStream.pipe(res);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(String(err));
        }
      }
    });

    httpServer.listen(opts.port, opts.hostname, () => {
      const addr = httpServer.address();
      const boundPort =
        typeof addr === "object" && addr ? addr.port : opts.port;
      resolve({
        port: boundPort,
        stop: (close) => {
          if (close) httpServer.closeAllConnections();
          httpServer.close();
        },
      });
    });
  });
}
