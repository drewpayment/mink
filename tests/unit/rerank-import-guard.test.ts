import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";

// Lifecycle hooks must never be able to call the relevance judge (spec 25).
// Structural guard: statically walk the relative imports reachable from each
// hook entry module and fail if any path reaches the judge modules. Type-only
// imports are erased at build time and dynamic import() is not followed, so
// neither counts as reachability.

const SRC = resolve(import.meta.dir, "../../src");
const HOOKS = ["pre-read", "post-read", "pre-write", "post-write", "post-tool", "session-start", "session-stop"].map(
  (n) => join(SRC, "commands", `${n}.ts`)
);
const FORBIDDEN = [
  join(SRC, "core/rerank.ts"),
  join(SRC, "core/relevance-judge.ts"),
  join(SRC, "core/recall-ranked.ts"),
  join(SRC, "core/judges") + "/",
];

const IMPORT_RE = /(?:^|\n)\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
const SIDE_EFFECT_IMPORT_RE = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;

function resolveRel(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const cand of [base, `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(cand) && cand.endsWith(".ts")) return cand;
  }
  return null;
}

export function staticImports(file: string): string[] {
  const text = readFileSync(file, "utf-8");
  const specs: string[] = [];
  for (const m of text.matchAll(IMPORT_RE)) {
    if (m[2]) continue; // import type / export type
    if (m[1] === "import" && /^\s*\{[^}]*\}\s*$/.test(m[3]) && !/[^{},\s]/.test(m[3].replace(/type\s+\w+(\s+as\s+\w+)?/g, ""))) {
      continue; // every specifier is `type X` — erased
    }
    specs.push(m[4]);
  }
  for (const m of text.matchAll(SIDE_EFFECT_IMPORT_RE)) specs.push(m[1]);
  return specs.filter((s) => s.startsWith(".")).flatMap((s) => resolveRel(file, s) ?? []);
}

function findPath(entry: string, isForbidden: (f: string) => boolean): string[] | null {
  const seen = new Set<string>();
  const stack: string[][] = [[entry]];
  while (stack.length) {
    const path = stack.pop()!;
    const file = path[path.length - 1];
    if (seen.has(file)) continue;
    seen.add(file);
    if (path.length > 1 && isForbidden(file)) return path;
    for (const dep of staticImports(file)) stack.push([...path, dep]);
  }
  return null;
}

const isForbidden = (f: string) => FORBIDDEN.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p));

describe("hooks never reach the relevance judge", () => {
  for (const hook of HOOKS) {
    test(`${relative(SRC, hook)} import graph avoids rerank / relevance-judge / recall-ranked / judges`, () => {
      expect(existsSync(hook)).toBe(true);
      const path = findPath(hook, isForbidden);
      expect(path === null ? null : path.map((p) => relative(SRC, p)).join(" -> ")).toBeNull();
    });
  }

  test("the guard itself works: commands/recall.ts reaches nothing forbidden statically, but a static import would be caught", () => {
    const recallCmd = join(SRC, "commands/recall.ts");
    // recall.ts uses a dynamic import, which the walker deliberately ignores.
    expect(findPath(recallCmd, isForbidden)).toBeNull();
    // Positive control: recall-ranked.ts does statically import the judge.
    expect(findPath(join(SRC, "core/recall-ranked.ts"), isForbidden)).not.toBeNull();
  });

  test("wiki-search.ts (imported by hooks) has no judge imports", () => {
    expect(findPath(join(SRC, "core/wiki-search.ts"), isForbidden)).toBeNull();
  });

  test("the walker sees real edges (sanity)", () => {
    expect(staticImports(join(SRC, "core/recall-ranked.ts")).some((f) => f.endsWith("core/rerank.ts"))).toBe(true);
  });
});
