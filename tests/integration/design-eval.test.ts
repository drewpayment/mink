import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, mkdtempSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { Server } from "bun";
import { probePort, findRunningServer } from "../../src/core/design-eval/server-detect";
import { safeReadJson } from "../../src/core/fs-utils";
import { isDesignEvalReport } from "../../src/types/design-eval";

// ── Test HTTP Server ──────────────────────────────────────────────────────

let server: Server;
let serverPort: number;

const TEST_HTML = `<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body style="margin:0; min-height: 2000px;">
  <h1>Hello from test server</h1>
  <p>This is a test page for design evaluation captures.</p>
</body>
</html>`;

const ABOUT_HTML = `<!DOCTYPE html>
<html>
<head><title>About</title></head>
<body style="margin:0; min-height: 500px;">
  <h1>About Page</h1>
</body>
</html>`;

beforeAll(() => {
  server = Bun.serve({
    port: 0, // random available port
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/" || url.pathname === "/index") {
        return new Response(TEST_HTML, {
          headers: { "Content-Type": "text/html" },
        });
      }
      if (url.pathname === "/about") {
        return new Response(ABOUT_HTML, {
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response("<html><body><h1>404</h1></body></html>", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      });
    },
  });
  serverPort = server.port;
});

afterAll(() => {
  server.stop(true);
});

// ── Server Detection ──────────────────────────────────────────────────────

describe("probePort (integration)", () => {
  test("returns true for running test server", async () => {
    expect(await probePort(serverPort)).toBe(true);
  });

  test("returns false for closed port", async () => {
    // Use a port that's very unlikely to be in use
    expect(await probePort(19999)).toBe(false);
  });
});

describe("findRunningServer (integration)", () => {
  test("finds server when port is in probe list", async () => {
    const result = await findRunningServer([serverPort]);
    expect(result).toBe(`http://localhost:${serverPort}`);
  });

  test("returns null when no server on listed ports", async () => {
    const result = await findRunningServer([19998, 19999]);
    expect(result).toBeNull();
  });
});

// ── Full Capture Pipeline ─────────────────────────────────────────────────

describe("captureAllRoutes (integration)", () => {
  // These tests require Chrome/Chromium installed — skip gracefully if missing
  let outputDir: string;

  beforeAll(() => {
    outputDir = mkdtempSync(join(tmpdir(), "mink-capture-test-"));
  });

  afterAll(() => {
    rmSync(outputDir, { recursive: true, force: true });
  });

  test("captures single route with desktop viewport", async () => {
    let captureModule;
    try {
      captureModule = await import("../../src/core/design-eval/capture");
      // This will throw if no browser is found
      captureModule.findBrowser();
    } catch (e) {
      console.log("Skipping capture test — no Chrome/Chromium found");
      return;
    }

    const { captureAllRoutes } = captureModule;
    const report = await captureAllRoutes(
      ["/"],
      `http://localhost:${serverPort}`,
      [{ name: "desktop" as const, width: 1440, height: 900 }],
      { quality: 70, desktopOnly: true, maxSections: 8 },
      outputDir
    );

    expect(report.captures.length).toBeGreaterThan(0);
    expect(report.errors).toHaveLength(0);

    // Verify files exist
    for (const capture of report.captures) {
      expect(existsSync(capture.filePath)).toBe(true);
      expect(capture.fileSize).toBeGreaterThan(0);
      expect(capture.fileName).toMatch(/^index-desktop-\d+\.jpg$/);
      expect(capture.statusCode).toBe(200);
    }

    // The test page is 2000px tall on a 900px viewport = 3 sections
    // (depends on actual rendering, but should be at least 2)
    expect(report.captures.length).toBeGreaterThanOrEqual(2);
  }, 30000);

  test("captures multiple routes", async () => {
    let captureModule;
    try {
      captureModule = await import("../../src/core/design-eval/capture");
      captureModule.findBrowser();
    } catch {
      console.log("Skipping capture test — no Chrome/Chromium found");
      return;
    }

    const multiDir = mkdtempSync(join(tmpdir(), "mink-multi-capture-"));
    try {
      const { captureAllRoutes } = captureModule;
      const report = await captureAllRoutes(
        ["/", "/about"],
        `http://localhost:${serverPort}`,
        [{ name: "desktop" as const, width: 1440, height: 900 }],
        { quality: 70, desktopOnly: true, maxSections: 8 },
        multiDir
      );

      // Should have captures for both routes
      const indexCaptures = report.captures.filter((c) => c.route === "/");
      const aboutCaptures = report.captures.filter((c) => c.route === "/about");
      expect(indexCaptures.length).toBeGreaterThan(0);
      expect(aboutCaptures.length).toBeGreaterThan(0);

      // All files should exist
      for (const c of report.captures) {
        expect(existsSync(c.filePath)).toBe(true);
      }
    } finally {
      rmSync(multiDir, { recursive: true, force: true });
    }
  }, 30000);

  test("captures 404 pages with error status", async () => {
    let captureModule;
    try {
      captureModule = await import("../../src/core/design-eval/capture");
      captureModule.findBrowser();
    } catch {
      console.log("Skipping capture test — no Chrome/Chromium found");
      return;
    }

    const errDir = mkdtempSync(join(tmpdir(), "mink-err-capture-"));
    try {
      const { captureAllRoutes } = captureModule;
      const report = await captureAllRoutes(
        ["/nonexistent"],
        `http://localhost:${serverPort}`,
        [{ name: "desktop" as const, width: 1440, height: 900 }],
        { quality: 70, desktopOnly: true, maxSections: 8 },
        errDir
      );

      // Should still capture the page
      expect(report.captures.length).toBeGreaterThan(0);
      expect(report.captures[0].statusCode).toBe(404);
    } finally {
      rmSync(errDir, { recursive: true, force: true });
    }
  }, 30000);
});

// ── Report Validation ─────────────────────────────────────────────────────

describe("isDesignEvalReport", () => {
  test("validates a proper report", () => {
    const report = {
      capturedAt: new Date().toISOString(),
      serverUrl: "http://localhost:3000",
      routes: ["/"],
      viewports: [{ name: "desktop", width: 1440, height: 900 }],
      quality: 70,
      captures: [],
      errors: [],
    };
    expect(isDesignEvalReport(report)).toBe(true);
  });

  test("rejects invalid objects", () => {
    expect(isDesignEvalReport(null)).toBe(false);
    expect(isDesignEvalReport({})).toBe(false);
    expect(isDesignEvalReport({ capturedAt: "x" })).toBe(false);
  });
});
