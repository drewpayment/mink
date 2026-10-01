import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const template = readFileSync(join(root, "agents", "mink-agent.md.tmpl"), "utf-8");
const skill = readFileSync(join(root, "skills", "mink-note", "SKILL.md"), "utf-8");

// Mirrors renderTemplate() in src/commands/agent.ts.
function render(t: string): string {
  const vars: Record<string, string> = {
    MINK_ROOT: "/home/u/.mink",
    VAULT_PATH: "/home/u/vault",
    MINK_VERSION: "9.9.9",
  };
  let out = t;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{{${k}}}`).join(v);
  return out;
}

describe("mink-agent template retrieval playbook", () => {
  const rendered = render(template);

  test("renders with no unresolved placeholders", () => {
    expect(rendered.match(/\{\{[A-Z_]+\}\}/g)).toBeNull();
  });

  test("documents the retrieval envelope and modes", () => {
    expect(rendered).toContain("retrieval.ranker");
    expect(rendered).toContain("empty_reason");
    expect(rendered).toContain("--wide");
    expect(rendered).toContain("fallback_reason");
    expect(rendered).toContain("relevance");
  });

  test("never instructs the agent to pass --rerank by default", () => {
    // Every mention of --rerank must be in a prohibition / user-request context.
    const lines = rendered.split("\n").filter((l) => l.includes("--rerank"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/never|only pass|explicitly asks/i);
    expect(rendered).not.toMatch(/mink recall[^\n`]*--rerank/);
  });
});

describe("mink-note skill", () => {
  test("covers judge-aware duplicate check and new flags, without defaulting to --rerank", () => {
    expect(skill).toContain("retrieval.ranker");
    expect(skill).toContain("--wide");
    expect(skill).toContain("--min-relevance");
    expect(skill).toContain("mink note search");
    expect(skill).not.toMatch(/mink recall --json[^\n]*--rerank/);
  });
});
