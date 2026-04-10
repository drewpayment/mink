import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  parsePackageJson,
  parsePyprojectToml,
  parseCargoToml,
  parseGoMod,
  seedLearningMemory,
} from "../../src/core/seed";

// ─── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mink-seed-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function writeTmp(filename: string, content: string): string {
  const filePath = join(tmpDir, filename);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ─── parsePackageJson ─────────────────────────────────────────────────────────

describe("parsePackageJson", () => {
  test("extracts name, description, and frameworks", () => {
    const filePath = writeTmp(
      "package.json",
      JSON.stringify({
        name: "my-app",
        description: "A cool app",
        dependencies: {
          react: "^18.0.0",
          express: "^4.0.0",
        },
        devDependencies: {
          typescript: "^5.0.0",
          vitest: "^1.0.0",
        },
      })
    );

    const info = parsePackageJson(filePath);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe("my-app");
    expect(info!.description).toBe("A cool app");
    expect(info!.frameworks).toContain("React");
    expect(info!.frameworks).toContain("Express");
    expect(info!.frameworks).toContain("TypeScript");
    expect(info!.frameworks).toContain("Vitest");
  });

  test("handles missing description", () => {
    const filePath = writeTmp(
      "package.json",
      JSON.stringify({
        name: "no-desc",
        dependencies: { next: "^14.0.0" },
      })
    );

    const info = parsePackageJson(filePath);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe("no-desc");
    expect(info!.description).toBe("");
    expect(info!.frameworks).toContain("Next.js");
  });

  test("returns null for missing file", () => {
    const info = parsePackageJson(join(tmpDir, "nonexistent.json"));
    expect(info).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    const filePath = writeTmp("package.json", "{ not valid json }}}");
    const info = parsePackageJson(filePath);
    expect(info).toBeNull();
  });

  test("handles missing dependencies gracefully", () => {
    const filePath = writeTmp(
      "package.json",
      JSON.stringify({ name: "bare", description: "bare project" })
    );
    const info = parsePackageJson(filePath);
    expect(info).not.toBeNull();
    expect(info!.frameworks).toEqual([]);
  });

  test("deduplicates frameworks (react and react-dom both map to React)", () => {
    const filePath = writeTmp(
      "package.json",
      JSON.stringify({
        name: "dedupe-test",
        dependencies: { react: "^18", "react-dom": "^18" },
      })
    );
    const info = parsePackageJson(filePath);
    expect(info!.frameworks.filter((f) => f === "React")).toHaveLength(1);
  });
});

// ─── parsePyprojectToml ───────────────────────────────────────────────────────

describe("parsePyprojectToml", () => {
  test("extracts name, description, and frameworks from [project] section", () => {
    const filePath = writeTmp(
      "pyproject.toml",
      `[project]
name = "my-python-app"
description = "A FastAPI service"
dependencies = [
  "fastapi>=0.100",
  "sqlalchemy>=2.0",
  "uvicorn",
]
`
    );

    const info = parsePyprojectToml(filePath);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe("my-python-app");
    expect(info!.description).toBe("A FastAPI service");
    expect(info!.frameworks).toContain("FastAPI");
    expect(info!.frameworks).toContain("SQLAlchemy");
    expect(info!.frameworks).toContain("Uvicorn");
  });

  test("returns null for missing file", () => {
    const info = parsePyprojectToml(join(tmpDir, "pyproject.toml"));
    expect(info).toBeNull();
  });

  test("returns empty strings when fields are absent", () => {
    const filePath = writeTmp("pyproject.toml", `[build-system]\nrequires = []\n`);
    const info = parsePyprojectToml(filePath);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe("");
    expect(info!.description).toBe("");
  });
});

// ─── parseCargoToml ───────────────────────────────────────────────────────────

describe("parseCargoToml", () => {
  test("extracts name, description, and frameworks from [package] section", () => {
    const filePath = writeTmp(
      "Cargo.toml",
      `[package]
name = "my-rust-app"
description = "An Axum service"
version = "0.1.0"

[dependencies]
axum = "0.7"
tokio = { version = "1", features = ["full"] }
serde = { version = "1", features = ["derive"] }
`
    );

    const info = parseCargoToml(filePath);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe("my-rust-app");
    expect(info!.description).toBe("An Axum service");
    expect(info!.frameworks).toContain("Axum");
    expect(info!.frameworks).toContain("Tokio");
    expect(info!.frameworks).toContain("Serde");
  });

  test("returns null for missing file", () => {
    const info = parseCargoToml(join(tmpDir, "Cargo.toml"));
    expect(info).toBeNull();
  });

  test("returns empty strings when fields are absent", () => {
    const filePath = writeTmp("Cargo.toml", `[workspace]\nmembers = []\n`);
    const info = parseCargoToml(filePath);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe("");
    expect(info!.description).toBe("");
  });
});

