import { describe, test, expect } from "bun:test";
import { deriveMemoryModel, createMemoryScreen, type MemoryModel } from "../../../src/tui/memory-screen";
import { contentRows } from "../../../src/tui/shell";
import type { ScreenUiState } from "../../../src/tui/screen-registry";
import type { BugLogPayload } from "../../../src/types/dashboard";
import type { BugEntry } from "../../../src/types/bug-memory";
import type { LearningMemory } from "../../../src/types/learning-memory";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeState(overrides: Partial<ScreenUiState> = {}): ScreenUiState {
  return { scrollOffset: 0, selectedIndex: 0, lastRefresh: "14:32:05", ...overrides };
}

function makeBug(overrides: Partial<BugEntry> = {}): BugEntry {
  return {
    id: "bug-1",
    createdAt: "2026-07-01T10:00:00.000Z",
    lastSeenAt: "2026-07-05T10:00:00.000Z",
    errorMessage: "TypeError: cannot read property of undefined",
    filePath: "src/foo.ts",
    lineNumber: 42,
    rootCause: "missing null check on the response payload",
    fixDescription: "",
    tags: ["typescript"],
    occurrenceCount: 3,
    relatedBugIds: [],
    ...overrides,
  };
}

function makeBugLogPayload(entries: BugEntry[]): BugLogPayload {
  return { entries, nextId: entries.length + 1 };
}

function makeLearningMemory(overrides: Partial<LearningMemory["sections"]> = {}): LearningMemory {
  return {
    projectName: "mink",
    sections: {
      "User Preferences": [],
      "Key Learnings": [],
      "Do-Not-Repeat": [],
      "Decision Log": [],
      ...overrides,
    },
  };
}

// ── Derivation ───────────────────────────────────────────────────────────

