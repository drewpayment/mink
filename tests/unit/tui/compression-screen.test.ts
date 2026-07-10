import { describe, test, expect } from "bun:test";
import {
  deriveCompressionModel,
  renderCompression,
  compressionScreen,
} from "../../../src/tui/compression-screen";
import { contentRows } from "../../../src/tui/shell";
import { fmtNum } from "../../../src/tui/overview-model";
import type { ScreenUiState } from "../../../src/tui/screen-registry";
import type { CompressionPayload } from "../../../src/types/dashboard";
import type { CompressionEvent, CompressionBreakdownRow } from "../../../src/types/token-ledger";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeState(overrides: Partial<ScreenUiState> = {}): ScreenUiState {
  return { scrollOffset: 0, selectedIndex: 0, lastRefresh: "14:32:05", ...overrides };
}

function makeBreakdownRow(overrides: Partial<CompressionBreakdownRow> = {}): CompressionBreakdownRow {
  return {
    key: "search",
    events: 20,
    originalTokens: 40_000,
    compressedTokens: 15_000,
    savings: 25_000,
    ...overrides,
  };
}

function makeEvent(i: number, overrides: Partial<CompressionEvent> = {}): CompressionEvent {
  return {
    id: `evt-${i}`,
    createdAt: new Date(Date.now() - i * 60_000).toISOString(),
    toolName: "Read",
    contentKind: "file",
    originalTokens: 5_000 + i * 10,
    compressedTokens: 1_800 + i * 5,
    holdout: false,
    ...overrides,
  };
}

function makeCompressionPayload(overrides: Partial<CompressionPayload> = {}): CompressionPayload {
  return {
    enabled: true,
    lifetime: {
      totalEvents: 57,
      totalHoldoutEvents: 6,
      totalOriginalTokens: 106_000,
      totalCompressedTokens: 39_800,
      totalMeasuredSavings: 62_000,
    },
    arms: {
      compressed: { events: 51, originalTokens: 100_000, compressedTokens: 38_000 },
      holdout: { events: 6, originalTokens: 6_000 },
    },
    byKind: [
      makeBreakdownRow({ key: "search", events: 20, originalTokens: 40_000, compressedTokens: 15_000, savings: 25_000 }),
      makeBreakdownRow({ key: "log", events: 15, originalTokens: 30_000, compressedTokens: 12_000, savings: 18_000 }),
      makeBreakdownRow({ key: "file", events: 16, originalTokens: 30_000, compressedTokens: 11_000, savings: 19_000 }),
    ],
    byTool: [],
    recent: Array.from({ length: 12 }, (_, i) => makeEvent(i)),
    ...overrides,
  };
}

function makeEmptyPayload(overrides: Partial<CompressionPayload> = {}): CompressionPayload {
  return {
    enabled: true,
    lifetime: { totalEvents: 0, totalHoldoutEvents: 0, totalOriginalTokens: 0, totalCompressedTokens: 0, totalMeasuredSavings: 0 },
    arms: { compressed: { events: 0, originalTokens: 0, compressedTokens: 0 }, holdout: { events: 0, originalTokens: 0 } },
    byKind: [],
    byTool: [],
    recent: [],
    ...overrides,
  };
}

// ── Derivation ───────────────────────────────────────────────────────────

