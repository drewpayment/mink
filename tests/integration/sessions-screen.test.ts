import { describe, test, expect } from "bun:test";
import {
  renderSessions,
  deriveSessionsModel,
  sessionsScreen,
  type SessionsModel,
  type SessionRow,
} from "../../src/tui/sessions-screen";
import { contentRows } from "../../src/tui/shell";
import type { ScreenUiState } from "../../src/tui/screen-registry";
import type { TokenLedgerPayload } from "../../src/types/dashboard";
import type { LedgerSession } from "../../src/types/token-ledger";
import type { WasteFlag } from "../../src/types/waste-detection";

// ── Fixtures ─────────────────────────────────────────────────────────────

function makeState(overrides: Partial<ScreenUiState> = {}): ScreenUiState {
  return { scrollOffset: 0, selectedIndex: 0, lastRefresh: "14:32:05", ...overrides };
}

function makeLedgerSession(overrides: Partial<LedgerSession> = {}): LedgerSession {
  return {
    sessionId: "sess-1",
    startTimestamp: new Date().toISOString(),
    endTimestamp: new Date().toISOString(),
    reads: [],
    writes: [],
    totals: {
      readCount: 0,
      writeCount: 0,
      estimatedTokens: 0,
      repeatedReads: 0,
      fileIndexHits: 0,
      fileIndexMisses: 0,
    },
    estimatedSavings: 0,
    ...overrides,
  };
}

function makeLedgerPayload(overrides: Partial<TokenLedgerPayload> = {}): TokenLedgerPayload {
  return {
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
    sessions: [],
    wasteFlags: [],
    ...overrides,
  };
}

// Builds a SessionRow directly (bypassing deriveSessionsModel) — used by the
// render/onKey tests below, which care about layout and selection behavior,
// not the ledger -> model mapping (that's covered by the deriveSessionsModel
// suite further down).
function makeRow(i: number, overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: `sess-fixture-${i}`,
    start: new Date(Date.now() - i * 3_600_000).toISOString(),
    end: new Date(Date.now() - i * 3_600_000 + 900_000).toISOString(),
    isActive: false,
    durationMs: 900_000,
    reads: i,
    writes: i + 1,
    tokens: 5000 + i * 100,
    saved: 300 + i * 10,
    indexHits: 8,
    indexMisses: 2,
    ...overrides,
  };
}

function makeModel(count: number, overrides: Partial<SessionsModel> = {}): SessionsModel {
  return {
    sessions: Array.from({ length: count }, (_, i) => makeRow(i)),
    wasteFlags: [],
    ...overrides,
  };
}

const WASTE_FLAG: WasteFlag = {
  pattern: "repeated-reads",
  description: "file.ts read 6 times",
  estimatedTokensWasted: 1200,
  suggestion: "cache the read",
  detectedAt: new Date().toISOString(),
};

// ── deriveSessionsModel ──────────────────────────────────────────────────

describe("deriveSessionsModel", () => {
  test("an empty ledger derives an empty model", () => {
    const model = deriveSessionsModel(makeLedgerPayload());
    expect(model.sessions).toEqual([]);
    expect(model.wasteFlags).toEqual([]);
  });

  test("a single active session (no endTimestamp) derives isActive true and a live duration", () => {
    const start = new Date(Date.now() - 90_000).toISOString();
    const session = makeLedgerSession({
      sessionId: "live-1",
      startTimestamp: start,
      endTimestamp: "",
      totals: { readCount: 3, writeCount: 1, estimatedTokens: 1500, repeatedReads: 0, fileIndexHits: 2, fileIndexMisses: 1 },
      estimatedSavings: 200,
    });
    const model = deriveSessionsModel(makeLedgerPayload({ sessions: [session] }));

    expect(model.sessions).toHaveLength(1);
    const row = model.sessions[0]!;
    expect(row.id).toBe("live-1");
    expect(row.isActive).toBe(true);
    expect(row.end).toBeNull();
    expect(row.reads).toBe(3);
    expect(row.writes).toBe(1);
    expect(row.tokens).toBe(1500);
    expect(row.saved).toBe(200);
    expect(row.indexHits).toBe(2);
    expect(row.indexMisses).toBe(1);
    expect(row.durationMs).toBeGreaterThanOrEqual(90_000 - 1000);
    expect(row.durationMs).toBeLessThan(90_000 + 5000);
  });

  test("many sessions are ordered newest first and are NOT capped at 30", () => {
    const sessions: LedgerSession[] = Array.from({ length: 40 }, (_, i) =>
      makeLedgerSession({ sessionId: `s-${i}`, startTimestamp: new Date(Date.now() - (40 - i) * 3_600_000).toISOString() }),
    );
    const model = deriveSessionsModel(makeLedgerPayload({ sessions }));

    expect(model.sessions).toHaveLength(40);
    expect(model.sessions[0]!.id).toBe("s-39"); // last pushed (most recent) comes first
    expect(model.sessions[39]!.id).toBe("s-0");
  });

  test("wasteFlags pass through unfiltered (project-wide, not session-attributed)", () => {
    const model = deriveSessionsModel(makeLedgerPayload({ wasteFlags: [WASTE_FLAG] }));
    expect(model.wasteFlags).toEqual([WASTE_FLAG]);
  });
});

// ── renderSessions — empty state ─────────────────────────────────────────

describe("renderSessions — empty state", () => {
  const rows = contentRows(24);

  test("renders without throwing and shows a friendly message", () => {
    const model = makeModel(0);
    expect(() => renderSessions(model, makeState(), 80, rows)).not.toThrow();
    const frame = renderSessions(model, makeState(), 80, rows).toString();
    expect(frame).toContain("No sessions yet.");
  });
});

