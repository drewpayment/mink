import { watch, type FSWatcher } from "fs";
import { existsSync } from "fs";
import { basename, join, extname } from "path";
import { projectDir, designCapturesDir } from "./paths";
import {
  loadOverview,
  loadTokenLedgerPanel,
  loadFileIndexPanel,
  loadSchedulerPanel,
  loadLearningMemoryPanel,
  loadActionLogPanel,
  loadBugLogPanel,
  loadDesignPanel,
  triggerTask,
  triggerDeadLetterRetry,
  triggerRescan,
} from "./dashboard-api";
import type { StateFileId, StateChangeEvent } from "../types/dashboard";

// ── MIME types for static file serving ────────────────────────────────────
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

// ── State File Mapping ─────────────────────────────────────────────────────

const STATE_FILE_MAP: Record<string, StateFileId> = {
  "token-ledger.json": "token-ledger",
  "file-index.json": "file-index",
  "learning-memory.md": "learning-memory",
  "bug-memory.json": "bug-memory",
  "action-log.md": "action-log",
  "scheduler-manifest.json": "scheduler-manifest",
  "session.json": "session",
  "project-meta.json": "project-meta",
  "design-report.json": "design-report",
};

// ── SSE Manager ────────────────────────────────────────────────────────────

interface SSEClient {
  id: string;
  controller: ReadableStreamController<Uint8Array>;
}

const encoder = new TextEncoder();

class SSEManager {
  private clients = new Map<string, SSEClient>();
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.keepAliveInterval = setInterval(() => {
      this.sendRaw(": keepalive\n\n");
    }, 30_000);
  }

  stop(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    for (const [id] of this.clients) {
      this.removeClient(id);
    }
  }

  addClient(id: string, controller: ReadableStreamController<Uint8Array>): void {
    this.clients.set(id, { id, controller });
  }

  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      try {
        client.controller.close();
      } catch {
        // Already closed
      }
      this.clients.delete(id);
    }
  }

  broadcast(event: StateChangeEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    this.sendRaw(data);
  }

  private sendRaw(data: string): void {
    const bytes = encoder.encode(data);
    const deadClients: string[] = [];

    for (const [id, client] of this.clients) {
      try {
        client.controller.enqueue(bytes);
      } catch {
        deadClients.push(id);
      }
    }

    for (const id of deadClients) {
      this.clients.delete(id);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }
}

// ── File Watcher ───────────────────────────────────────────────────────────

function createFileWatcher(
  cwd: string,
  onChange: (fileId: StateFileId) => void
): { close(): void } {
  const dir = projectDir(cwd);
  const debounceMap = new Map<string, ReturnType<typeof setTimeout>>();
  let watcher: FSWatcher | null = null;

  try {
    watcher = watch(dir, (eventType, filename) => {
      if (!filename) return;
      const name = basename(filename);

      // Ignore .tmp files from atomic writes
      if (name.endsWith(".tmp")) return;

      const fileId = STATE_FILE_MAP[name];
      if (!fileId) return;

      // Debounce 300ms per file
      const existing = debounceMap.get(name);
      if (existing) clearTimeout(existing);

      debounceMap.set(
        name,
        setTimeout(() => {
          debounceMap.delete(name);
          onChange(fileId);
        }, 300)
      );
    });
  } catch {
    // fs.watch not available — fallback could go here
    // For now, the dashboard still works via manual refresh
  }

  return {
    close() {
      if (watcher) {
        watcher.close();
        watcher = null;
      }
      for (const timer of debounceMap.values()) {
        clearTimeout(timer);
      }
      debounceMap.clear();
    },
  };
}

// ── Route Handling ─────────────────────────────────────────────────────────

function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function extractPathParam(pathname: string, prefix: string): string | null {
  if (!pathname.startsWith(prefix)) return null;
  const rest = pathname.slice(prefix.length);
  const slashIdx = rest.indexOf("/");
  if (slashIdx === -1) return rest || null;
  return rest.slice(0, slashIdx) || null;
}

// ── Server ─────────────────────────────────────────────────────────────────

export interface DashboardServer {
  url: string;
  close(): void;
}

