import { describe, expect, test } from "bun:test";
import { compressOutput, detectContentKind } from "../../src/core/output-compression";

const STACK = [
  "TypeError: cannot read properties of undefined (reading 'x')",
  "    at handler (/app/src/handler.ts:22:9)",
  "    at Module._compile (node:internal/modules/cjs/loader:1234:14)",
  "    at Module.load (node:internal/modules/cjs/loader:1000:32)",
  "    at require (node:internal/modules/helpers:100:18)",
  "    at Object.<anonymous> (/app/node_modules/foo/index.js:5:1)",
  "    at main (/app/src/index.ts:10:5)",
].join("\n");

const DIFF = [
  "diff --git a/x.ts b/x.ts",
  "index 1111111..2222222 100644",
  "--- a/x.ts",
  "+++ b/x.ts",
  "@@ -1,30 +1,30 @@",
  // 24 unchanged context lines before the change → elided to a 6-line window.
  ...Array.from({ length: 24 }, (_, i) => ` const unchangedContextLine${i} = ${i};`),
  "-old line",
  "+new line",
  " const tail = 1;",
].join("\n");

const TESTOUT = [
  "PASS src/a.test.ts",
  "PASS src/b.test.ts",
  "FAIL src/c.test.ts",
  "  ✓ adds numbers (2 ms)",
  "  ✓ subtracts (1 ms)",
  "  ✗ divides by zero",
  "    Error: boom",
  "Tests: 2 passed, 1 failed, 3 total",
].join("\n");

const PKG = [
  "Collecting requests",
  "  Downloading requests-2.31.0.tar.gz (110 kB)",
  "Collecting urllib3",
  "  Using cached urllib3-2.0.tar.gz",
  "Requirement already satisfied: certifi in /usr/lib/python3",
  "npm WARN deprecated foo@1.0.0: use bar",
  "Successfully installed requests-2.31.0 urllib3-2.0",
].join("\n");

describe("detectContentKind (new shapes)", () => {
  test("git diff", () => {
    expect(detectContentKind("Bash", DIFF)).toBe("diff");
  });
  test("stack trace", () => {
    expect(detectContentKind("Bash", STACK)).toBe("stacktrace");
  });
  test("python traceback", () => {
    expect(detectContentKind("Bash", "Traceback (most recent call last):\n  File \"a.py\", line 1")).toBe("stacktrace");
  });
  test("test-runner output", () => {
    expect(detectContentKind("Bash", TESTOUT)).toBe("test");
  });
  test("package-manager output", () => {
    expect(detectContentKind("Bash", PKG)).toBe("package");
  });
  test("plain bash still logs", () => {
    expect(detectContentKind("Bash", "just\nsome\nplain\noutput")).toBe("log");
  });
});

describe("compressOutput — stack traces", () => {
  test("collapses framework frames, keeps app frames + error head", () => {
    const r = compressOutput("Bash", STACK)!;
    expect(r.kind).toBe("stacktrace");
    expect(r.compressed).toContain("TypeError: cannot read");
    expect(r.compressed).toContain("src/handler.ts:22:9");
    expect(r.compressed).toContain("src/index.ts:10:5");
    expect(r.compressed).toContain("framework frame(s) omitted");
    expect(r.compressed).not.toContain("node:internal/modules/cjs/loader");
    expect(r.compressed).not.toContain("node_modules/foo");
    expect(r.compressed.length).toBeLessThan(STACK.length);
  });
});

describe("compressOutput — diffs", () => {
  test("keeps headers + changes, elides unchanged context", () => {
    const r = compressOutput("Bash", DIFF)!;
    expect(r.kind).toBe("diff");
    expect(r.compressed).toContain("diff --git a/x.ts b/x.ts");
    expect(r.compressed).toContain("@@ -1,30 +1,30 @@");
    expect(r.compressed).toContain("-old line");
    expect(r.compressed).toContain("+new line");
    expect(r.compressed).toContain("unchanged line(s) omitted");
    expect(r.compressed).not.toContain("unchangedContextLine12"); // a middle context line dropped
  });
});

describe("compressOutput — test output", () => {
  test("drops passing noise, keeps failures + summary", () => {
    const r = compressOutput("Bash", TESTOUT)!;
    expect(r.kind).toBe("test");
    expect(r.compressed).toContain("FAIL src/c.test.ts");
    expect(r.compressed).toContain("divides by zero");
    expect(r.compressed).toContain("Tests: 2 passed, 1 failed");
    expect(r.compressed).not.toContain("PASS src/a.test.ts");
    expect(r.compressed).not.toContain("✓ adds numbers");
  });
});

describe("compressOutput — package manager", () => {
  test("drops progress spam, keeps result + warnings", () => {
    const r = compressOutput("Bash", PKG)!;
    expect(r.kind).toBe("package");
    expect(r.compressed).toContain("Successfully installed requests");
    expect(r.compressed).toContain("npm WARN deprecated");
    expect(r.compressed).not.toContain("Downloading requests-2.31.0");
    expect(r.compressed).not.toContain("Using cached");
  });
});

describe("reversibility contract", () => {
  test("every compressed result is strictly smaller than its input", () => {
    for (const input of [STACK, DIFF, TESTOUT, PKG]) {
      const r = compressOutput("Bash", input)!;
      expect(r.compressed.length).toBeLessThan(input.length);
    }
  });
});
