import { designCapturesDir, designReportPath } from "../core/paths";
import { atomicWriteJson } from "../core/fs-utils";
import { findRunningServer, detectDevCommand } from "../core/design-eval/server-detect";
import { detectRoutes } from "../core/design-eval/route-detect";
import { captureAllRoutes } from "../core/design-eval/capture";
import {
  DEFAULT_VIEWPORTS,
  DEFAULT_QUALITY,
  DEFAULT_MAX_SECTIONS,
} from "../types/design-eval";
import type { DesignQcOptions, Viewport } from "../types/design-eval";

// ── Arg Parsing ───────────────────────────────────────────────────────────

export function parseDesignQcArgs(args: string[]): DesignQcOptions {
  const options: DesignQcOptions = {
    quality: DEFAULT_QUALITY,
    desktopOnly: false,
    maxSections: DEFAULT_MAX_SECTIONS,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--url" && i + 1 < args.length) {
      options.url = args[++i];
    } else if (arg === "--routes") {
      const routes: string[] = [];
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        routes.push(args[++i]);
      }
      if (routes.length > 0) options.routes = routes;
    } else if (arg === "--quality" && i + 1 < args.length) {
      const q = parseInt(args[++i], 10);
      if (!isNaN(q)) options.quality = Math.max(1, Math.min(100, q));
    } else if (arg === "--max-sections" && i + 1 < args.length) {
      const m = parseInt(args[++i], 10);
      if (!isNaN(m) && m > 0) options.maxSections = m;
    } else if (arg === "--desktop-only") {
      options.desktopOnly = true;
    }
  }

  return options;
}

// ── Command ───────────────────────────────────────────────────────────────

export async function designqc(cwd: string, args: string[]): Promise<void> {
  const options = parseDesignQcArgs(args);

  // ── Resolve server URL ────────────────────────────────────────────────
  let serverUrl: string;

  if (options.url) {
    // Extract base URL from --url flag
    try {
      const parsed = new URL(options.url);
      serverUrl = `${parsed.protocol}//${parsed.host}`;

      // If --url has a path and no --routes, capture that single path
      if (!options.routes && parsed.pathname !== "/") {
        options.routes = [parsed.pathname];
      }
    } catch {
      console.error(`[mink] Invalid URL: ${options.url}`);
      process.exit(1);
    }
  } else {
    console.log("[mink] Probing for running dev server...");
    const found = await findRunningServer();

    if (!found) {
      const devCmd = detectDevCommand(cwd);
      if (devCmd) {
        console.error(
          `[mink] No dev server detected. Start one with: ${devCmd}`
        );
      } else {
        console.error(
          "[mink] No dev server detected and no start command found in package.json."
        );
      }
      process.exit(1);
    }

    serverUrl = found;
    console.log(`[mink] Found dev server at ${serverUrl}`);
  }

  // ── Resolve routes ────────────────────────────────────────────────────
  let routes: string[];

  if (options.routes) {
    routes = options.routes;
    console.log(`[mink] Using specified routes: ${routes.join(", ")}`);
  } else {
    routes = detectRoutes(cwd);
    console.log(`[mink] Detected ${routes.length} route(s): ${routes.join(", ")}`);
  }

  // ── Resolve viewports ─────────────────────────────────────────────────
  const viewports: Viewport[] = options.desktopOnly
    ? [DEFAULT_VIEWPORTS[0]]
    : DEFAULT_VIEWPORTS;

  console.log(
    `[mink] Viewports: ${viewports.map((v) => `${v.name} (${v.width}×${v.height})`).join(", ")}`
  );
  console.log(`[mink] Quality: ${options.quality}, Max sections: ${options.maxSections}`);

  // ── Capture ───────────────────────────────────────────────────────────
  const outputDir = designCapturesDir(cwd);

  console.log("[mink] Starting capture...");
  const report = await captureAllRoutes(
    routes,
    serverUrl,
    viewports,
    options,
    outputDir
  );

  // ── Save report ───────────────────────────────────────────────────────
  atomicWriteJson(designReportPath(cwd), report);

  // ── Summary ───────────────────────────────────────────────────────────
  const totalSize = report.captures.reduce((sum, c) => sum + c.fileSize, 0);
  const sizeKb = (totalSize / 1024).toFixed(1);

  console.log("");
  console.log(`[mink] Capture complete:`);
  console.log(`  Screenshots: ${report.captures.length}`);
  console.log(`  Total size:  ${sizeKb} KB`);
  console.log(`  Output dir:  ${outputDir}`);
  console.log(`  Report:      ${designReportPath(cwd)}`);

  if (report.errors.length > 0) {
    console.log(`  Errors:      ${report.errors.length}`);
    for (const err of report.errors) {
      console.log(`    • ${err.route} (${err.viewport}): ${err.error}`);
    }
  }

  // Note any non-200 status codes
  const errorPages = report.captures.filter(
    (c) => c.statusCode >= 400
  );
  if (errorPages.length > 0) {
    console.log("");
    console.log(`[mink] Warning: ${errorPages.length} page(s) returned error status codes:`);
    const seen = new Set<string>();
    for (const c of errorPages) {
      const key = `${c.route}:${c.statusCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`    • ${c.route} → ${c.statusCode}`);
    }
  }
}
