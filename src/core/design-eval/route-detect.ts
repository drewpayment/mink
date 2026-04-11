import { existsSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";

export type FrameworkType = "nextjs" | "sveltekit" | "nuxt" | "generic";

/**
 * Detect the frontend framework by checking for config files.
 */
export function detectFramework(cwd: string): FrameworkType {
  const has = (name: string) =>
    ["js", "mjs", "ts", "cjs"].some((ext) =>
      existsSync(join(cwd, `${name}.${ext}`))
    ) || existsSync(join(cwd, name));

  if (has("next.config")) return "nextjs";
  if (has("svelte.config")) return "sveltekit";
  if (has("nuxt.config")) return "nuxt";
  return "generic";
}

/**
 * Detect capturable routes based on the project's framework conventions.
 * Only returns static routes — dynamic segments like [param] are excluded.
 */
export function detectRoutes(cwd: string): string[] {
  const framework = detectFramework(cwd);

  switch (framework) {
    case "nextjs":
      return detectNextRoutes(cwd);
    case "sveltekit":
      return detectSvelteKitRoutes(cwd);
    case "nuxt":
      return detectNuxtRoutes(cwd);
    case "generic":
    default:
      return ["/"];
  }
}

// ── Next.js ───────────────────────────────────────────────────────────────

function detectNextRoutes(cwd: string): string[] {
  const routes: string[] = [];

  // App Router: app/**/page.{tsx,jsx,js,ts}
  const appDir = join(cwd, "app");
  if (existsSync(appDir)) {
    const pageFiles = findFiles(appDir, /^page\.(tsx?|jsx?)$/);
    for (const file of pageFiles) {
      const rel = relative(appDir, file);
      const dir = rel.replace(/([/\\])?page\.(tsx?|jsx?)$/, "");
      const route = dir === "" ? "/" : `/${dir.split(sep).join("/")}`;

      // Skip dynamic segments, route groups, and parallel routes
      if (/\[|@|\(/.test(route)) continue;
      routes.push(route);
    }
  }

  // Pages Router: pages/**/*.{tsx,jsx,js,ts}
  const pagesDir = join(cwd, "pages");
  if (existsSync(pagesDir)) {
    const pageFiles = findFiles(pagesDir, /\.(tsx?|jsx?)$/);
    for (const file of pageFiles) {
      const rel = relative(pagesDir, file);
      const name = rel.replace(/\.(tsx?|jsx?)$/, "");

      // Skip special Next.js files and API routes
      if (/^_(app|document|error)/.test(name)) continue;
      if (name.startsWith(`api${sep}`) || name === "api") continue;
      // Skip dynamic segments
      if (/\[/.test(name)) continue;

      const route =
        name === "index" ? "/" : `/${name.split(sep).join("/")}`;
      routes.push(route);
    }
  }

  // Deduplicate (app router and pages router may both define /)
  const unique = [...new Set(routes)];
  return unique.length > 0 ? unique.sort() : ["/"];
}

// ── SvelteKit ─────────────────────────────────────────────────────────────

function detectSvelteKitRoutes(cwd: string): string[] {
  const routesDir = join(cwd, "src", "routes");
  if (!existsSync(routesDir)) return ["/"];

  const routes: string[] = [];
  const pageFiles = findFiles(routesDir, /^\+page\.svelte$/);

  for (const file of pageFiles) {
    const rel = relative(routesDir, file);
    const dir = rel.replace(/([/\\])?\+page\.svelte$/, "");
    const route = dir === "" ? "/" : `/${dir.split(sep).join("/")}`;

    // Skip dynamic segments and groups
    if (/\[|\(/.test(route)) continue;
    routes.push(route);
  }

  return routes.length > 0 ? routes.sort() : ["/"];
}

// ── Nuxt ──────────────────────────────────────────────────────────────────

function detectNuxtRoutes(cwd: string): string[] {
  const pagesDir = join(cwd, "pages");
  if (!existsSync(pagesDir)) return ["/"];

  const routes: string[] = [];
  const vueFiles = findFiles(pagesDir, /\.vue$/);

  for (const file of vueFiles) {
    const rel = relative(pagesDir, file);
    const name = rel.replace(/\.vue$/, "");

    // Skip dynamic segments
    if (/\[/.test(name)) continue;

    const route =
      name === "index" ? "/" : `/${name.split(sep).join("/")}`;
    routes.push(route);
  }

  return routes.length > 0 ? routes.sort() : ["/"];
}

// ── Helpers ───────────────────────────────────────────────────────────────

function findFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      // Skip hidden dirs and node_modules
      if (entry.startsWith(".") || entry === "node_modules") continue;

      const full = join(current, entry);
      try {
        const stat = statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (pattern.test(entry)) {
          results.push(full);
        }
      } catch {
        // Skip inaccessible entries
      }
    }
  }

  walk(dir);
  return results;
}
