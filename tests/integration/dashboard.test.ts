import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { startDashboardServer, type DashboardServer } from "../../src/core/dashboard-server";
import { schedulerPidPath } from "../../src/core/paths";

// We need a real state directory for the server to read from.
// We'll mock project paths by creating a temp dir with state files.

let projectCwd: string;
let stateDir: string;
let server: DashboardServer;

// Create a fake project directory structure
function setupProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), "mink-dash-integ-"));

  // We need the state dir to exist at the path projectDir(cwd) resolves to.
  // Since projectDir uses generateProjectId which hashes the cwd,
  // we'll write files there by importing the actual path helpers.
  return cwd;
}

describe("dashboard server", () => {
  let cwd: string;
  let srv: DashboardServer;

  beforeEach(async () => {
    cwd = mkdtempSync(join(tmpdir(), "mink-dash-integ-"));

    // Create state directory for this project
    const { projectDir } = await import("../../src/core/paths");
    const dir = projectDir(cwd);
    mkdirSync(dir, { recursive: true });

    // Write minimal state files
    writeFileSync(join(dir, "token-ledger.json"), JSON.stringify({
      lifetime: { totalTokens: 100, totalReads: 5, totalWrites: 2, totalSessions: 1, totalFileIndexHits: 4, totalFileIndexMisses: 1, totalRepeatedReads: 0, totalEstimatedSavings: 50 },
      sessions: []
    }));

    writeFileSync(join(dir, "file-index.json"), JSON.stringify({
      header: { lastScanTimestamp: "2026-04-11T10:00:00.000Z", totalFiles: 1, lifetimeHits: 4, lifetimeMisses: 1 },
      entries: { "src/app.ts": { filePath: "src/app.ts", description: "App entry", estimatedTokens: 100, lastModified: "2026-04-11T09:00:00.000Z", lastIndexed: "2026-04-11T10:00:00.000Z" } }
    }));

    writeFileSync(join(dir, "bug-memory.json"), JSON.stringify({ entries: [], nextId: 1 }));
    writeFileSync(join(dir, "project-meta.json"), JSON.stringify({ name: "test-project", description: "Test" }));

    // Use a random high port to avoid conflicts
    const port = 10000 + Math.floor(Math.random() * 50000);
    srv = await startDashboardServer(cwd, { port, open: false });
  });

  afterEach(() => {
    if (srv) srv.close();
    rmSync(cwd, { recursive: true, force: true });
  });

  test("serves HTML at root", async () => {
    const res = await fetch(srv.url + "/");
    expect(res.status).toBe(200);
    const ct = res.headers.get("content-type") || "";
    expect(ct).toContain("text/html");
    const text = await res.text();
    expect(text).toContain("Mink — Command Center");
  });

  test("GET /api/overview returns valid JSON", async () => {
    const res = await fetch(srv.url + "/api/overview");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary).toBeDefined();
    expect(data.summary.totalTokens).toBe(100);
    expect(data.stateFiles).toBeDefined();
  });

  test("GET /api/token-ledger returns ledger data", async () => {
    const res = await fetch(srv.url + "/api/token-ledger");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lifetime).toBeDefined();
    expect(data.lifetime.totalTokens).toBe(100);
    expect(data.sessions).toBeDefined();
    expect(data.wasteFlags).toBeDefined();
  });

  test("GET /api/file-index returns entries as array", async () => {
    const res = await fetch(srv.url + "/api/file-index");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.header).toBeDefined();
    expect(Array.isArray(data.entries)).toBe(true);
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].filePath).toBe("src/app.ts");
  });

  test("GET /api/bugs returns bug memory", async () => {
    const res = await fetch(srv.url + "/api/bugs");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toEqual([]);
    expect(data.nextId).toBe(1);
  });

  test("GET /api/scheduler returns tasks", async () => {
    const res = await fetch(srv.url + "/api/scheduler");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tasks).toBeDefined();
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks.length).toBeGreaterThan(0);
    expect(data.tasks[0].definition).toBeDefined();
    expect(data.tasks[0].definition.id).toBeDefined();
  });

  test("GET /api/action-log returns sessions array", async () => {
    const res = await fetch(srv.url + "/api/action-log");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions).toBeDefined();
    expect(Array.isArray(data.sessions)).toBe(true);
  });

  test("GET /api/learning-memory returns sections", async () => {
    const res = await fetch(srv.url + "/api/learning-memory");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sections).toBeDefined();
  });

  test("unknown route returns 404", async () => {
    const res = await fetch(srv.url + "/api/nonexistent");
    expect(res.status).toBe(404);
  });

  test("POST /api/daemon/stop is a no-op when no daemon is running", async () => {
    // Guard: only run when no real daemon PID file exists, otherwise this
    // test would interfere with the developer's actual running daemon.
    if (existsSync(schedulerPidPath())) return;

    const res = await fetch(srv.url + "/api/daemon/stop", { method: "POST" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);

    // Overview should reflect a non-running daemon.
    const overviewRes = await fetch(srv.url + "/api/overview");
    const overview = await overviewRes.json();
    expect(overview.daemon.running).toBe(false);
  });

  test("POST /api/daemon/unknown returns 404", async () => {
    const res = await fetch(srv.url + "/api/daemon/unknown", { method: "POST" });
    expect(res.status).toBe(404);
  });

  test("SSE endpoint is accessible", async () => {
    // Use AbortController to avoid hanging on the streaming response
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000);
    try {
      const res = await fetch(srv.url + "/api/events", { signal: controller.signal });
      expect(res.status).toBe(200);
      const ct = res.headers.get("content-type") || "";
      expect(ct).toContain("text/event-stream");
    } catch (err: any) {
      // AbortError is expected — means we connected successfully
      if (err.name !== "AbortError") throw err;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });
});
