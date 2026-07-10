import { describe, test, expect } from "bun:test";
import { renderOverview } from "../../src/tui/overview-screen";
import { contentRows } from "../../src/tui/shell";
import { fmtNum, deriveOverviewModel, type OverviewModel } from "../../src/tui/overview-model";
import type { ScreenUiState } from "../../src/tui/screen-registry";
import type { OverviewPayload, TokenLedgerPayload, CompressionPayload } from "../../src/types/dashboard";
import type { LedgerSession } from "../../src/types/token-ledger";

// ── Fixtures ─────────────────────────────────────────────────────────────
//
// renderOverview only composes the Overview panels — no tab bar, footer, or
// picker/help chrome (that's shell.ts's job, covered in tui-shell.test.ts).
// Sizes below use shell.contentRows() so the panel layout is exercised at
// the same dimensions the shell actually hands the screen at 80x24/120x40.

function makeState(overrides: Partial<ScreenUiState> = {}): ScreenUiState {
  return { scrollOffset: 0, selectedIndex: 0, lastRefresh: "14:32:05", ...overrides };
}

function makeHistoryEntry(i: number): OverviewModel["history"][number] {
  return {
    id: `sess-fixture-${i}`,
    start: new Date(Date.now() - i * 3_600_000).toISOString(),
    durationMs: 15 * 60_000,
    reads: 10 + i,
    writes: 2 + i,
    tokens: 5000 + i * 100,
    saved: 300 + i * 10,
  };
}

function makeFixtureModel(overrides: Partial<OverviewModel> = {}): OverviewModel {
  return {
    project: "mink-fixture",
    daemon: { running: true, uptimeMs: 2 * 3_600_000 + 14 * 60_000 },
    savings: { total: 1_230_000, heuristic: 900_000, measured: 330_000 },
    lifetime: {
      totalTokens: 5_000_000,
      totalSessions: 42,
      heuristicSavings: 900_000,
      measuredSavings: 330_000,
      compRatioPct: 62,
    },
    last7Days: [
      { day: "Thu 7/3", saved: 100, tokensIn: 500, writes: 200 },
      { day: "Fri 7/4", saved: 150, tokensIn: 600, writes: 250 },
      { day: "Sat 7/5", saved: 80, tokensIn: 300, writes: 100 },
      { day: "Sun 7/6", saved: 200, tokensIn: 700, writes: 300 },
      { day: "Mon 7/7", saved: 250, tokensIn: 900, writes: 400 },
      { day: "Tue 7/8", saved: 180, tokensIn: 650, writes: 220 },
      { day: "Wed 7/9", saved: 300, tokensIn: 1000, writes: 500 },
    ],
    currentSession: {
      id: "sess-live-1",
      isActive: true,
      endedAt: null,
      reads: 12,
      writes: 4,
      tokens: 8000,
      saved: 450,
      indexHits: 9,
      indexMisses: 3,
    },
    compression: {
      enabled: true,
      originalTokens: 100_000,
      compressedTokens: 38_000,
      events: 57,
      holdoutEvents: 6,
      measuredSavings: 62_000,
      ratioPct: 62,
      hasData: true,
    },
    history: Array.from({ length: 12 }, (_, i) => makeHistoryEntry(i)),
    ...overrides,
  };
}

function makeEmptyModel(): OverviewModel {
  return makeFixtureModel({
    currentSession: null,
    history: [],
    compression: {
      enabled: false,
      originalTokens: 0,
      compressedTokens: 0,
      events: 0,
      holdoutEvents: 0,
      measuredSavings: 0,
      ratioPct: 0,
      hasData: false,
    },
    last7Days: [
      { day: "Thu 7/3", saved: 0, tokensIn: 0, writes: 0 },
      { day: "Fri 7/4", saved: 0, tokensIn: 0, writes: 0 },
      { day: "Sat 7/5", saved: 0, tokensIn: 0, writes: 0 },
      { day: "Sun 7/6", saved: 0, tokensIn: 0, writes: 0 },
      { day: "Mon 7/7", saved: 0, tokensIn: 0, writes: 0 },
      { day: "Tue 7/8", saved: 0, tokensIn: 0, writes: 0 },
      { day: "Wed 7/9", saved: 0, tokensIn: 0, writes: 0 },
    ],
    savings: { total: 0, heuristic: 0, measured: 0 },
    lifetime: { totalTokens: 0, totalSessions: 0, heuristicSavings: 0, measuredSavings: 0, compRatioPct: 0 },
  });
}

const PANEL_TITLES = [
  "Lifetime",
  "Token usage — last 7 days",
  "Session (most recent)",
  "Compression — measured",
  "Session history",
];

// ── Full-frame snapshots ─────────────────────────────────────────────────

describe("renderOverview — 80x24 content area", () => {
  const model = makeFixtureModel();
  const rows = contentRows(24);
  const frame = renderOverview(model, makeState(), 80, rows).toString();

  test("shows the project name and total saved", () => {
    expect(frame).toContain("mink-fixture");
    expect(frame).toContain(fmtNum(model.savings.total));
  });

  test("shows every panel title", () => {
    for (const title of PANEL_TITLES) expect(frame).toContain(title);
  });

  test("shows session history rows", () => {
    expect(frame).toContain("sess-fixture-0");
  });

  test("frame is exactly 80 columns wide and matches the requested row count", () => {
    const lines = frame.split("\n");
    expect(lines).toHaveLength(rows);
    for (const line of lines) expect(line.length).toBe(80);
  });
});