// ── renderSessions — table + detail ──────────────────────────────────────

describe("renderSessions — 80x22 content area", () => {
  const rows = contentRows(24);
  const model = makeModel(12);

  test("shows the table headers", () => {
    const frame = renderSessions(model, makeState(), 80, rows).toString();
    for (const header of ["START", "DUR", "READS", "WRITES", "TOKENS", "SAVED"]) {
      expect(frame).toContain(header);
    }
  });

  test("shows the detail panel title and the selected session's id/status", () => {
    const frame = renderSessions(model, makeState({ selectedIndex: 0 }), 80, rows).toString();
    expect(frame).toContain("Session detail");
    expect(frame).toContain(model.sessions[0]!.id);
    expect(frame).toContain("ended");
  });

  test("detail panel reflects a different selected session when selectedIndex changes", () => {
    const frame = renderSessions(model, makeState({ selectedIndex: 3 }), 80, rows).toString();
    expect(frame).toContain(model.sessions[3]!.id);
  });

  test("an active session's detail shows the active marker instead of an end time", () => {
    const active = makeModel(1, { sessions: [makeRow(0, { isActive: true, end: null })] });
    const frame = renderSessions(active, makeState({ selectedIndex: 0 }), 80, rows).toString();
    expect(frame).toContain("● active");
  });

  test("frame is exactly the requested width and row count", () => {
    const frame = renderSessions(model, makeState(), 80, rows).toString();
    const lines = frame.split("\n");
    expect(lines).toHaveLength(rows);
    for (const line of lines) expect(line.length).toBe(80);
  });

  test("waste flags render as a project-wide list, not filtered per session", () => {
    const withFlags = makeModel(5, { wasteFlags: [WASTE_FLAG] });
    const frame = renderSessions(withFlags, makeState({ selectedIndex: 0 }), 80, rows).toString();
    expect(frame).toContain("Waste flags (project)");
    expect(frame).toContain("repeated-reads");
  });

  test("no waste flags renders a 'none detected' line rather than an empty gap", () => {
    const frame = renderSessions(makeModel(5), makeState({ selectedIndex: 0 }), 80, rows).toString();
    expect(frame).toContain("none detected");
  });
});

// ── Selection clamping + scroll-follow ───────────────────────────────────

describe("sessionsScreen.onKey — selection", () => {
  test("j/down, k/up, g, G move and clamp selectedIndex against the model's session count", () => {
    const model = makeModel(10);
    const state = makeState({ selectedIndex: 0 });

    expect(sessionsScreen.onKey!({ name: "j", ctrl: false }, state, model)).toBe(true);
    expect(state.selectedIndex).toBe(1);

    expect(sessionsScreen.onKey!({ name: "G", ctrl: false }, state, model)).toBe(true);
    expect(state.selectedIndex).toBe(9);

    // Clamps rather than overshooting past the last row.
    expect(sessionsScreen.onKey!({ name: "down", ctrl: false }, state, model)).toBe(true);
    expect(state.selectedIndex).toBe(9);

    expect(sessionsScreen.onKey!({ name: "g", ctrl: false }, state, model)).toBe(true);
    expect(state.selectedIndex).toBe(0);

    // k/up at the top clamps at 0 rather than going negative.
    expect(sessionsScreen.onKey!({ name: "up", ctrl: false }, state, model)).toBe(true);
    expect(state.selectedIndex).toBe(0);
  });

  test("unrelated keys are not consumed", () => {
    const state = makeState();
    expect(sessionsScreen.onKey!({ name: "x", ctrl: false }, state, makeModel(5))).toBe(false);
  });

  test("a null model (build failed before first success) doesn't throw and clamps to 0", () => {
    const state = makeState({ selectedIndex: 0 });
    expect(sessionsScreen.onKey!({ name: "G", ctrl: false }, state, null)).toBe(true);
    expect(state.selectedIndex).toBe(0);
  });
});

describe("renderSessions — scroll-follow keeps the selected row visible", () => {
  const rows = contentRows(24); // table body is a handful of rows tall — far fewer than 40 sessions
  const model = makeModel(40);

  test("selecting a far-down row (via G) brings it into view on the next render", () => {
    const state = makeState({ scrollOffset: 0, selectedIndex: 0 });

    // Session #39 (reads=39) is off-screen at the initial scroll position.
    const before = renderSessions(model, state, 80, rows).toString();
    expect(before).not.toContain("sess-fixture-39");

    sessionsScreen.onKey!({ name: "G", ctrl: false }, state, model);
    const after = renderSessions(model, state, 80, rows).toString();
    expect(after).toContain("sess-fixture-39");
  });

  test("stepping back up with k eventually scrolls the window back toward the top", () => {
    const state = makeState({ scrollOffset: 0, selectedIndex: 0 });
    sessionsScreen.onKey!({ name: "G", ctrl: false }, state, model);
    renderSessions(model, state, 80, rows); // let scrollOffset settle at the bottom

    sessionsScreen.onKey!({ name: "g", ctrl: false }, state, model);
    const frame = renderSessions(model, state, 80, rows).toString();
    expect(frame).toContain("sess-fixture-0");
  });
});

// Type-only assertion: keeps the exported SessionsModel/SessionRow shapes in
// sync with what tests construct above.
const _typeCheck: SessionsModel | undefined = undefined;
void _typeCheck;
