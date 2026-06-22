import { describe, expect, test } from "bun:test";
import { extractCodeSkeleton } from "../../src/core/code-skeleton";

describe("extractCodeSkeleton", () => {
  test("elides a top-level function body", () => {
    const src = [
      "export function add(a, b) {",
      "  const x = a + b;",
      "  return x;",
      "}",
    ].join("\n");
    const skel = extractCodeSkeleton(src);
    expect(skel).not.toBeNull();
    expect(skel!.lines).toEqual(["export function add(a, b) { … }"]);
  });

  test("descends into a class and captures member signatures with bodies elided", () => {
    const src = [
      "class Foo {",
      "  bar() {",
      "    doThing();",
      "  }",
      "  baz: number = 1;",
      "}",
    ].join("\n");
    const skel = extractCodeSkeleton(src);
    expect(skel!.lines).toEqual([
      "class Foo {",
      "  bar() { … }",
      "  baz: number = 1;",
    ]);
    expect(skel!.lines.join("\n")).not.toContain("doThing");
  });

  test("captures interface fields", () => {
    const src = ["interface I {", "  name: string;", "  greet(): void;", "}"].join("\n");
    const skel = extractCodeSkeleton(src);
    expect(skel!.lines).toEqual([
      "interface I {",
      "  name: string;",
      "  greet(): void;",
    ]);
  });

  test("captures exported vars but not bare ones", () => {
    const src = 'export const API = "x";\nconst secret = "y";';
    const skel = extractCodeSkeleton(src);
    expect(skel!.lines).toEqual(['export const API = "x";']);
  });

  test("masks braces inside strings so depth tracking does not desync", () => {
    const src = [
      "export function f() {",
      '  log("{{{");', // stray braces inside a string, inside an elided body
      "}",
      "export const visible = 1;",
    ].join("\n");
    const skel = extractCodeSkeleton(src);
    // If string braces leaked into depth tracking, `visible` would be swallowed.
    expect(skel!.lines).toEqual([
      "export function f() { … }",
      "export const visible = 1;",
    ]);
  });

  test("honours markdown headings only when markdown is set", () => {
    const src = "# Title\n\nsome prose\n## Section";
    expect(extractCodeSkeleton(src, { markdown: true })!.lines).toEqual([
      "# Title",
      "## Section",
    ]);
    // Without the markdown flag, '#' lines are treated as comments → no structure.
    expect(extractCodeSkeleton(src)).toBeNull();
  });

  test("returns null when there is no structure", () => {
    expect(extractCodeSkeleton("just\nplain\ntext\nlines")).toBeNull();
  });

  test("counts total lines ignoring a trailing newline", () => {
    const skel = extractCodeSkeleton("export const a = 1;\n");
    expect(skel!.totalLines).toBe(1);
  });

  test("is deterministic", () => {
    const src = "class A {\n  m() { x(); }\n}\nexport function g() { y(); }";
    expect(extractCodeSkeleton(src)).toEqual(extractCodeSkeleton(src));
  });

  test("handles Python def/class without braces", () => {
    const src = [
      "class Service:",
      "    def handle(self):",
      "        return 1",
      "    def stop(self):",
      "        pass",
    ].join("\n");
    const skel = extractCodeSkeleton(src);
    const joined = skel!.lines.join("\n");
    expect(joined).toContain("class Service:");
    expect(joined).toContain("def handle(self):");
    expect(joined).not.toContain("return 1");
  });
});