describe("renderOverview — 120x40 content area", () => {
  const model = makeFixtureModel();
  const rows = contentRows(40);
  const frame = renderOverview(model, makeState(), 120, rows).toString();

  test("shows the project name and total saved", () => {
    expect(frame).toContain("mink-fixture");
    expect(frame).toContain(fmtNum(model.savings.total));
  });

  test("shows every panel title", () => {
    for (const title of PANEL_TITLES) expect(frame).toContain(title);
  });

  test("shows more session history rows than the 80x24 layout", () => {
    expect(frame).toContain("sess-fixture-0");
    expect(frame).toContain("sess-fixture-9");
  });

  test("frame is exactly 120 columns wide and matches the requested row count", () => {
    const lines = frame.split("\n");
    expect(lines).toHaveLength(rows);
    for (const line of lines) expect(line.length).toBe(120);
  });
});

// ── Empty state ──────────────────────────────────────────────────────────

describe("renderOverview — empty state (fresh project)", () => {
  const rows = contentRows(24);

  test("renders without throwing", () => {
    expect(() => renderOverview(makeEmptyModel(), makeState(), 80, rows)).not.toThrow();
  });

  test("shows friendly empty-state text for session, compression, and history", () => {
    const frame = renderOverview(makeEmptyModel(), makeState(), 80, rows).toString();
    expect(frame).toContain("No sessions yet.");
    expect(frame).toContain("No measured compression data yet.");
    expect(frame).toContain("No sessions yet — history will appear here.");
  });

  test("derived from real loader payload shapes also renders cleanly", () => {
    const overview: OverviewPayload = {
      project: { name: "fresh-proj", description: "", cwd: "/tmp/fresh" },
      daemon: { running: false },
      summary: { totalSessions: 0, totalTokens: 0, totalReads: 0, totalWrites: 0, estimatedSavings: 0 },
      stateFiles: [],
    };
    const ledger: TokenLedgerPayload = {
      lifetime: {
        totalTokens: 0,
        totalReads: 0,
        totalWrites: 0,
        totalSessions: 0,
        totalFileIndexHits: 0,
        totalFileIndexMisses: 0,
        totalRepeatedReads: 0,
        totalEstimatedSavings: 0,
      },
      sessions: [] as LedgerSession[],
      wasteFlags: [],
    };
    const compression: CompressionPayload = {
      enabled: false,
      lifetime: { totalEvents: 0, totalHoldoutEvents: 0, totalOriginalTokens: 0, totalCompressedTokens: 0, totalMeasuredSavings: 0 },
      arms: { compressed: { events: 0, originalTokens: 0, compressedTokens: 0 }, holdout: { events: 0, originalTokens: 0 } },
      byKind: [],
      byTool: [],
      recent: [],
    };
    const model = deriveOverviewModel(overview, ledger, compression);
    expect(() => renderOverview(model, makeState(), 80, rows)).not.toThrow();
    const frame = renderOverview(model, makeState(), 80, rows).toString();
    expect(frame).toContain("fresh-proj");
  });
});

// ── Scroll offset windowing ──────────────────────────────────────────────

describe("renderOverview — session history scroll window", () => {
  test("scrollOffset 0 shows the newest entries first", () => {
    const frame = renderOverview(makeFixtureModel(), makeState({ scrollOffset: 0 }), 120, contentRows(40)).toString();
    expect(frame).toContain("sess-fixture-0");
  });

  test("a large scrollOffset shifts the visible window toward older entries", () => {
    const model = makeFixtureModel();
    const rows = contentRows(24);
    const atTop = renderOverview(model, makeState({ scrollOffset: 0 }), 80, rows).toString();
    const scrolled = renderOverview(model, makeState({ scrollOffset: model.history.length - 1 }), 80, rows).toString();
    expect(atTop).not.toBe(scrolled);
    // The last (oldest) history entry should be visible once scrolled to the bottom.
    expect(scrolled).toContain(`sess-fixture-${model.history.length - 1}`);
  });
});

// ── Screen key handling ──────────────────────────────────────────────────

describe("overviewScreen.onKey — history scrolling", () => {
  test("j/down, k/up, g, G move and clamp scrollOffset against the model's history length", async () => {
    const { overviewScreen } = await import("../../src/tui/overview-screen");
    const model = makeFixtureModel();
    const state = makeState({ scrollOffset: 0 });

    expect(overviewScreen.onKey!({ name: "j", ctrl: false }, state, model)).toBe(true);
    expect(state.scrollOffset).toBe(1);

    expect(overviewScreen.onKey!({ name: "G", ctrl: false }, state, model)).toBe(true);
    expect(state.scrollOffset).toBe(model.history.length - 1);

    // Clamps rather than overshooting past the last entry.
    expect(overviewScreen.onKey!({ name: "down", ctrl: false }, state, model)).toBe(true);
    expect(state.scrollOffset).toBe(model.history.length - 1);

    expect(overviewScreen.onKey!({ name: "g", ctrl: false }, state, model)).toBe(true);
    expect(state.scrollOffset).toBe(0);

    // k/up at the top clamps at 0 rather than going negative.
    expect(overviewScreen.onKey!({ name: "up", ctrl: false }, state, model)).toBe(true);
    expect(state.scrollOffset).toBe(0);
  });

  test("unrelated keys are not consumed", async () => {
    const { overviewScreen } = await import("../../src/tui/overview-screen");
    const state = makeState();
    expect(overviewScreen.onKey!({ name: "x", ctrl: false }, state, makeFixtureModel())).toBe(false);
  });

  test("a null model (build failed before first success) doesn't throw and clamps to 0", async () => {
    const { overviewScreen } = await import("../../src/tui/overview-screen");
    const state = makeState({ scrollOffset: 0 });
    expect(overviewScreen.onKey!({ name: "G", ctrl: false }, state, null)).toBe(true);
    expect(state.scrollOffset).toBe(0);
  });
});
