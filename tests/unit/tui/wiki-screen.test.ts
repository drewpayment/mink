import { describe, test, expect } from "bun:test";
import {
  deriveWikiModel,
  derivePreviewLines,
  filterNotes,
  createWikiScreen,
  type WikiModel,
  type WikiNoteListItem,
} from "../../../src/tui/wiki-screen";
import { contentRows } from "../../../src/tui/shell";
import type { ScreenUiState } from "../../../src/tui/screen-registry";
import type { WikiPanelPayload, WikiNotePayload } from "../../../src/types/dashboard";
import type { VaultIndexEntry } from "../../../src/types/note";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeState(overrides: Partial<ScreenUiState> = {}): ScreenUiState {
  return { scrollOffset: 0, selectedIndex: 0, lastRefresh: "14:32:05", ...overrides };
}

function makeEntry(overrides: Partial<VaultIndexEntry> = {}): VaultIndexEntry {
  return {
    filePath: "projects/mink/overview.md",
    title: "Mink overview",
    description: "",
    tags: ["mink"],
    category: "projects",
    estimatedTokens: 200,
    lastModified: "2026-07-05T10:00:00.000Z",
    ...overrides,
  };
}

function makeWikiPanelPayload(overrides: Partial<WikiPanelPayload> = {}): WikiPanelPayload {
  return {
    initialized: true,
    vaultPath: "/home/user/.mink/wiki",
    totalNotes: 0,
    inboxCount: 0,
    recent: [],
    tags: [],
    tree: [],
    ...overrides,
  };
}

function makeNotePayload(overrides: Partial<WikiNotePayload> = {}): WikiNotePayload {
  return {
    path: "projects/mink/overview.md",
    frontmatter: {},
    body: "Line one of the note.\nLine two of the note.",
    backlinks: [],
    ...overrides,
  };
}

function toListItem(entry: VaultIndexEntry): WikiNoteListItem {
  return { filePath: entry.filePath, title: entry.title, category: entry.category, tags: entry.tags, lastModified: entry.lastModified };
}

// ── Derivation ───────────────────────────────────────────────────────────

describe("deriveWikiModel", () => {
  test("maps recent entries into note list items with a null preview", () => {
    const model = deriveWikiModel(makeWikiPanelPayload({ totalNotes: 1, recent: [makeEntry()] }));
    expect(model.initialized).toBe(true);
    expect(model.notes).toHaveLength(1);
    expect(model.notes[0]!.title).toBe("Mink overview");
    expect(model.notes[0]!.category).toBe("projects");
    expect(model.preview).toBeNull();
  });

  test("an uninitialized vault derives cleanly with an empty note list", () => {
    const model = deriveWikiModel(makeWikiPanelPayload({ initialized: false, recent: [] }));
    expect(model.initialized).toBe(false);
    expect(model.notes).toEqual([]);
  });
});

describe("filterNotes", () => {
  const notes: WikiNoteListItem[] = [
    toListItem(makeEntry({ filePath: "projects/mink/overview.md", title: "Mink overview" })),
    toListItem(makeEntry({ filePath: "areas/health/notes.md", title: "Sleep tracking" })),
  ];

  test("empty query returns every note unfiltered", () => {
    expect(filterNotes(notes, "")).toEqual(notes);
  });

  test("matches case-insensitively on title", () => {
    expect(filterNotes(notes, "MINK")).toEqual([notes[0]]);
  });

  test("matches on path when the title doesn't match", () => {
    expect(filterNotes(notes, "areas/health")).toEqual([notes[1]]);
  });

  test("no match returns an empty array", () => {
    expect(filterNotes(notes, "nonexistent")).toEqual([]);
  });
});