describe("deriveMemoryModel", () => {
  test("maps bug entries and flags fixed vs. open via fixDescription", () => {
    const model = deriveMemoryModel(
      makeBugLogPayload([
        makeBug({ id: "bug-open", fixDescription: "" }),
        makeBug({ id: "bug-fixed", fixDescription: "added a null check" }),
      ]),
      makeLearningMemory(),
    );
    const open = model.bugs.find((b) => b.id === "bug-open")!;
    const fixed = model.bugs.find((b) => b.id === "bug-fixed")!;
    expect(open.isFixed).toBe(false);
    expect(fixed.isFixed).toBe(true);
  });

  test("sorts bugs newest-lastSeen first", () => {
    const model = deriveMemoryModel(
      makeBugLogPayload([
        makeBug({ id: "old", lastSeenAt: "2026-01-01T00:00:00.000Z" }),
        makeBug({ id: "new", lastSeenAt: "2026-07-01T00:00:00.000Z" }),
      ]),
      makeLearningMemory(),
    );
    expect(model.bugs.map((b) => b.id)).toEqual(["new", "old"]);
  });

  test("flattens learning-memory sections in a fixed order, tagging each line with its section", () => {
    const model = deriveMemoryModel(
      makeBugLogPayload([]),
      makeLearningMemory({
        "Key Learnings": ["always run typecheck before committing"],
        "Do-Not-Repeat": ["never push to main"],
        "User Preferences": ["prefers concise commit messages"],
        "Decision Log": ["chose bun over node for the CLI runtime"],
      }),
    );
    expect(model.learnings).toEqual([
      { section: "Key Learnings", text: "always run typecheck before committing" },
      { section: "Do-Not-Repeat", text: "never push to main" },
      { section: "User Preferences", text: "prefers concise commit messages" },
      { section: "Decision Log", text: "chose bun over node for the CLI runtime" },
    ]);
  });

  test("empty bug log and empty learning memory derive cleanly", () => {
    const model = deriveMemoryModel(makeBugLogPayload([]), makeLearningMemory());
    expect(model.bugs).toEqual([]);
    expect(model.learnings).toEqual([]);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────

const richModel: MemoryModel = deriveMemoryModel(
  makeBugLogPayload([
    makeBug({ id: "bug-1", errorMessage: "TypeError: undefined is not a function", lastSeenAt: "2026-07-05T10:00:00.000Z" }),
    makeBug({ id: "bug-2", errorMessage: "ENOENT: no such file or directory", fixDescription: "created the missing dir on init", lastSeenAt: "2026-07-06T10:00:00.000Z" }),
  ]),
  makeLearningMemory({
    "Key Learnings": ["always run typecheck before committing", "reuse widgets.ts primitives instead of hand-rolling ANSI"],
    "Do-Not-Repeat": ["never push directly to main"],
  }),
);

const emptyModel: MemoryModel = deriveMemoryModel(makeBugLogPayload([]), makeLearningMemory());

describe("renderMemory — 80x24 content area", () => {
  const rows = contentRows(24);

  test("frame is exactly 80 columns wide and matches the requested row count", () => {
    const screen = createMemoryScreen();
    const frame = screen.render(richModel, makeState(), 80, rows).toString();
    const lines = frame.split("\n");
    expect(lines).toHaveLength(rows);
    for (const line of lines) expect(line.length).toBe(80);
  });

  test("shows both section titles with counts", () => {
    const screen = createMemoryScreen();
    const frame = screen.render(richModel, makeState(), 80, rows).toString();
    expect(frame).toContain("Bugs (2)");
    expect(frame).toContain("Learnings (3)");
  });

  test("bugs section starts focused by default, showing the first bug's detail", () => {
    const screen = createMemoryScreen();
    const frame = screen.render(richModel, makeState(), 80, rows).toString();
    expect(frame).toContain("Bug detail");
    expect(frame).toContain("bug-2"); // newest lastSeenAt sorts first
    expect(frame).toContain("ENOENT: no such file or directory");
  });

  test("empty state: both sections and the detail pane show friendly empty messages", () => {
    const screen = createMemoryScreen();
    const frame = screen.render(emptyModel, makeState(), 80, rows).toString();
    expect(frame).toContain("No bugs logged yet.");
    expect(frame).toContain("No learnings recorded yet.");
  });
});

describe("createMemoryScreen — section focus toggle", () => {
  test("'l' switches focus to learnings; the detail pane switches to a learning's full text", () => {
    const screen = createMemoryScreen();
    const state = makeState();
    expect(screen.onKey!({ name: "l", ctrl: false }, state, richModel)).toBe(true);

    const frame = screen.render(richModel, state, 80, contentRows(24)).toString();
    expect(frame).toContain("Learning detail");
    expect(frame).toContain("Key Learnings");
    expect(frame).toContain("always run typecheck before committing");
  });

  test("'b' switches focus back to bugs", () => {
    const screen = createMemoryScreen();
    const state = makeState();
    screen.onKey!({ name: "l", ctrl: false }, state, richModel);
    expect(screen.onKey!({ name: "b", ctrl: false }, state, richModel)).toBe(true);

    const frame = screen.render(richModel, state, 80, contentRows(24)).toString();
    expect(frame).toContain("Bug detail");
  });
});

describe("createMemoryScreen — selection navigation per focused list", () => {
  test("j/k/g/G move the bugs cursor and the detail pane follows", () => {
    const screen = createMemoryScreen();
    const state = makeState();

    expect(screen.onKey!({ name: "j", ctrl: false }, state, richModel)).toBe(true);
    let frame = screen.render(richModel, state, 80, contentRows(24)).toString();
    expect(frame).toContain("bug-1"); // second row (index 1) after one 'j'
    expect(frame).toContain("TypeError: undefined is not a function");

    expect(screen.onKey!({ name: "g", ctrl: false }, state, richModel)).toBe(true);
    frame = screen.render(richModel, state, 80, contentRows(24)).toString();
    expect(frame).toContain("bug-2");

    expect(screen.onKey!({ name: "G", ctrl: false }, state, richModel)).toBe(true);
    frame = screen.render(richModel, state, 80, contentRows(24)).toString();
    expect(frame).toContain("bug-1");
  });

  test("navigation on the unfocused list doesn't move the focused list's cursor", () => {
    const screen = createMemoryScreen();
    const state = makeState();
    // Still focused on bugs by default — 'j' should move the bug cursor,
    // and switching focus to learnings afterward must show learning index 0,
    // proving the two cursors are independent.
    screen.onKey!({ name: "j", ctrl: false }, state, richModel);
    screen.onKey!({ name: "l", ctrl: false }, state, richModel);
    const frame = screen.render(richModel, state, 80, contentRows(24)).toString();
    expect(frame).toContain("always run typecheck before committing");
  });

  test("unrecognized keys are not consumed", () => {
    const screen = createMemoryScreen();
    const state = makeState();
    expect(screen.onKey!({ name: "z", ctrl: false }, state, richModel)).toBe(false);
  });
});

describe("createMemoryScreen instances are isolated", () => {
  test("focus/selection state on one instance doesn't leak into a freshly created one", () => {
    const a = createMemoryScreen();
    const state = makeState();
    a.onKey!({ name: "l", ctrl: false }, state, richModel);
    expect(a.render(richModel, state, 80, contentRows(24)).toString()).toContain("Learning detail");

    const b = createMemoryScreen();
    expect(b.render(richModel, makeState(), 80, contentRows(24)).toString()).toContain("Bug detail");
  });
});

describe("onProjectSwitch", () => {
  test("resets section focus to bugs and both cursors to 0", () => {
    const screen = createMemoryScreen();
    const state = makeState();
    screen.onKey!({ name: "l", ctrl: false }, state, richModel);
    screen.onKey!({ name: "j", ctrl: false }, state, richModel);
    const before = screen.render(richModel, state, 80, 22).toString();
    expect(before).toContain("Learning detail");

    screen.onProjectSwitch!();
    const after = screen.render(richModel, state, 80, 22).toString();
    expect(after).toContain("Bug detail");
  });
});
