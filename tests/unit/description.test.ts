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
});
