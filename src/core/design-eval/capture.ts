import { mkdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import puppeteer from "puppeteer-core";
import type { Browser, Page } from "puppeteer-core";
import { minkRoot } from "../paths";
import type {
  Viewport,
  CaptureResult,
  DesignEvalReport,
  DesignQcOptions,
} from "../../types/design-eval";

// ── Browser Detection ─────────────────────────────────────────────────────

const CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ],
  linux: [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    `${process.env.LOCALAPPDATA ?? ""}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
};

/**
 * Find a Chrome/Chromium executable on the system.
 * Checks platform-specific paths, then ~/.mink/browsers/.
 */
export function findBrowser(): string {
  const platform = process.platform;

  // Check system paths
  const paths = CHROME_PATHS[platform] ?? [];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }

  // Check mink-managed browser installs
  const minkBrowsers = join(minkRoot(), "browsers");
  if (existsSync(minkBrowsers)) {
    // Look for chrome/chromium executables recursively
    const found = findChromeInDir(minkBrowsers);
    if (found) return found;
  }

  throw new Error(
    [
      "[mink] No Chrome/Chromium browser found.",
      "",
      "Install one of:",
      "  • Google Chrome: https://www.google.com/chrome/",
      "  • Or run: npx @puppeteer/browsers install chrome@stable --path ~/.mink/browsers",
      "",
      "Then retry: mink designqc",
    ].join("\n")
  );
}

function findChromeInDir(dir: string): string | null {
  const { readdirSync, statSync } = require("fs") as typeof import("fs");
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          const found = findChromeInDir(full);
          if (found) return found;
        } else if (/^(chrome|chromium|Google Chrome)$/i.test(entry)) {
          return full;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // dir not readable
  }
  return null;
}

// ── Route Sanitization ────────────────────────────────────────────────────

/**
 * Convert a route path to a safe filename prefix.
 * "/" → "index", "/about" → "about", "/foo/bar" → "foo-bar"
 */
export function sanitizeRoute(route: string): string {
  if (route === "/") return "index";
  return route
    .replace(/^\//, "")
    .replace(/\/+/g, "-")
    .replace(/[^a-zA-Z0-9-_]/g, "_");
}

/**
 * Calculate how many viewport-height sections are needed.
 */
export function calculateSections(
  pageHeight: number,
  viewportHeight: number,
  maxSections: number
): number {
  if (pageHeight <= 0) return 0;
  return Math.min(Math.ceil(pageHeight / viewportHeight), maxSections);
}

// ── Screenshot Capture ────────────────────────────────────────────────────

/**
 * Capture a single route at a single viewport, producing sectioned screenshots.
 */
export async function captureRoute(
  page: Page,
  route: string,
  baseUrl: string,
  viewport: Viewport,
  options: { quality: number; maxSections: number; outputDir: string }
): Promise<CaptureResult[]> {
  const results: CaptureResult[] = [];
  const url = `${baseUrl.replace(/\/$/, "")}${route}`;
  const timestamp = new Date().toISOString();

  // Set viewport
  await page.setViewport({ width: viewport.width, height: viewport.height });

  // Navigate and wait for stability
  const response = await page.goto(url, {
    waitUntil: "networkidle0",
    timeout: 30000,
  });
  const statusCode = response?.status() ?? 0;

  // Get full page height
  const pageHeight = await page.evaluate(() => {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    );
  });

  const totalSections = calculateSections(
    pageHeight,
    viewport.height,
    options.maxSections
  );

  if (totalSections === 0) return results;

  const prefix = sanitizeRoute(route);

  for (let section = 0; section < totalSections; section++) {
    const y = section * viewport.height;
    const clipHeight = Math.min(viewport.height, pageHeight - y);

    const fileName = `${prefix}-${viewport.name}-${section}.jpg`;
    const filePath = join(options.outputDir, fileName);

    await page.screenshot({
      path: filePath,
      type: "jpeg",
      quality: options.quality,
      clip: {
        x: 0,
        y,
        width: viewport.width,
        height: clipHeight,
      },
    });

    let fileSize = 0;
    try {
      fileSize = statSync(filePath).size;
    } catch {
      // stat failed — leave as 0
    }

    results.push({
      route,
      viewport: viewport.name,
      section,
      totalSections,
      filePath,
      fileName,
      fileSize,
      pageHeight,
      statusCode,
      timestamp,
    });
  }

  return results;
}

/**
 * Capture all routes across all viewports. Launches the browser once.
 */
export async function captureAllRoutes(
  routes: string[],
  baseUrl: string,
  viewports: Viewport[],
  options: DesignQcOptions,
  outputDir: string
): Promise<DesignEvalReport> {
  mkdirSync(outputDir, { recursive: true });

  const executablePath = findBrowser();
  const browser: Browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const report: DesignEvalReport = {
    capturedAt: new Date().toISOString(),
    serverUrl: baseUrl,
    routes,
    viewports,
    quality: options.quality,
    captures: [],
    errors: [],
  };

  try {
    const page = await browser.newPage();

    for (const route of routes) {
      for (const viewport of viewports) {
        try {
          const results = await captureRoute(page, route, baseUrl, viewport, {
            quality: options.quality,
            maxSections: options.maxSections,
            outputDir,
          });
          report.captures.push(...results);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          report.errors.push({
            route,
            viewport: viewport.name,
            error: message,
          });
          console.error(
            `[mink] Error capturing ${route} (${viewport.name}): ${message}`
          );
        }
      }
    }

    await page.close();
  } finally {
    await browser.close();
  }

  return report;
}
