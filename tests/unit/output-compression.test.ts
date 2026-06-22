import { describe, expect, test } from "bun:test";
import {
  detectContentKind,
  compressOutput,
} from "../../src/core/output-compression";

describe("detectContentKind", () => {
  test("Read → file", () => {
    expect(detectContentKind("Read", "anything", "a.ts")).toBe("file");
  });
  test("Grep / Glob → search", () => {
    expect(detectContentKind("Grep", "x")).toBe("search");
    expect(detectContentKind("Glob", "x")).toBe("search");
  });
  test("Bash → log", () => {
    expect(detectContentKind("Bash", "x")).toBe("log");
  });
  test("JSON content from an MCP tool → json", () => {
    expect(detectContentKind("mcp__x__y", '{"a":1}')).toBe("json");
    expect(detectContentKind("mcp__x__y", "[1,2,3]")).toBe("json");
  });
  test("non-JSON brace-leading content → text", () => {
    expect(detectContentKind("mcp__x__y", "{not json")).toBe("text");
  });
  test("plain content with no hint → text", () => {
    expect(detectContentKind("Other", "hello world")).toBe("text");
  });
});

describe("compressOutput — logs", () => {
  test("keeps a head+tail window for long logs and notes omissions", () => {
    const content = Array.from({ length: 200 }, (_, i) => `log line ${i}`).join("\n");
    const r = compressOutput("Bash", content);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("log");
    expect(r!.compressed).toContain("log line 0");
    expect(r!.compressed).toContain("log line 199");
    expect(r!.compressed).not.toContain("log line 100");
    expect(r!.compressed).toContain("omitted");
    expect(r!.compressed.length).toBeLessThan(content.length);
  });

  test("collapses runs of identical lines", () => {
    const content = ["start", ...Array(50).fill("repeated"), "end"].join("\n");
    const r = compressOutput("Bash", content);
    expect(r).not.toBeNull();
    expect(r!.compressed).toContain("(×50)");
  });

  test("strips ANSI escape codes", () => {
    const content = Array.from({ length: 100 }, (_, i) => `[31mline ${i}[0m`).join("\n");
    const r = compressOutput("Bash", content);
    expect(r!.compressed).not.toContain("[");
  });

  test("short clean logs are not worth compressing", () => {
    expect(compressOutput("Bash", "one\ntwo\nthree")).toBeNull();
  });
});

describe("compressOutput — search", () => {
  test("caps matches per file and tallies the remainder", () => {
    const lines: string[] = [];
    for (let i = 0; i < 20; i++) lines.push(`src/app.ts:${i}:  match ${i}`);
    const r = compressOutput("Grep", lines.join("\n"));
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("search");
    expect(r!.compressed).toContain("+15 more match(es) in src/app.ts");
  });

  test("removes exact duplicate lines", () => {
    const content = ["a.ts:1:foo", "a.ts:1:foo", "b.ts:2:bar"].join("\n");
    const r = compressOutput("Grep", content);
    expect(r).not.toBeNull();
    expect(r!.omittedNote).toContain("duplicate");
  });

  test("nothing to trim → null", () => {
    expect(compressOutput("Grep", "a.ts:1:x\nb.ts:2:y")).toBeNull();
  });
});

describe("compressOutput — file", () => {
  test("extracts signatures and elides the body", () => {
    const body = Array.from({ length: 100 }, (_, i) => `  const local${i} = ${i};`).join("\n");
    const content =
      "export function alpha() {}\n" +
      "export class Beta {}\n" +
      "interface Gamma {}\n" +
      body;
    const r = compressOutput("Read", content, "src/mod.ts");
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("file");
    expect(r!.compressed).toContain("structural summary");
    expect(r!.compressed).toContain("export function alpha");
    expect(r!.compressed).toContain("export class Beta");
    expect(r!.compressed).not.toContain("local50");
    expect(r!.compressed.length).toBeLessThan(content.length);
  });

  test("falls back to a text window when there is no structure", () => {
    const content = Array.from({ length: 100 }, (_, i) => `plain row ${i}`).join("\n");
    const r = compressOutput("Read", content, "data.txt");
    expect(r).not.toBeNull();
    // No signatures → generic head/tail window, still kind "file".
    expect(r!.compressed).toContain("omitted");
  });

  test("extracts markdown headings", () => {
    const content =
      "# Title\n" +
      Array.from({ length: 80 }, (_, i) => `prose line ${i}`).join("\n") +
      "\n## Section\nmore";
    const r = compressOutput("Read", content, "README.md");
    expect(r!.compressed).toContain("# Title");
    expect(r!.compressed).toContain("## Section");
  });

  test("captures class members and elides method bodies (phase 3 skeleton)", () => {
    const content =
      "export class Service {\n" +
      "  start() {\n" +
      Array.from({ length: 60 }, (_, i) => `    step${i}();`).join("\n") +
      "\n  }\n" +
      "  count: number = 0;\n" +
      "}\n";
    const r = compressOutput("Read", content, "src/service.ts");
    expect(r).not.toBeNull();
    expect(r!.compressed).toContain("export class Service {");
    expect(r!.compressed).toContain("start() { … }");
    expect(r!.compressed).toContain("count: number = 0;");
    expect(r!.compressed).not.toContain("step30");
  });
});

describe("compressOutput — json", () => {
  test("samples a long top-level array", () => {
    const arr = JSON.stringify(Array.from({ length: 200 }, (_, i) => ({ id: i })));
    const r = compressOutput("mcp__db__query", arr);
    expect(r).not.toBeNull();
    expect(r!.kind).toBe("json");
    expect(r!.omittedNote).toContain("sampled out");
    expect(r!.compressed).toContain("omitted");
  });

  test("samples large arrays nested on an object", () => {
    const obj = JSON.stringify({ results: Array.from({ length: 100 }, (_, i) => i), total: 100 });
    const r = compressOutput("mcp__db__query", obj);
    expect(r).not.toBeNull();
    expect(r!.compressed).toContain("\"total\": 100");
  });

  test("small JSON is left alone", () => {
    expect(compressOutput("mcp__db__query", '{"a":1,"b":[1,2,3]}')).toBeNull();
  });

  test("crushes arrays nested deep in the structure (phase 3)", () => {
    // Top level has only short arrays; the long arrays are two levels down, so
    // this only compresses if crushing recurses.
    const payload = JSON.stringify({
      data: [
        { rows: Array.from({ length: 100 }, (_, i) => i) },
        { rows: Array.from({ length: 100 }, (_, i) => i) },
      ],
    });
    const r = compressOutput("mcp__db__query", payload);
    expect(r).not.toBeNull();
    expect(r!.compressed).toContain("omitted");
    expect(r!.omittedNote).toContain("sampled out");
  });
});

describe("compressOutput — determinism", () => {
  test("identical input yields identical output", () => {
    const content = Array.from({ length: 200 }, (_, i) => `line ${i}`).join("\n");
    expect(compressOutput("Bash", content)).toEqual(compressOutput("Bash", content));
  });
});
