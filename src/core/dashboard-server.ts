import { watch, type FSWatcher } from "fs";
import { basename } from "path";
import { projectDir } from "./paths";
import {
  loadOverview,
  loadTokenLedgerPanel,
  loadFileIndexPanel,
  loadSchedulerPanel,
  loadLearningMemoryPanel,
  loadActionLogPanel,
  loadBugLogPanel,
  triggerTask,
  triggerDeadLetterRetry,
  triggerRescan,
} from "./dashboard-api";
import { getDashboardHtml } from "./dashboard/get-dashboard-html";
import type { StateFileId, StateChangeEvent } from "../types/dashboard";

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

  // Cache the HTML
  const html = getDashboardHtml();
  let clientIdCounter = 0;

  const server = Bun.serve({
    port,
    hostname,
    fetch(req) {
      const url = new URL(req.url);
      const pathname = url.pathname;
      const method = req.method;

      // ── Static ───────────────────────────────────────────────────
      if (method === "GET" && pathname === "/") {
        return new Response(html, {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
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