describe("derivePreviewLines", () => {
  test("splits the body into lines and trims leading blank lines", () => {
    const note = makeNotePayload({ body: "\n\nfirst real line\nsecond line" });
    expect(derivePreviewLines(note, 10)).toEqual(["first real line", "second line"]);
  });

  test("caps output at maxLines", () => {
    const note = makeNotePayload({ body: Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n") });
    expect(derivePreviewLines(note, 3)).toEqual(["line 0", "line 1", "line 2"]);
  });

  test("frontmatter is already stripped by loadWikiNote, so no frontmatter markers appear", () => {
    const note = makeNotePayload({ body: "just the body, no --- markers here" });
    expect(derivePreviewLines(note, 5)).toEqual(["just the body, no --- markers here"]);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────

function makeModel(overrides: Partial<WikiModel> = {}): WikiModel {
  return {
    initialized: true,
    vaultPath: "/home/user/.mink/wiki",
    totalNotes: 2,
    notes: [
      toListItem(makeEntry({ filePath: "projects/mink/overview.md", title: "Mink overview", lastModified: "2026-07-06T10:00:00.000Z" })),
      toListItem(makeEntry({ filePath: "areas/health/notes.md", title: "Sleep tracking", category: "areas", lastModified: "2026-07-01T10:00:00.000Z" })),
    ],
    preview: {
      path: "projects/mink/overview.md",
      title: "Mink overview",
      lines: ["Reduces AI token consumption."],
      backlinkCount: 2,
    },
    ...overrides,
  };
}

const richModel = makeModel();
const emptyModel: WikiModel = { initialized: true, vaultPath: "/home/user/.mink/wiki", totalNotes: 0, notes: [], preview: null };
const uninitializedModel: WikiModel = { initialized: false, vaultPath: "/home/user/.mink/wiki", totalNotes: 0, notes: [], preview: null };

describe("renderWiki — 80x24 content area", () => {
  const rows = contentRows(24);

  test("frame is exactly 80 columns wide and matches the requested row count", () => {
    const screen = createWikiScreen();
    const lines = screen.render(richModel, makeState(), 80, rows).toString().split("\n");
    expect(lines).toHaveLength(rows);
    for (const line of lines) expect(line.length).toBe(80);
  });

  test("shows the note list with titles and categories", () => {
    const screen = createWikiScreen();
    const frame = screen.render(richModel, makeState(), 80, rows).toString();
    expect(frame).toContain("Mink overview");
    expect(frame).toContain("Sleep tracking");
    expect(frame).toContain("areas");
  });

  test("shows the preview pane for the selected (first) note", () => {
    const screen = createWikiScreen();
    const frame = screen.render(richModel, makeState(), 80, rows).toString();
    expect(frame).toContain("Reduces AI token consumption.");
  });

  test("shows the '/ to search notes' hint when not in search mode", () => {
    const screen = createWikiScreen();
    const frame = screen.render(richModel, makeState(), 80, rows).toString();
    expect(frame).toContain("/ to search notes");
  });

  test("uninitialized vault shows the init hint instead of a note list", () => {
    const screen = createWikiScreen();
    const frame = screen.render(uninitializedModel, makeState(), 80, rows).toString();
    expect(frame).toContain("Wiki vault not initialized.");
    expect(frame).toContain("mink wiki init");
  });

  test("empty vault shows a friendly no-notes message", () => {
    const screen = createWikiScreen();
    const frame = screen.render(emptyModel, makeState(), 80, rows).toString();
    expect(frame).toContain("No notes yet.");
    expect(frame).toContain("No notes in vault.");
  });
});

describe("createWikiScreen — search mode", () => {
  const rows = contentRows(24);

  test("'/' enters search mode and shows the search bar with the cursor marker", () => {
    const screen = createWikiScreen();
    const state = makeState();
    expect(screen.onKey!({ name: "/", ctrl: false }, state, richModel)).toBe(true);
    expect(screen.capturesInput(richModel)).toBe(true);
    const frame = screen.render(richModel, state, 80, rows).toString();
    expect(frame).toContain("/▏");
  });

  test("typing printable characters (including shell-owned ones like 'p' and '1') builds the query", () => {
    const screen = createWikiScreen();
    const state = makeState();
    screen.onKey!({ name: "/", ctrl: false }, state, richModel);
    for (const ch of ["s", "l", "e", "e", "p"]) {
      expect(screen.onKey!({ name: ch, ctrl: false }, state, richModel)).toBe(true);
    }
    const frame = screen.render(richModel, state, 80, rows).toString();
    expect(frame).toContain("/sleep▏");
    // Filtered down to just the matching note.
    expect(frame).toContain("Sleep tracking");
    expect(frame).not.toContain("Mink overview");
  });

  test("backspace removes the last character", () => {
    const screen = createWikiScreen();
    const state = makeState();
    screen.onKey!({ name: "/", ctrl: false }, state, richModel);
    screen.onKey!({ name: "m", ctrl: false }, state, richModel);
    screen.onKey!({ name: "i", ctrl: false }, state, richModel);
    screen.onKey!({ name: "backspace", ctrl: false }, state, richModel);
    const frame = screen.render(richModel, state, 80, rows).toString();
    expect(frame).toContain("/m▏");
  });

  test("Escape clears the query and exits search mode", () => {
    const screen = createWikiScreen();
    const state = makeState();
    screen.onKey!({ name: "/", ctrl: false }, state, richModel);
    screen.onKey!({ name: "s", ctrl: false }, state, richModel);
    expect(screen.onKey!({ name: "escape", ctrl: false }, state, richModel)).toBe(true);
    expect(screen.capturesInput(richModel)).toBe(false);
    const frame = screen.render(richModel, state, 80, rows).toString();
    expect(frame).toContain("/ to search notes");
    expect(frame).toContain("Mink overview"); // filter cleared, both notes visible again
  });

  test("Enter confirms the query and returns to list navigation, keeping the filter applied", () => {
    const screen = createWikiScreen();
    const state = makeState();
    screen.onKey!({ name: "/", ctrl: false }, state, richModel);
    screen.onKey!({ name: "s", ctrl: false }, state, richModel);
    screen.onKey!({ name: "l", ctrl: false }, state, richModel);
    expect(screen.onKey!({ name: "return", ctrl: false }, state, richModel)).toBe(true);
    expect(screen.capturesInput(richModel)).toBe(false);
    // Filter should remain applied post-confirm.
    const frame = screen.render(richModel, state, 80, rows).toString();
    expect(frame).toContain("filter: \"sl\"");
    expect(frame).toContain("Sleep tracking");
    expect(frame).not.toContain("Mink overview");
    // And j/k now navigate the (filtered) list rather than typing.
    expect(screen.onKey!({ name: "j", ctrl: false }, state, richModel)).toBe(true);
  });

  test("Ctrl-modified keys are not consumed by search mode (Ctrl-C must still work)", () => {
    const screen = createWikiScreen();
    const state = makeState();
    screen.onKey!({ name: "/", ctrl: false }, state, richModel);
    expect(screen.onKey!({ name: "c", ctrl: true }, state, richModel)).toBe(false);
  });

  test("query matching nothing shows the no-results state", () => {
    const screen = createWikiScreen();
    const state = makeState();
    screen.onKey!({ name: "/", ctrl: false }, state, richModel);
    for (const ch of "zzz") screen.onKey!({ name: ch, ctrl: false }, state, richModel);
    const frame = screen.render(richModel, state, 80, rows).toString();
    expect(frame).toContain('No notes match "zzz".');
  });
});

describe("createWikiScreen — list navigation outside search mode", () => {
  const rows = contentRows(24);

  test("j/k/g/G move the selection and are consumed", () => {
    const screen = createWikiScreen();
    const state = makeState();
    expect(screen.onKey!({ name: "j", ctrl: false }, state, richModel)).toBe(true);
    expect(screen.onKey!({ name: "k", ctrl: false }, state, richModel)).toBe(true);
    expect(screen.onKey!({ name: "g", ctrl: false }, state, richModel)).toBe(true);
    expect(screen.onKey!({ name: "G", ctrl: false }, state, richModel)).toBe(true);
  });

  test("unrecognized keys are not consumed and capturesInput is false", () => {
    const screen = createWikiScreen();
    const state = makeState();
    expect(screen.capturesInput(richModel)).toBe(false);
    expect(screen.onKey!({ name: "z", ctrl: false }, state, richModel)).toBe(false);
  });
});

describe("createWikiScreen instances are isolated", () => {
  test("search state on one instance doesn't leak into a freshly created one", () => {
    const a = createWikiScreen();
    const state = makeState();
    a.onKey!({ name: "/", ctrl: false }, state, richModel);
    a.onKey!({ name: "x", ctrl: false }, state, richModel);
    expect(a.capturesInput(richModel)).toBe(true);

    const b = createWikiScreen();
    expect(b.capturesInput(richModel)).toBe(false);
  });
});