export function startDashboardServer(
  cwd: string,
  options: { port?: number; hostname?: string; open?: boolean } = {}
): DashboardServer {
  const port = options.port ?? 4040;
  const hostname = options.hostname ?? "127.0.0.1";

  const sseManager = new SSEManager();
  sseManager.start();

  // Start file watcher
  const fileWatcher = createFileWatcher(cwd, (fileId) => {
    sseManager.broadcast({
      fileId,
      timestamp: new Date().toISOString(),
    });
  });

  // Resolve the Next.js static build directory
  const dashboardOutDir = join(
    import.meta.dir,
    "..",
    "..",
    "dashboard",
    "out"
  );
  const dashboardBuilt = existsSync(join(dashboardOutDir, "index.html"));
  let clientIdCounter = 0;

  if (!dashboardBuilt) {
    console.warn(
      "[mink] dashboard not built. Run: cd dashboard && bun run build"
    );
  }

  const server = Bun.serve({
    port,
    hostname,
    async fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;
      const method = req.method;

      // ── Static file serving (Next.js build) ─────────────────────
      if (method === "GET" && !pathname.startsWith("/api/")) {
        if (!dashboardBuilt) {
          if (pathname === "/") {
            return new Response(
              "<html><body><h1>Mink Dashboard</h1><p>Dashboard not built. Run: <code>cd dashboard &amp;&amp; bun run build</code></p></body></html>",
              { headers: { "Content-Type": "text/html; charset=utf-8" } }
            );
          }
        } else {
          // Serve from dashboard/out/
          let filePath: string;
          if (pathname === "/") {
            filePath = join(dashboardOutDir, "index.html");
          } else {
            filePath = join(dashboardOutDir, pathname);
          }

          // Security: prevent directory traversal
          if (!filePath.startsWith(dashboardOutDir)) {
            return jsonResponse({ error: "Forbidden" }, 403);
          }

          const file = Bun.file(filePath);
          if (await file.exists()) {
            const ext = extname(filePath);
            const contentType = MIME_TYPES[ext] || "application/octet-stream";
            return new Response(file, {
              headers: { "Content-Type": contentType },
            });
          }

          // Client-side routing fallback: try {pathname}.html then index.html
          const htmlFile = Bun.file(filePath + ".html");
          if (await htmlFile.exists()) {
            return new Response(htmlFile, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }

          // SPA fallback — serve index.html for unmatched routes
          const indexFile = Bun.file(join(dashboardOutDir, "index.html"));
          if (await indexFile.exists()) {
            return new Response(indexFile, {
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          }
        }
      }

      // ── SSE ──────────────────────────────────────────────────────
      if (method === "GET" && pathname === "/api/events") {
        const clientId = String(++clientIdCounter);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            sseManager.addClient(clientId, controller);
          },
          cancel() {
            sseManager.removeClient(clientId);
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // ── REST API (GET) ───────────────────────────────────────────
      if (method === "GET") {
        try {
          switch (pathname) {
            case "/api/overview":
              return jsonResponse(loadOverview(cwd));
            case "/api/token-ledger":
              return jsonResponse(loadTokenLedgerPanel(cwd));
            case "/api/file-index":
              return jsonResponse(loadFileIndexPanel(cwd));
            case "/api/scheduler":
              return jsonResponse(loadSchedulerPanel(cwd));
            case "/api/learning-memory":
              return jsonResponse(loadLearningMemoryPanel(cwd));
            case "/api/action-log":
              return jsonResponse(loadActionLogPanel(cwd));
            case "/api/bugs":
              return jsonResponse(loadBugLogPanel(cwd));
            case "/api/design":
              return jsonResponse(loadDesignPanel(cwd));
          }

          // GET /api/design-images/:filename — serve captured screenshots
          if (pathname.startsWith("/api/design-images/")) {
            const filename = pathname.slice("/api/design-images/".length);
            if (!filename || filename.includes("..") || filename.includes("/")) {
              return jsonResponse({ error: "Invalid filename" }, 400);
            }
            const imgPath = join(designCapturesDir(cwd), filename);
            const file = Bun.file(imgPath);
            if (await file.exists()) {
              return new Response(file, {
                headers: {
                  "Content-Type": "image/jpeg",
                  "Cache-Control": "public, max-age=60",
                  "Access-Control-Allow-Origin": "*",
                },
              });
            }
            return jsonResponse({ error: "Image not found" }, 404);
          }
        } catch (err) {
          return jsonResponse(
            { error: err instanceof Error ? err.message : String(err) },
            500
          );
        }
      }

      // ── REST API (POST) ──────────────────────────────────────────
      if (method === "POST") {
        // POST /api/tasks/:id/run
        if (pathname.startsWith("/api/tasks/") && pathname.endsWith("/run")) {
          const taskId = extractPathParam(pathname, "/api/tasks/");
          const cleanId = taskId?.replace(/\/run$/, "") ?? "";
          if (!cleanId) {
            return jsonResponse({ success: false, error: "Missing task ID" }, 400);
          }
          return triggerTask(cwd, cleanId).then((result) =>
            jsonResponse(result, result.success ? 200 : 500)
          );
        }

        // POST /api/dead-letter/:id/retry
        if (
          pathname.startsWith("/api/dead-letter/") &&
          pathname.endsWith("/retry")
        ) {
          const taskId = extractPathParam(pathname, "/api/dead-letter/");
          const cleanId = taskId?.replace(/\/retry$/, "") ?? "";
          if (!cleanId) {
            return jsonResponse({ success: false, error: "Missing task ID" }, 400);
          }
          return triggerDeadLetterRetry(cwd, cleanId).then((result) =>
            jsonResponse(result, result.success ? 200 : 500)
          );
        }

        // POST /api/rescan
        if (pathname === "/api/rescan") {
          return triggerRescan(cwd).then((result) =>
            jsonResponse(result, result.success ? 200 : 500)
          );
        }
      }

      // ── CORS Preflight ───────────────────────────────────────────
      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        });
      }

      // ── 404 ──────────────────────────────────────────────────────
      return jsonResponse({ error: "Not found" }, 404);
    },
  });

  const serverUrl = `http://${hostname}:${server.port}`;

  // Auto-open browser
  if (options.open !== false) {
    try {
      const platform = process.platform;
      const cmd =
        platform === "darwin"
          ? ["open", serverUrl]
          : platform === "win32"
            ? ["cmd", "/c", "start", serverUrl]
            : ["xdg-open", serverUrl];
      const proc = Bun.spawn(cmd, {
        stdout: "ignore",
        stderr: "ignore",
        stdin: "ignore",
      });
      proc.unref();
    } catch {
      // Browser open is best-effort
    }
  }

  return {
    url: serverUrl,
    close() {
      sseManager.stop();
      fileWatcher.close();
      server.stop(true);
    },
  };
}
