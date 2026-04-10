import { basename } from "path";
import { readFileSync, existsSync } from "fs";
import type { LearningMemory, SeedInfo } from "../types/learning-memory";
import { createEmptyLearningMemory, addEntry } from "./learning-memory";

// ─── Framework detection maps ─────────────────────────────────────────────────

const NPM_FRAMEWORKS: Record<string, string> = {
  react: "React",
  "react-dom": "React",
  next: "Next.js",
  vue: "Vue",
  nuxt: "Nuxt",
  svelte: "Svelte",
  "@sveltejs/kit": "SvelteKit",
  angular: "Angular",
  "@angular/core": "Angular",
  express: "Express",
  fastify: "Fastify",
  hono: "Hono",
  koa: "Koa",
  "@nestjs/core": "NestJS",
  typescript: "TypeScript",
  jest: "Jest",
  vitest: "Vitest",
  mocha: "Mocha",
  tailwindcss: "Tailwind CSS",
  prisma: "Prisma",
  "@prisma/client": "Prisma",
  "drizzle-orm": "Drizzle",
};

const PYTHON_FRAMEWORKS: Record<string, string> = {
  fastapi: "FastAPI",
  flask: "Flask",
  django: "Django",
  sqlalchemy: "SQLAlchemy",
  pytest: "pytest",
  pydantic: "Pydantic",
  celery: "Celery",
  httpx: "HTTPX",
  uvicorn: "Uvicorn",
};

const CARGO_FRAMEWORKS: Record<string, string> = {
  "actix-web": "Actix Web",
  axum: "Axum",
  tokio: "Tokio",
  serde: "Serde",
  diesel: "Diesel",
  sqlx: "SQLx",
  warp: "Warp",
  rocket: "Rocket",
};

const GO_FRAMEWORKS: Record<string, string> = {
  "github.com/gin-gonic/gin": "Gin",
  "github.com/gofiber/fiber": "Fiber",
  "github.com/labstack/echo": "Echo",
  "gorm.io/gorm": "GORM",
  "github.com/gorilla/mux": "Gorilla Mux",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readFile(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function dedupeOrdered(arr: string[]): string[] {
  return [...new Set(arr)];
}

function detectFromKeys(
  keys: string[],
  map: Record<string, string>
): string[] {
  const found: string[] = [];
  for (const key of keys) {
    if (map[key]) found.push(map[key]);
  }
  return dedupeOrdered(found);
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

export function parsePackageJson(filePath: string): SeedInfo | null {
  const raw = readFile(filePath);
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const obj = parsed as Record<string, unknown>;
  const projectName = typeof obj.name === "string" ? obj.name : "";
  const description = typeof obj.description === "string" ? obj.description : "";

  const deps: Record<string, unknown> =
    typeof obj.dependencies === "object" && obj.dependencies !== null
      ? (obj.dependencies as Record<string, unknown>)
      : {};
  const devDeps: Record<string, unknown> =
    typeof obj.devDependencies === "object" && obj.devDependencies !== null
      ? (obj.devDependencies as Record<string, unknown>)
      : {};

  const allKeys = [...Object.keys(deps), ...Object.keys(devDeps)];
  const frameworks = detectFromKeys(allKeys, NPM_FRAMEWORKS);

  return { projectName, description, frameworks };
}

export function parsePyprojectToml(filePath: string): SeedInfo | null {
  const raw = readFile(filePath);
  if (raw === null) return null;

  // Extract [project] section name
  const nameMatch = raw.match(/\[project\][^\[]*\bname\s*=\s*"([^"]+)"/s);
  const descMatch = raw.match(
    /\[project\][^\[]*\bdescription\s*=\s*"([^"]+)"/s
  );

  const projectName = nameMatch ? nameMatch[1] : "";
  const description = descMatch ? descMatch[1] : "";

  // Simple string-match for framework detection across the whole file
  const frameworks: string[] = [];
  for (const [key, label] of Object.entries(PYTHON_FRAMEWORKS)) {
    if (raw.includes(key)) {
      frameworks.push(label);
    }
  }

  return { projectName, description, frameworks: dedupeOrdered(frameworks) };
}

export function parseCargoToml(filePath: string): SeedInfo | null {
  const raw = readFile(filePath);
  if (raw === null) return null;

  // Extract [package] section name and description
  const nameMatch = raw.match(/\[package\][^\[]*\bname\s*=\s*"([^"]+)"/s);
  const descMatch = raw.match(
    /\[package\][^\[]*\bdescription\s*=\s*"([^"]+)"/s
  );

  const projectName = nameMatch ? nameMatch[1] : "";
  const description = descMatch ? descMatch[1] : "";

  // Simple string-match across file
  const frameworks: string[] = [];
  for (const [key, label] of Object.entries(CARGO_FRAMEWORKS)) {
    if (raw.includes(key)) {
      frameworks.push(label);
    }
  }

  return { projectName, description, frameworks: dedupeOrdered(frameworks) };
}

export function parseGoMod(filePath: string): SeedInfo | null {
  const raw = readFile(filePath);
  if (raw === null) return null;

  // Extract module path — last path segment is the project name
  const moduleMatch = raw.match(/^module\s+(\S+)/m);
  const modulePath = moduleMatch ? moduleMatch[1] : "";
  const projectName = modulePath ? basename(modulePath) : "";

  // String-match require block for framework detection
  const frameworks: string[] = [];
  for (const [key, label] of Object.entries(GO_FRAMEWORKS)) {
    if (raw.includes(key)) {
      frameworks.push(label);
    }
  }

  return {
    projectName,
    description: "",
    frameworks: dedupeOrdered(frameworks),
  };
}

// ─── Seed ─────────────────────────────────────────────────────────────────────

export function seedLearningMemory(projectRoot: string): LearningMemory {
  const { join } = require("path");

  const parsers: Array<() => SeedInfo | null> = [
    () => parsePackageJson(join(projectRoot, "package.json")),
    () => parsePyprojectToml(join(projectRoot, "pyproject.toml")),
    () => parseCargoToml(join(projectRoot, "Cargo.toml")),
    () => parseGoMod(join(projectRoot, "go.mod")),
  ];

  const infos: SeedInfo[] = parsers
    .map((fn) => fn())
    .filter((info): info is SeedInfo => info !== null);

  // Pick first non-empty project name; fallback to directory basename
  const projectName =
    infos.find((i) => i.projectName)?.projectName ?? basename(projectRoot);

  const mem = createEmptyLearningMemory(projectName);

  // Add project description if available
  const infoWithDesc = infos.find((i) => i.description);
  if (infoWithDesc?.description) {
    addEntry(
      mem,
      "Key Learnings",
      `Project: ${projectName} — ${infoWithDesc.description}`
    );
  } else {
    addEntry(mem, "Key Learnings", `Project: ${projectName}`);
  }

  // Collect all detected frameworks across all parsers
  const allFrameworks = dedupeOrdered(infos.flatMap((i) => i.frameworks));
  if (allFrameworks.length > 0) {
    addEntry(
      mem,
      "Key Learnings",
      `Detected frameworks: ${allFrameworks.join(", ")}`
    );
  }

  return mem;
}
