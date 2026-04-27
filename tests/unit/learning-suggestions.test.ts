import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  loadSuggestions,
  saveSuggestions,
  addSuggestions,
  acceptSuggestion,
  rejectSuggestion,
  pendingCount,
  newSuggestion,
} from "../../src/core/learning-suggestions";
import {
  learningMemoryPath,
  learningSuggestionsPath,
  projectDir,
} from "../../src/core/paths";
import { loadMeta, getMetaForEntry } from "../../src/core/learning-memory-meta";

function makeCwd(): string {
  return mkdtempSync(join(tmpdir(), "mink-sugg-test-"));
}

const createdProjectDirs: string[] = [];

function trackCwd(cwd: string) {
  createdProjectDirs.push(projectDir(cwd));
}

afterEach(() => {
  for (const p of createdProjectDirs.splice(0)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("addSuggestions", () => {
  test("dedupes by section + normalized text", () => {
    const cwd = makeCwd();
    trackCwd(cwd);
    const items = [
      {
        section: "Key Learnings" as const,
        text: "Use Bun",
        confidence: 0.5,
        rationale: "",
        source: "llm:auto" as const,
        sourceSessionIds: [],
      },
      {
        section: "Key Learnings" as const,
        text: "  use bun ",
        confidence: 0.5,
        rationale: "",
        source: "llm:auto" as const,
        sourceSessionIds: [],
      },
    ];
    const added = addSuggestions(cwd, items);
    expect(added).toHaveLength(1);
    const store = loadSuggestions(cwd);
    expect(store.suggestions).toHaveLength(1);
  });

  test("persists pending suggestions to sidecar", () => {
    const cwd = makeCwd();
    trackCwd(cwd);
    addSuggestions(cwd, [
      {
        section: "Do-Not-Repeat",
        text: "Skip linting",
        confidence: 0.4,
        rationale: "",
        source: "llm:auto",
        sourceSessionIds: [],
      },
    ]);
    expect(existsSync(learningSuggestionsPath(cwd))).toBe(true);
    const raw = JSON.parse(readFileSync(learningSuggestionsPath(cwd), "utf-8"));
    expect(raw.suggestions[0].status).toBe("pending");
  });
});

describe("acceptSuggestion", () => {
  test("moves a suggestion into learning-memory.md and writes meta", () => {
    const cwd = makeCwd();
    trackCwd(cwd);
    const [s] = addSuggestions(cwd, [
      {
        section: "Key Learnings",
        text: "Bun is the runtime",
        confidence: 0.6,
        rationale: "evidence",
        source: "llm:auto",
        sourceSessionIds: ["s1"],
      },
    ]);
    const result = acceptSuggestion(cwd, s.id);
    expect(result).not.toBeNull();
    expect(result?.section).toBe("Key Learnings");
    const md = readFileSync(learningMemoryPath(cwd), "utf-8");
    expect(md).toContain("Bun is the runtime");
    const meta = loadMeta(cwd);
    expect(
      getMetaForEntry(meta, "Key Learnings", "Bun is the runtime")?.source
    ).toBe("llm:auto");
    const store = loadSuggestions(cwd);
    expect(store.suggestions[0].status).toBe("accepted");
  });

  test("respects edits and tags as llm:refined", () => {
    const cwd = makeCwd();
    trackCwd(cwd);
    const [s] = addSuggestions(cwd, [
      {
        section: "Key Learnings",
        text: "use bun",
        confidence: 0.6,
        rationale: "",
        source: "llm:auto",
        sourceSessionIds: [],
      },
    ]);
    const result = acceptSuggestion(cwd, s.id, {
      section: "User Preferences",
      text: "Always reach for Bun first",
    });
    expect(result?.section).toBe("User Preferences");
    expect(result?.text).toBe("Always reach for Bun first");
    const meta = loadMeta(cwd);
    expect(
      getMetaForEntry(meta, "User Preferences", "Always reach for Bun first")?.source
    ).toBe("llm:refined");
  });

  test("returns null when suggestion is missing or already resolved", () => {
    const cwd = makeCwd();
    trackCwd(cwd);
    expect(acceptSuggestion(cwd, "nope")).toBeNull();
  });
});

describe("rejectSuggestion", () => {
  test("marks pending as rejected and is idempotent", () => {
    const cwd = makeCwd();
    trackCwd(cwd);
    const [s] = addSuggestions(cwd, [
      {
        section: "User Preferences",
        text: "Foo",
        confidence: 0.3,
        rationale: "",
        source: "llm:auto",
        sourceSessionIds: [],
      },
    ]);
    expect(rejectSuggestion(cwd, s.id)).toBe(true);
    expect(rejectSuggestion(cwd, s.id)).toBe(true);
    const store = loadSuggestions(cwd);
    expect(store.suggestions[0].status).toBe("rejected");
  });

  test("returns false when id is unknown", () => {
    const cwd = makeCwd();
    trackCwd(cwd);
    expect(rejectSuggestion(cwd, "missing")).toBe(false);
  });
});

describe("pendingCount", () => {
  test("counts only pending suggestions", () => {
    const store = {
      version: 1 as const,
      suggestions: [
        newSuggestion({
          section: "Key Learnings",
          text: "a",
          confidence: 0.1,
          rationale: "",
          source: "llm:auto",
          sourceSessionIds: [],
        }),
        {
          ...newSuggestion({
            section: "Key Learnings",
            text: "b",
            confidence: 0.1,
            rationale: "",
            source: "llm:auto",
            sourceSessionIds: [],
          }),
          status: "accepted" as const,
        },
      ],
    };
    expect(pendingCount(store)).toBe(1);
  });
});

describe("saveSuggestions", () => {
  test("writes JSON atomically", () => {
    const cwd = makeCwd();
    trackCwd(cwd);
    saveSuggestions(cwd, { version: 1, suggestions: [] });
    expect(existsSync(learningSuggestionsPath(cwd))).toBe(true);
  });
});
