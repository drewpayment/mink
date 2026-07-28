import { describe, expect, test } from "bun:test";
import { buildMinkCommand, relativePathFor } from "../../ide/vscode/src/cli-bridge";

describe("buildMinkCommand", () => {
  test("context", () => {
    expect(buildMinkCommand("context").args).toEqual(["context"]);
  });

  test("bug-search builds `bug search <query>`", () => {
    expect(buildMinkCommand("bug-search", "null deref").args).toEqual(["bug", "search", "null deref"]);
  });

  test("similar builds `similar --files=<file>`", () => {
    expect(buildMinkCommand("similar", "src/a.ts").args).toEqual(["similar", "--files=src/a.ts"]);
  });

  test("note builds `note <text>`", () => {
    expect(buildMinkCommand("note", "remember this").args).toEqual(["note", "remember this"]);
  });

  test.each([
    ["bug-search", "bug-search"],
    ["similar", "similar"],
    ["note", "note"],
  ] as const)("%s throws on empty input", (action) => {
    expect(() => buildMinkCommand(action, "   ")).toThrow();
  });

  test("every command carries a human title", () => {
    expect(buildMinkCommand("context").title.length).toBeGreaterThan(0);
    expect(buildMinkCommand("bug-search", "x").title).toContain("x");
  });
});

describe("relativePathFor", () => {
  test("makes a workspace-relative path", () => {
    expect(relativePathFor("/home/u/proj", "/home/u/proj/src/a.ts")).toBe("src/a.ts");
  });
  test("tolerates a trailing slash on the root", () => {
    expect(relativePathFor("/home/u/proj/", "/home/u/proj/src/a.ts")).toBe("src/a.ts");
  });
  test("leaves a path outside the workspace unchanged", () => {
    expect(relativePathFor("/home/u/proj", "/etc/hosts")).toBe("/etc/hosts");
  });
  test("root itself maps to empty", () => {
    expect(relativePathFor("/home/u/proj", "/home/u/proj")).toBe("");
  });
});