describe("deriveCompressionModel", () => {
  test("maps a rich payload into headline lifetime figures (compressed arm only)", () => {
    const model = deriveCompressionModel(makeCompressionPayload());
    expect(model.enabled).toBe(true);
    expect(model.hasData).toBe(true);
    expect(model.lifetime.events).toBe(51); // arms.compressed.events, not lifetime.totalEvents
    expect(model.lifetime.holdoutEvents).toBe(6);
    expect(model.lifetime.originalTokens).toBe(100_000);
    expect(model.lifetime.compressedTokens).toBe(38_000);
    expect(model.lifetime.measuredSavings).toBe(62_000);
    expect(model.lifetime.ratioPct).toBeCloseTo(62, 5);
  });

  test("maps byKind rows with a computed ratioPct per row", () => {
    const model = deriveCompressionModel(makeCompressionPayload());
    expect(model.byKind).toHaveLength(3);
    const search = model.byKind.find((r) => r.key === "search")!;
    expect(search.events).toBe(20);
    expect(search.originalTokens).toBe(40_000);
    expect(search.compressedTokens).toBe(15_000);
    expect(search.savings).toBe(25_000);
    expect(search.ratioPct).toBeCloseTo((25_000 / 40_000) * 100, 5);
  });

  test("maps recent events with a savings figure and formatted time", () => {
    const model = deriveCompressionModel(makeCompressionPayload());
    expect(model.recent).toHaveLength(12);
    const first = model.recent[0]!;
    expect(first.id).toBe("evt-0");
    expect(first.toolName).toBe("Read");
    expect(first.contentKind).toBe("file");
    expect(first.savings).toBe(5_000 - 1_800);
    expect(first.holdout).toBe(false);
    expect(first.time).not.toBe("");
  });

  test("marks holdout events distinctly", () => {
    const model = deriveCompressionModel(
      makeCompressionPayload({ recent: [makeEvent(0, { holdout: true, originalTokens: 1000, compressedTokens: 1000 })] }),
    );
    expect(model.recent[0]!.holdout).toBe(true);
    expect(model.recent[0]!.savings).toBe(0);
  });

  test("an empty payload has no data and a zero ratio, not NaN or Infinity", () => {
    const model = deriveCompressionModel(makeEmptyPayload());
    expect(model.hasData).toBe(false);
    expect(model.lifetime.ratioPct).toBe(0);
    expect(Number.isFinite(model.lifetime.ratioPct)).toBe(true);
    expect(model.byKind).toEqual([]);
    expect(model.recent).toEqual([]);
  });

  test("a disabled project still derives cleanly (enabled: false)", () => {
    const model = deriveCompressionModel(makeEmptyPayload({ enabled: false }));
    expect(model.enabled).toBe(false);
    expect(model.hasData).toBe(false);
  });

  test("zero-denominator breakdown rows report a 0 ratio rather than NaN", () => {
    const model = deriveCompressionModel(
      makeCompressionPayload({ byKind: [makeBreakdownRow({ key: "json", events: 1, originalTokens: 0, compressedTokens: 0, savings: 0 })] }),
    );
    expect(model.byKind[0]!.ratioPct).toBe(0);
  });
});

// ── Rendering ────────────────────────────────────────────────────────────

const richModel = deriveCompressionModel(makeCompressionPayload());
const emptyModel = deriveCompressionModel(makeEmptyPayload());
const disabledModel = deriveCompressionModel(makeEmptyPayload({ enabled: false }));

describe("renderCompression — 80x24 content area", () => {
  const rows = contentRows(24);
  const frame = renderCompression(richModel, makeState(), 80, rows).toString();

  test("shows KPI values: measured savings, ratio, event counts", () => {
    expect(frame).toContain(fmtNum(richModel.lifetime.measuredSavings));
    expect(frame).toContain(`${richModel.lifetime.ratioPct.toFixed(0)}%`);
    expect(frame).toContain(fmtNum(richModel.lifetime.events));
    expect(frame).toContain(fmtNum(richModel.lifetime.holdoutEvents));
  });

  test("shows the per-kind breakdown rows", () => {
    expect(frame).toContain("search");
    expect(frame).toContain("log");
    expect(frame).toContain("file");
  });

  test("shows the recent-events feed", () => {
    expect(frame).toContain("Read");
    expect(frame).toContain("file");
  });

  test("frame is exactly 80 columns wide and matches the requested row count", () => {
    const lines = frame.split("\n");
    expect(lines).toHaveLength(rows);
    for (const line of lines) expect(line.length).toBe(80);
  });
});

describe("renderCompression — 120x40 content area", () => {
  const rows = contentRows(40);
  const frame = renderCompression(richModel, makeState(), 120, rows).toString();

  test("shows KPI values and breakdown at the larger size too", () => {
    expect(frame).toContain(fmtNum(richModel.lifetime.measuredSavings));
    expect(frame).toContain("search");
  });

  test("frame is exactly 120 columns wide and matches the requested row count", () => {
    const lines = frame.split("\n");
    expect(lines).toHaveLength(rows);
    for (const line of lines) expect(line.length).toBe(120);
  });
});

