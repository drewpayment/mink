import { watch, type FSWatcher } from "fs";
import { existsSync } from "fs";
import { basename, dirname, join, extname } from "path";
import { projectDir, designCapturesDir } from "./paths";
import {
  loadOverview,
  loadTokenLedgerPanel,
  loadCompressionPanel,
  loadFileIndexPanel,
  loadSchedulerPanel,
  loadLearningMemoryPanel,
  loadActionLogPanel,
  loadBugLogPanel,
  loadDesignPanel,
  triggerTask,
  triggerDeadLetterRetry,
  triggerRescan,
  triggerDaemonStart,
  triggerDaemonStop,
  triggerDaemonRestart,
  loadConfigPanel,
  triggerConfigSet,
  triggerConfigReset,
  loadSyncPanel,
  triggerSyncPull,
  triggerSyncPush,
  triggerSyncDisconnect,
  loadChannelPanel,
  triggerChannelStart,
  triggerChannelStop,
  triggerChannelRestart,
  loadWikiPanel,
  loadWikiNote,
  triggerCreateNote,
  triggerAppendDaily,
  triggerIngestFile,
} from "./dashboard-api";
import { listRegisteredProjects, getProjectMeta } from "./project-registry";
import { projectIdFor } from "./project-id";
import { runtimeFile, runtimeServe, runtimeSpawn } from "./runtime";
import type { StateFileId, StateChangeEvent } from "../types/dashboard";
import type { RegisteredProject } from "./project-registry";

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
    }, 15_000);
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

// ── Project Resolution ────────────────────────────────────────────────────

function resolveProjectCwd(
  url: URL,
  defaultCwd: string
): string | null {
  const projectId = url.searchParams.get("project");
  if (!projectId) return defaultCwd;

  // If the requested project matches the currently active project, use it directly
  // (handles startup projects that may not be in the registry yet)
  if (projectId === projectIdFor(defaultCwd)) return defaultCwd;

  const projects = listRegisteredProjects();
  // Match against primary id first, then walk alias lists so historical
  // dashboard URLs continue routing after a v3 identity migration.
  const match =
    projects.find((p) => p.id === projectId) ??
    projects.find((p) => p.aliases.includes(projectId));
  if (!match) return null;

  return match.cwd;
}