// ─── parseGoMod ───────────────────────────────────────────────────────────────

describe("parseGoMod", () => {
  test("extracts module name (last segment) and frameworks", () => {
    const filePath = writeTmp(
      "go.mod",
      `module github.com/acme/my-service

go 1.21

require (
  github.com/gin-gonic/gin v1.9.0
  gorm.io/gorm v1.25.0
)
`
    );

    const info = parseGoMod(filePath);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe("my-service");
    expect(info!.frameworks).toContain("Gin");
    expect(info!.frameworks).toContain("GORM");
  });

  test("returns null for missing file", () => {
    const info = parseGoMod(join(tmpDir, "go.mod"));
    expect(info).toBeNull();
  });

  test("handles simple module path (no slashes)", () => {
    const filePath = writeTmp("go.mod", `module mymodule\n\ngo 1.21\n`);
    const info = parseGoMod(filePath);
    expect(info).not.toBeNull();
    expect(info!.projectName).toBe("mymodule");
  });

  test("description is always empty string", () => {
    const filePath = writeTmp(
      "go.mod",
      `module github.com/acme/svc\n\ngo 1.21\n`
    );
    const info = parseGoMod(filePath);
    expect(info!.description).toBe("");
  });
});

// ─── seedLearningMemory ───────────────────────────────────────────────────────

describe("seedLearningMemory", () => {
  test("seeds from package.json", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        name: "seed-app",
        description: "My seeded app",
        dependencies: { react: "^18", next: "^14" },
      })
    );

    const mem = seedLearningMemory(tmpDir);
    expect(mem.projectName).toBe("seed-app");
    const kl = mem.sections["Key Learnings"];
    expect(kl.some((e) => e.includes("seed-app"))).toBe(true);
    expect(kl.some((e) => e.includes("My seeded app"))).toBe(true);
    expect(kl.some((e) => e.includes("React"))).toBe(true);
    expect(kl.some((e) => e.includes("Next.js"))).toBe(true);
  });

  test("seeds from multiple project files, deduplicates frameworks", () => {
    // Write both package.json and Cargo.toml to test multi-file merging
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({
        name: "multi-project",
        description: "Hybrid app",
        dependencies: { express: "^4" },
      })
    );
    writeFileSync(
      join(tmpDir, "Cargo.toml"),
      `[package]\nname = "multi-project-rs"\ndescription = "Rust side"\n\n[dependencies]\naxum = "0.7"\n`
    );

    const mem = seedLearningMemory(tmpDir);
    // First parser with a name wins
    expect(mem.projectName).toBe("multi-project");
    const kl = mem.sections["Key Learnings"];
    // Frameworks from both parsers should appear
    expect(kl.some((e) => e.includes("Express"))).toBe(true);
    expect(kl.some((e) => e.includes("Axum"))).toBe(true);
  });

  test("falls back to directory name when no project files found", () => {
    // tmpDir has no package.json, pyproject.toml, Cargo.toml, or go.mod
    const mem = seedLearningMemory(tmpDir);
    // Project name should be the directory basename
    const dirName = require("path").basename(tmpDir);
    expect(mem.projectName).toBe(dirName);
    const kl = mem.sections["Key Learnings"];
    expect(kl.some((e) => e.includes(dirName))).toBe(true);
  });

  test("no Detected frameworks entry when none detected", () => {
    writeFileSync(
      join(tmpDir, "package.json"),
      JSON.stringify({ name: "empty-deps", description: "No deps" })
    );

    const mem = seedLearningMemory(tmpDir);
    const kl = mem.sections["Key Learnings"];
    expect(kl.some((e) => e.startsWith("Detected frameworks:"))).toBe(false);
  });

  test("returns a LearningMemory with correct structure", () => {
    const mem = seedLearningMemory(tmpDir);
    expect(mem).toHaveProperty("projectName");
    expect(mem).toHaveProperty("sections");
    expect(mem.sections).toHaveProperty("User Preferences");
    expect(mem.sections).toHaveProperty("Key Learnings");
    expect(mem.sections).toHaveProperty("Do-Not-Repeat");
    expect(mem.sections).toHaveProperty("Decision Log");
  });
});
