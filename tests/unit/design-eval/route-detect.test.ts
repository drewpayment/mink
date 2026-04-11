import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  detectFramework,
  detectRoutes,
} from "../../../src/core/design-eval/route-detect";

describe("detectFramework", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mink-route-detect-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects Next.js from next.config.js", () => {
    writeFileSync(join(tmpDir, "next.config.js"), "module.exports = {}");
    expect(detectFramework(tmpDir)).toBe("nextjs");
  });

  test("detects Next.js from next.config.mjs", () => {
    writeFileSync(join(tmpDir, "next.config.mjs"), "export default {}");
    expect(detectFramework(tmpDir)).toBe("nextjs");
  });

  test("detects SvelteKit from svelte.config.js", () => {
    writeFileSync(join(tmpDir, "svelte.config.js"), "export default {}");
    expect(detectFramework(tmpDir)).toBe("sveltekit");
  });

  test("detects Nuxt from nuxt.config.ts", () => {
    writeFileSync(join(tmpDir, "nuxt.config.ts"), "export default {}");
    expect(detectFramework(tmpDir)).toBe("nuxt");
  });

  test("returns generic when no config found", () => {
    expect(detectFramework(tmpDir)).toBe("generic");
  });
});

describe("detectRoutes — Next.js App Router", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mink-route-detect-"));
    writeFileSync(join(tmpDir, "next.config.js"), "module.exports = {}");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects root page", () => {
    mkdirSync(join(tmpDir, "app"), { recursive: true });
    writeFileSync(join(tmpDir, "app", "page.tsx"), "export default () => null");
    expect(detectRoutes(tmpDir)).toEqual(["/"]);
  });

  test("detects nested pages", () => {
    mkdirSync(join(tmpDir, "app"), { recursive: true });
    mkdirSync(join(tmpDir, "app", "about"), { recursive: true });
    mkdirSync(join(tmpDir, "app", "contact"), { recursive: true });
    writeFileSync(join(tmpDir, "app", "page.tsx"), "");
    writeFileSync(join(tmpDir, "app", "about", "page.tsx"), "");
    writeFileSync(join(tmpDir, "app", "contact", "page.tsx"), "");

    const routes = detectRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/about");
    expect(routes).toContain("/contact");
    expect(routes).toHaveLength(3);
  });

  test("skips dynamic segments", () => {
    mkdirSync(join(tmpDir, "app"), { recursive: true });
    mkdirSync(join(tmpDir, "app", "blog", "[slug]"), { recursive: true });
    writeFileSync(join(tmpDir, "app", "page.tsx"), "");
    writeFileSync(join(tmpDir, "app", "blog", "[slug]", "page.tsx"), "");

    const routes = detectRoutes(tmpDir);
    expect(routes).toEqual(["/"]);
  });

  test("skips route groups", () => {
    mkdirSync(join(tmpDir, "app", "(marketing)", "about"), { recursive: true });
    writeFileSync(
      join(tmpDir, "app", "(marketing)", "about", "page.tsx"),
      ""
    );

    const routes = detectRoutes(tmpDir);
    // Route groups with parentheses are skipped
    expect(routes).not.toContain("/about");
  });
});

describe("detectRoutes — Next.js Pages Router", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mink-route-detect-"));
    writeFileSync(join(tmpDir, "next.config.js"), "module.exports = {}");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects pages from pages directory", () => {
    mkdirSync(join(tmpDir, "pages"), { recursive: true });
    writeFileSync(join(tmpDir, "pages", "index.tsx"), "");
    writeFileSync(join(tmpDir, "pages", "about.tsx"), "");

    const routes = detectRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/about");
  });

  test("skips _app and _document and api", () => {
    mkdirSync(join(tmpDir, "pages", "api"), { recursive: true });
    writeFileSync(join(tmpDir, "pages", "index.tsx"), "");
    writeFileSync(join(tmpDir, "pages", "_app.tsx"), "");
    writeFileSync(join(tmpDir, "pages", "_document.tsx"), "");
    writeFileSync(join(tmpDir, "pages", "api", "hello.ts"), "");

    const routes = detectRoutes(tmpDir);
    expect(routes).toEqual(["/"]);
  });
});

describe("detectRoutes — SvelteKit", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mink-route-detect-"));
    writeFileSync(join(tmpDir, "svelte.config.js"), "export default {}");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects routes from src/routes", () => {
    mkdirSync(join(tmpDir, "src", "routes"), { recursive: true });
    mkdirSync(join(tmpDir, "src", "routes", "about"), { recursive: true });
    writeFileSync(join(tmpDir, "src", "routes", "+page.svelte"), "");
    writeFileSync(join(tmpDir, "src", "routes", "about", "+page.svelte"), "");

    const routes = detectRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/about");
  });
});

describe("detectRoutes — Nuxt", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mink-route-detect-"));
    writeFileSync(join(tmpDir, "nuxt.config.ts"), "export default {}");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("detects routes from pages directory", () => {
    mkdirSync(join(tmpDir, "pages"), { recursive: true });
    writeFileSync(join(tmpDir, "pages", "index.vue"), "");
    writeFileSync(join(tmpDir, "pages", "about.vue"), "");

    const routes = detectRoutes(tmpDir);
    expect(routes).toContain("/");
    expect(routes).toContain("/about");
  });
});

describe("detectRoutes — generic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "mink-route-detect-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("returns ['/'] for generic projects", () => {
    expect(detectRoutes(tmpDir)).toEqual(["/"]);
  });
});