function getProjectsList(
  startupCwd: string,
  activeCwd: string
): {
  projects: RegisteredProject[];
  activeProjectId: string;
} {
  const activeId = projectIdFor(activeCwd);
  const registered = listRegisteredProjects();

  // Ensure startup project is always in the list
  const startupId = projectIdFor(startupCwd);
  const hasStartup = registered.some((p) => p.id === startupId);
  if (!hasStartup) {
    const meta = getProjectMeta(projectDir(startupCwd));
    registered.unshift({
      id: startupId,
      cwd: startupCwd,
      name: meta?.name ?? basename(startupCwd),
      version: meta?.version ?? "0.1.0",
      aliases: meta?.aliases ?? [],
      pathsByDevice: meta?.pathsByDevice ?? {},
    });
  }

  // Ensure active project is in the list (if different from startup)
  if (activeId !== startupId) {
    const hasActive = registered.some((p) => p.id === activeId);
    if (!hasActive) {
      const meta = getProjectMeta(projectDir(activeCwd));
      registered.unshift({
        id: activeId,
        cwd: activeCwd,
        name: meta?.name ?? basename(activeCwd),
        version: meta?.version ?? "0.1.0",
        aliases: meta?.aliases ?? [],
        pathsByDevice: meta?.pathsByDevice ?? {},
      });
    }
  }

  return { projects: registered, activeProjectId: activeId };
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

export async function startDashboardServer(
  cwd: string,
  options: { port?: number; hostname?: string; open?: boolean } = {}
): Promise<DashboardServer> {
  const port = options.port ?? 4040;
  const hostname = options.hostname ?? "127.0.0.1";

  const sseManager = new SSEManager();
  sseManager.start();

  // Mutable active project state (swappable via project switcher)
  let activeCwd = cwd;

  function swapWatcher(newCwd: string) {
    activeWatcher.close();
    activeCwd = newCwd;
    activeWatcher = createFileWatcher(newCwd, (fileId) => {
      sseManager.broadcast({
        fileId,
        timestamp: new Date().toISOString(),
      });
    });
  }

  // Start file watcher
  let activeWatcher = createFileWatcher(cwd, (fileId) => {
    sseManager.broadcast({
      fileId,
      timestamp: new Date().toISOString(),
    });
  });

  // Resolve the Next.js static build directory
  // Walk up from import.meta.url to find the package root (where package.json lives).
  // From source: src/core/ → ../../  From compiled bundle: dist/ → ../
  const __dir = dirname(new URL(import.meta.url).pathname);
  let pkgRoot = __dir;
  while (pkgRoot !== dirname(pkgRoot)) {
    if (existsSync(join(pkgRoot, "package.json"))) break;
    pkgRoot = dirname(pkgRoot);
  }
  const dashboardOutDir = join(pkgRoot, "dashboard", "out");
  const dashboardBuilt = existsSync(join(dashboardOutDir, "index.html"));
  let clientIdCounter = 0;

  if (!dashboardBuilt) {
    console.warn(
      "[mink] dashboard not built. Run: cd dashboard && bun run build"
    );
  }

  async function serveFile(
    filePath: string,
    contentType: string
  ): Promise<Response | null> {
    const file = runtimeFile(filePath);
    if (await file.exists()) {
      return new Response(await file.bytes() as unknown as BodyInit, {
        headers: { "Content-Type": contentType },
      });
    }
    return null;
  }

  const server = await runtimeServe({
    port,
    hostname,
    idleTimeout: 0, // Disable idle timeout — SSE connections are long-lived
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

          const ext = extname(filePath);
          const contentType = MIME_TYPES[ext] || "application/octet-stream";
          const served = await serveFile(filePath, contentType);
          if (served) return served;

          // Client-side routing fallback: try {pathname}.html then index.html
          const htmlServed = await serveFile(
            filePath + ".html",
            "text/html; charset=utf-8"
          );
          if (htmlServed) return htmlServed;

          // SPA fallback — serve index.html for unmatched routes
          const indexServed = await serveFile(
            join(dashboardOutDir, "index.html"),
            "text/html; charset=utf-8"
          );
          if (indexServed) return indexServed;
        }
      }

      // ── SSE ──────────────────────────────────────────────────────
      if (method === "GET" && pathname === "/api/events") {
        const clientId = String(++clientIdCounter);
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            sseManager.addClient(clientId, controller);
            controller.enqueue(encoder.encode(": connected\nretry: 3000\n\n"));
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
        // GET /api/projects — list all registered projects (no project param needed)
        if (pathname === "/api/projects") {
          return jsonResponse(getProjectsList(cwd, activeCwd));
        }

        // GET /api/config — global config (no project scoping)
        if (pathname === "/api/config") {
          try {
            return jsonResponse(loadConfigPanel());
          } catch (err) {
            return jsonResponse(
              { error: err instanceof Error ? err.message : String(err) },
              500,
            );
          }
        }

        // GET /api/sync — global sync status (no project scoping)
        if (pathname === "/api/sync") {
          try {
            return jsonResponse(loadSyncPanel());
          } catch (err) {
            return jsonResponse(
              { error: err instanceof Error ? err.message : String(err) },
              500,
            );
          }
        }

        // GET /api/channel — global channel status + logs (no project scoping)
        if (pathname === "/api/channel") {
          try {
            return jsonResponse(loadChannelPanel());
          } catch (err) {
            return jsonResponse(
              { error: err instanceof Error ? err.message : String(err) },
              500,
            );
          }
        }

        // GET /api/wiki — global wiki vault summary (no project scoping)
        if (pathname === "/api/wiki") {
          try {
            const limitRaw = url.searchParams.get("limit");
            const categoryRaw = url.searchParams.get("category");
            const limit = limitRaw ? Number(limitRaw) : undefined;
            return jsonResponse(
              loadWikiPanel({
                limit: Number.isFinite(limit) ? limit : undefined,
                category: (categoryRaw as "all" | undefined) ?? undefined,
              }),
            );
          } catch (err) {
            return jsonResponse(
              { error: err instanceof Error ? err.message : String(err) },
              500,
            );
          }
        }

        // GET /api/wiki/note — single note body with backlinks
        if (pathname === "/api/wiki/note") {
          try {
            const notePath = url.searchParams.get("path");
            if (!notePath) {
              return jsonResponse({ error: "Missing path parameter" }, 400);
            }
            const note = loadWikiNote(notePath);
            if (!note) {
              return jsonResponse({ error: "Note not found" }, 404);
            }
            return jsonResponse(note);
          } catch (err) {
            return jsonResponse(
              { error: err instanceof Error ? err.message : String(err) },
              500,
            );
          }
        }

        // Resolve project cwd from ?project=<id> query param
        const resolvedCwd = resolveProjectCwd(url, activeCwd);
        if (resolvedCwd === null) {
          return jsonResponse({ error: "Project not found" }, 404);
        }

        try {
          switch (pathname) {
            case "/api/overview":
              return jsonResponse(loadOverview(resolvedCwd));
            case "/api/token-ledger":
              return jsonResponse(loadTokenLedgerPanel(resolvedCwd));
            case "/api/compression":
              return jsonResponse(loadCompressionPanel(resolvedCwd));
            case "/api/file-index":
              return jsonResponse(loadFileIndexPanel(resolvedCwd));
            case "/api/scheduler":
              return jsonResponse(loadSchedulerPanel(resolvedCwd));
            case "/api/learning-memory":
              return jsonResponse(loadLearningMemoryPanel(resolvedCwd));
            case "/api/action-log":
              return jsonResponse(loadActionLogPanel(resolvedCwd));
            case "/api/bugs":
              return jsonResponse(loadBugLogPanel(resolvedCwd));
            case "/api/design":
              return jsonResponse(loadDesignPanel(resolvedCwd));
          }

          // GET /api/design-images/:filename — serve captured screenshots
          if (pathname.startsWith("/api/design-images/")) {
            const filename = pathname.slice("/api/design-images/".length);
            if (!filename || filename.includes("..") || filename.includes("/")) {
              return jsonResponse({ error: "Invalid filename" }, 400);
            }
            const imgPath = join(designCapturesDir(resolvedCwd), filename);
            const served = await serveFile(imgPath, "image/jpeg");
            if (served) {
              served.headers.set("Cache-Control", "public, max-age=60");
              served.headers.set("Access-Control-Allow-Origin", "*");
              return served;
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
        // POST /api/switch-project — swap the active project + file watcher
        if (pathname === "/api/switch-project") {
          try {
            const body = await req.json() as { projectId?: string };
            const projectId = body.projectId;
            if (!projectId) {
              return jsonResponse({ success: false, error: "Missing projectId" }, 400);
            }

            const projects = listRegisteredProjects();
            const match = projects.find((p) => p.id === projectId);
            if (!match) {
              return jsonResponse({ success: false, error: "Project not found" }, 404);
            }

            swapWatcher(match.cwd);
            sseManager.broadcast({
              fileId: "project-switched" as StateFileId,
              projectId,
              timestamp: new Date().toISOString(),
            });

            return jsonResponse({ success: true });
          } catch (err) {
            return jsonResponse(
              { success: false, error: err instanceof Error ? err.message : String(err) },
              500
            );
          }
        }

        // POST /api/config/set — write a config value
        if (pathname === "/api/config/set") {
          try {
            const body = (await req.json()) as {
              key?: string;
              value?: string;
            };
            if (!body.key || typeof body.value !== "string") {
              return jsonResponse(
                { success: false, error: "Missing key or value" },
                400,
              );
            }
            const result = await triggerConfigSet(body.key, body.value);
            if (result.success) {
              sseManager.broadcast({
                fileId: "config-changed" as StateFileId,
                timestamp: new Date().toISOString(),
              });
            }
            return jsonResponse(result, result.success ? 200 : 500);
          } catch (err) {
            return jsonResponse(
              { success: false, error: err instanceof Error ? err.message : String(err) },
              500,
            );
          }
        }

        // POST /api/config/reset — clear one key (or all)
        if (pathname === "/api/config/reset") {
          try {
            const body = (await req.json()) as { key?: string; all?: boolean };
            const result = await triggerConfigReset(body.key, body.all);
            if (result.success) {
              sseManager.broadcast({
                fileId: "config-changed" as StateFileId,
                timestamp: new Date().toISOString(),
              });
            }
            return jsonResponse(result, result.success ? 200 : 500);
          } catch (err) {
            return jsonResponse(
              { success: false, error: err instanceof Error ? err.message : String(err) },
              500,
            );
          }
        }

        // Wiki writes — global (single user-level vault).
        if (
          pathname === "/api/wiki/notes" ||
          pathname === "/api/wiki/daily" ||
          pathname === "/api/wiki/ingest"
        ) {
          const dedupKey = req.headers.get("X-Mink-Dedup-Key") ?? undefined;
          try {
            const body = (await req.json()) as Record<string, unknown>;

            let action: Promise<
              { success: boolean; error?: string; filePath?: string }
            >;

            if (pathname === "/api/wiki/notes") {
              const mode = body.mode === "structured" ? "structured" : "quick";
              action = triggerCreateNote({
                mode,
                title: typeof body.title === "string" ? body.title : undefined,
                category: typeof body.category === "string" ? body.category : undefined,
                body: typeof body.body === "string" ? body.body : "",
                tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
                dedupKey,
              });
            } else if (pathname === "/api/wiki/daily") {
              action = triggerAppendDaily(
                typeof body.content === "string" ? body.content : "",
                dedupKey,
              );
            } else {
              action = triggerIngestFile(
                typeof body.sourcePath === "string" ? body.sourcePath : "",
                typeof body.category === "string" ? body.category : "inbox",
                Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
                dedupKey,
              );
            }

            return action.then((result) => {
              if (result.success) {
                sseManager.broadcast({
                  fileId: "vault-index" as StateFileId,
                  timestamp: new Date().toISOString(),
                });
              }
              return jsonResponse(result, result.success ? 200 : 500);
            });
          } catch (err) {
            return jsonResponse(
              { success: false, error: err instanceof Error ? err.message : String(err) },
              500,
            );
          }
        }

        // Channel controls — global (screen session is per-vault, not per-project).
        if (
          pathname === "/api/channel/start" ||
          pathname === "/api/channel/stop" ||
          pathname === "/api/channel/restart"
        ) {
          const action =
            pathname === "/api/channel/start"
              ? triggerChannelStart()
              : pathname === "/api/channel/stop"
                ? triggerChannelStop()
                : triggerChannelRestart();
          return action.then((result) => {
            if (result.success) {
              sseManager.broadcast({
                fileId: "channel-status" as StateFileId,
                timestamp: new Date().toISOString(),
              });
            }
            return jsonResponse(result, result.success ? 200 : 500);
          });
        }

        // Sync controls — global (operate on ~/.mink/.git, not a project).
        if (
          pathname === "/api/sync/pull" ||
          pathname === "/api/sync/push" ||
          pathname === "/api/sync/disconnect"
        ) {
          const action =
            pathname === "/api/sync/pull"
              ? triggerSyncPull()
              : pathname === "/api/sync/push"
                ? triggerSyncPush()
                : triggerSyncDisconnect();
          return action.then((result) => {
            if (result.success) {
              sseManager.broadcast({
                fileId: "sync-status" as StateFileId,
                timestamp: new Date().toISOString(),
              });
            }
            return jsonResponse(result, result.success ? 200 : 500);
          });
        }

        // Daemon controls — global (operate on ~/.mink/ PID file, not a
        // project state directory). Use activeCwd so the spawned daemon
        // inherits the currently-active project.
        if (
          pathname === "/api/daemon/start" ||
          pathname === "/api/daemon/stop" ||
          pathname === "/api/daemon/restart"
        ) {
          const action =
            pathname === "/api/daemon/start"
              ? triggerDaemonStart(activeCwd)
              : pathname === "/api/daemon/stop"
                ? triggerDaemonStop()
                : triggerDaemonRestart(activeCwd);
          return action.then((result) => {
            if (result.success) {
              sseManager.broadcast({
                fileId: "daemon-status" as StateFileId,
                timestamp: new Date().toISOString(),
              });
            }
            return jsonResponse(result, result.success ? 200 : 500);
          });
        }

        // Resolve project cwd for POST actions
        const resolvedCwd = resolveProjectCwd(url, activeCwd);
        if (resolvedCwd === null) {
          return jsonResponse({ error: "Project not found" }, 404);
        }

        // POST /api/tasks/:id/run
        if (pathname.startsWith("/api/tasks/") && pathname.endsWith("/run")) {
          const taskId = extractPathParam(pathname, "/api/tasks/");
          const cleanId = taskId?.replace(/\/run$/, "") ?? "";
          if (!cleanId) {
            return jsonResponse({ success: false, error: "Missing task ID" }, 400);
          }
          return triggerTask(resolvedCwd, cleanId).then((result) =>
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
          return triggerDeadLetterRetry(resolvedCwd, cleanId).then((result) =>
            jsonResponse(result, result.success ? 200 : 500)
          );
        }

        // POST /api/rescan
        if (pathname === "/api/rescan") {
          return triggerRescan(resolvedCwd).then((result) =>
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
      runtimeSpawn(cmd).unref();
    } catch {
      // Browser open is best-effort
    }
  }

  return {
    url: serverUrl,
    close() {
      sseManager.stop();
      activeWatcher.close();
      server.stop(true);
    },
  };
}