describe("renderCompression — empty state (enabled, no events yet)", () => {
  const rows = contentRows(24);

  test("renders without throwing", () => {
    expect(() => renderCompression(emptyModel, makeState(), 80, rows)).not.toThrow();
  });

  test("shows a friendly no-events message, not a crash or blank screen", () => {
    const frame = renderCompression(emptyModel, makeState(), 80, rows).toString();
    expect(frame).toContain("No compression events yet.");
  });
});

describe("renderCompression — disabled state", () => {
  const rows = contentRows(24);
  const frame = renderCompression(disabledModel, makeState(), 80, rows).toString();

  test("shows a friendly disabled message with the enable command", () => {
    expect(frame).toContain("Compression is disabled for this project.");
    expect(frame).toContain("mink config set compression.enabled true");
  });

  test("frame dimensions still match the requested size", () => {
    const lines = frame.split("\n");
    expect(lines).toHaveLength(rows);
    for (const line of lines) expect(line.length).toBe(80);
  });
});

// ── Scroll offset windowing ──────────────────────────────────────────────

describe("renderCompression — recent events scroll window", () => {
  test("scrollOffset 0 shows the newest event's row first", () => {
    const frame = renderCompression(richModel, makeState({ scrollOffset: 0 }), 120, contentRows(40)).toString();
    expect(frame).toContain(richModel.recent[0]!.time);
  });

  test("a large scrollOffset shifts the visible window toward older events", () => {
    const rows = contentRows(24);
    const atTop = renderCompression(richModel, makeState({ scrollOffset: 0 }), 80, rows).toString();
    const scrolled = renderCompression(richModel, makeState({ scrollOffset: richModel.recent.length - 1 }), 80, rows).toString();
    expect(atTop).not.toBe(scrolled);
    // The last (oldest) event's row should be visible once scrolled to the bottom.
    expect(scrolled).toContain(richModel.recent[richModel.recent.length - 1]!.time);
  });
});

// ── Screen key handling ──────────────────────────────────────────────────

describe("compressionScreen.onKey — recent-events scrolling", () => {
  test("j/down, k/up, g, G move and clamp scrollOffset against the model's recent-event count", () => {
    const state = makeState({ scrollOffset: 0 });

    expect(compressionScreen.onKey!({ name: "j", ctrl: false }, state, richModel)).toBe(true);
    expect(state.scrollOffset).toBe(1);

    expect(compressionScreen.onKey!({ name: "G", ctrl: false }, state, richModel)).toBe(true);
    expect(state.scrollOffset).toBe(richModel.recent.length - 1);

    expect(compressionScreen.onKey!({ name: "down", ctrl: false }, state, richModel)).toBe(true);
    expect(state.scrollOffset).toBe(richModel.recent.length - 1);

    expect(compressionScreen.onKey!({ name: "g", ctrl: false }, state, richModel)).toBe(true);
    expect(state.scrollOffset).toBe(0);

    expect(compressionScreen.onKey!({ name: "up", ctrl: false }, state, richModel)).toBe(true);
    expect(state.scrollOffset).toBe(0);
  });

  test("unrelated keys are not consumed", () => {
    const state = makeState();
    expect(compressionScreen.onKey!({ name: "x", ctrl: false }, state, richModel)).toBe(false);
  });

  test("a null model (build failed before first success) doesn't throw and clamps to 0", () => {
    const state = makeState({ scrollOffset: 0 });
    expect(compressionScreen.onKey!({ name: "G", ctrl: false }, state, null)).toBe(true);
    expect(state.scrollOffset).toBe(0);
  });
});

// ── Registry contract ────────────────────────────────────────────────────

describe("compressionScreen", () => {
  test("declares its id, title, and hotkey", () => {
    expect(compressionScreen.id).toBe("compression");
    expect(compressionScreen.title).toBe("Compression");
    expect(compressionScreen.hotkey).toBe("3");
  });

  test("helpKeys documents the scroll keys", () => {
    expect(compressionScreen.helpKeys?.length).toBeGreaterThan(0);
  });
});
