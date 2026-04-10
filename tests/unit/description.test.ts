import { describe, expect, test } from "bun:test";
import { extractDescription } from "../../src/core/description";

describe("extractDescription", () => {
  describe("edge cases", () => {
    test("empty file returns filename with empty note", () => {
      const result = extractDescription("src/empty.ts", "");
      expect(result).toBe("empty.ts — empty file");
    });

    test("binary file returns filename with binary note", () => {
      const result = extractDescription("image.png", "PNG\0IHDR\0\0");
      expect(result).toBe("image.png — binary file");
    });

    test("truncates long descriptions to 100 chars", () => {
      const longLine = "a".repeat(200);
      const result = extractDescription("src/long.ts", longLine);
      expect(result.length).toBeLessThanOrEqual(100);
      expect(result).toEndWith("...");
    });

    test("large file adds (large file) suffix", () => {
      // 101KB of content
      const content = "export function bigFn() {}\n" + "x".repeat(101 * 1024);
      const result = extractDescription("src/big.ts", content);
      expect(result).toContain("(large file)");
    });
  });

  describe("priority 1: markdown heading", () => {
    test("extracts h1 from markdown", () => {
      const content = "# My Awesome Module\n\nSome content here.";
      const result = extractDescription("README.md", content);
      expect(result).toBe("My Awesome Module");
    });

    test("extracts h1 from mdx", () => {
      const content = "import X from 'y'\n\n# Component Guide\n\nText.";
      const result = extractDescription("guide.mdx", content);
      expect(result).toBe("Component Guide");
    });

    test("prefers h1 over other heuristics for .md files", () => {
      const content = "# Title\n\nexport function foo() {}";
      const result = extractDescription("doc.md", content);
      expect(result).toBe("Title");
    });
  });

  describe("priority 3: doc comment", () => {
    test("extracts JSDoc comment", () => {
      const content = `/**
 * Handles user authentication flows
 */
export function auth() {}`;
      const result = extractDescription("src/auth.ts", content);
      expect(result).toBe("Handles user authentication flows");
    });

    test("extracts shell comment after shebang", () => {
      const content = `#!/bin/bash
# Deploy script for production
set -e`;
      const result = extractDescription("deploy.sh", content);
      expect(result).toBe("Deploy script for production");
    });

    test("extracts top-of-file hash comment", () => {
      const content = `# Utility functions for string manipulation
def capitalize(s):
    return s.capitalize()`;
      const result = extractDescription("utils.py", content);
      expect(result).toBe("Utility functions for string manipulation");
    });
  });

  describe("priority 4: exports", () => {
    test("extracts exported function names", () => {
      const content = `export function createUser() {}
export function deleteUser() {}`;
      const result = extractDescription("src/users.ts", content);
      expect(result).toBe("exports: createUser, deleteUser");
    });

    test("extracts mixed export types", () => {
      const content = `export interface Config {}
export const DEFAULT_CONFIG = {};
export function loadConfig() {}`;
      const result = extractDescription("src/config.ts", content);
      expect(result).toBe("exports: Config, DEFAULT_CONFIG, loadConfig");
    });

    test("extracts exported class", () => {
      const content = `export class UserService {
  getUser() {}
}`;
      const result = extractDescription("src/user-service.ts", content);
      expect(result).toBe("exports: UserService");
    });

    test("extracts exported enum", () => {
      const content = `export enum Status {
  Active,
  Inactive,
}`;
      const result = extractDescription("src/status.ts", content);
      expect(result).toBe("exports: Status");
    });

    test("extracts exported type", () => {
      const content = `export type UserId = string;
export type UserName = string;`;
      const result = extractDescription("src/types.ts", content);
      expect(result).toBe("exports: UserId, UserName");
    });
  });

  describe("priority 6: known config files", () => {
    test("identifies package.json", () => {
      const content = `{ "name": "my-app", "version": "1.0.0" }`;
      const result = extractDescription("package.json", content);
      expect(result).toBe("Node.js package manifest");
    });

    test("identifies tsconfig.json", () => {
      const content = `{ "compilerOptions": {} }`;
      const result = extractDescription("tsconfig.json", content);
      expect(result).toBe("TypeScript configuration");
    });

    test("identifies Dockerfile", () => {
      const content = "FROM node:20\nRUN npm install";
      const result = extractDescription("Dockerfile", content);
      expect(result).toBe("Docker container definition");
    });

    test("identifies Cargo.toml", () => {
      const content = `[package]\nname = "my-crate"`;
      const result = extractDescription("Cargo.toml", content);
      expect(result).toBe("Rust package manifest");
    });

    test("identifies bunfig.toml", () => {
      const content = `[install]\noptional = true`;
      const result = extractDescription("bunfig.toml", content);
      expect(result).toBe("Bun configuration");
    });
  });

  describe("priority 9: fallback", () => {
    test("uses first non-comment line as fallback", () => {
      const content = `const x = 42;`;
      const result = extractDescription("src/mystery.dat", content);
      expect(result).toBe("const x = 42;");
    });

    test("skips comment lines for fallback", () => {
      const content = `// this is a comment
// another comment
const setup = true;`;
      // No exports, no doc comment (// is not doc comment), no config match
      const result = extractDescription("src/setup.xyz", content);
      expect(result).toBe("const setup = true;");
    });

    test("returns filename when no content matches", () => {
      const content = "// only comments\n# only comments";
      const result = extractDescription("src/empty-ish.xyz", content);
      // Both lines start with comment chars, fallback skips them
      // Final fallback is the filename
      expect(result).toBe("empty-ish.xyz");
    });
  });

  describe("priority ordering", () => {
    test("doc comment wins over exports when present", () => {
      const content = `/**
 * Authentication utilities
 */
export function login() {}
export function logout() {}`;
      const result = extractDescription("src/auth.ts", content);
      expect(result).toBe("Authentication utilities");
    });

    test("exports win over config description when file has exports", () => {
      // A file named like a config but with TS exports
      const content = `export function validate() {}`;
      const result = extractDescription("src/validate.ts", content);
      expect(result).toBe("exports: validate");
    });
  });

  describe("priority 2: HTML title", () => {
    test("extracts title from HTML file", () => {
      const content = `<!DOCTYPE html>
<html>
<head><title>My App Dashboard</title></head>
<body></body>
</html>`;
      const result = extractDescription("index.html", content);
      expect(result).toBe("My App Dashboard");
    });

    test("extracts title from htm file", () => {
      const content = `<html><head><title>Legacy Page</title></head></html>`;
      const result = extractDescription("page.htm", content);
      expect(result).toBe("Legacy Page");
    });
  });

  describe("priority 5: component with elements", () => {
    test("detects form in tsx component", () => {
      const content = `export default function LoginForm() {
  return <form><input type="text" /></form>;
}`;
      const result = extractDescription("LoginForm.tsx", content);
      expect(result).toBe("LoginForm — renders form, inputs");
    });

    test("detects table in jsx component", () => {
      const content = `export function DataTable() {
  return <table><tr><td>data</td></tr></table>;
}`;
      const result = extractDescription("DataTable.jsx", content);
      expect(result).toBe("DataTable — renders table");
    });

    test("detects modal in tsx component", () => {
      const content = `export const ConfirmModal = () => {
  return <div className="modal">Confirm?</div>;
}`;
      const result = extractDescription("ConfirmModal.tsx", content);
      expect(result).toBe("ConfirmModal — renders modal");
    });

    test("detects list elements", () => {
      const content = `export function NavMenu() {
  return <ul><li>Home</li><li>About</li></ul>;
}`;
      const result = extractDescription("NavMenu.tsx", content);
      expect(result).toBe("NavMenu — renders list");
    });

    test("uses basename when no named export found", () => {
      const content = `const x = () => <form><input /></form>;
export default x;`;
      const result = extractDescription("ContactForm.tsx", content);
      expect(result).toBe("ContactForm — renders form, inputs");
    });

    test("does not trigger for non-component extensions", () => {
      const content = `export function handler() { return "<form></form>"; }`;
      const result = extractDescription("handler.ts", content);
      // Should use exports priority, not component
      expect(result).toBe("exports: handler");
    });
  });

  describe("priority 7: CI/CD workflows", () => {
    test("extracts workflow name from GitHub Actions", () => {
      const content = `name: Build and Deploy
on: push
jobs:
  build:
    runs-on: ubuntu-latest`;
      const result = extractDescription(
        ".github/workflows/deploy.yml",
        content
      );
      expect(result).toBe("CI: Build and Deploy");
    });

    test("uses filename when no name field", () => {
      const content = `on: push
jobs:
  test:
    runs-on: ubuntu-latest`;
      const result = extractDescription(
        ".github/workflows/ci.yml",
        content
      );
      expect(result).toBe("CI: ci.yml");
    });

    test("detects GitLab CI file", () => {
      const content = `stages:
  - build
  - test`;
      const result = extractDescription(".gitlab-ci.yml", content);
      expect(result).toBe("CI: .gitlab-ci.yml");
    });

    test("detects Jenkinsfile", () => {
      const content = `pipeline {
  agent any
  stages {
    stage('Build') { steps { sh 'make' } }
  }
}`;
      const result = extractDescription("Jenkinsfile", content);
      expect(result).toBe("CI: Jenkinsfile");
    });
  });

  describe("priority 8: migrations", () => {
    test("extracts table name from CREATE TABLE", () => {
      const content = `CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);`;
      const result = extractDescription(
        "db/migrations/001_create_users.sql",
        content
      );
      expect(result).toBe("migration: create users");
    });

    test("uses filename when no CREATE TABLE found", () => {
      const content = `ALTER TABLE users ADD COLUMN email TEXT;`;
      const result = extractDescription(
        "db/migrations/002_add_email.sql",
        content
      );
      expect(result).toBe("migration: 002_add_email.sql");
    });

    test("detects migration in path with migrate keyword", () => {
      const content = `CREATE TABLE posts (id INT);`;
      const result = extractDescription(
        "src/migrate/003_posts.sql",
        content
      );
      expect(result).toBe("migration: create posts");
    });
  });
});
