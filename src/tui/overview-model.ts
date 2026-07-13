// Pure, ANSI-free, layout-free data layer for the TUI Overview screen.
//
// buildOverviewModel(cwd) is a thin wrapper around the three dashboard-api
// loaders; deriveOverviewModel(overview, ledger, compression) is the pure
// core so tests can exercise every derivation with fixture payloads and no
// DB. All derivations are ported faithfully from
// dashboard/components/panels/overview-panel.tsx so the numbers shown here
// match the web dashboard's Overview panel for the same project state.
import {
  loadOverview,
  loadTokenLedgerPanel,
  loadCompressionPanel,
} from "../core/dashboard-api";
import type {
  OverviewPayload,
  TokenLedgerPayload,
  CompressionPayload,
} from "../types/dashboard";
import type { LedgerSession } from "../types/token-ledger";

// ── Model ────────────────────────────────────────────────────────────────

export interface OverviewModel {
  project: string;
  daemon: { running: boolean; uptimeMs: number | null };
  savings: { total: number; heuristic: number; measured: number };
  lifetime: {
    totalTokens: number;
    totalSessions: number;
    heuristicSavings: number;
    measuredSavings: number;
    compRatioPct: number;
  };
  last7Days: Array<{ day: string; saved: number; tokensIn: number; writes: number }>;
  currentSession: {
    id: string;
    isActive: boolean;
    endedAt: string | null;
    reads: number;
    writes: number;
    tokens: number;
    saved: number;
    indexHits: number;
    indexMisses: number;
  } | null;
  compression: {
    enabled: boolean;
    originalTokens: number;
    compressedTokens: number;
    events: number;
    holdoutEvents: number;
    measuredSavings: number;
    ratioPct: number;
    hasData: boolean;
  };
  history: Array<{
    id: string;
    start: string;
    durationMs: number;
    reads: number;
    writes: number;
    tokens: number;
    saved: number;
  }>;
}

// ── Helpers ──────────────────────────────────────────────────────────────

// Mirrors overview-panel.tsx's local `pct` helper: ratio as a 0-100 number,
// 0 (not NaN) when the denominator is non-positive.
function pct(n: number, d: number): number {
  return d > 0 ? (n / d) * 100 : 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Port of groupLast7Days (overview-panel.tsx:60-81). Per-session heuristic
// savings only — measured compression has no per-session attribution, so it
// is deliberately excluded from these daily buckets (see the compression
// section of the model for the lifetime measured figure).
function buildLast7Days(
  sessions: LedgerSession[],
  now: number = Date.now(),
): OverviewModel["last7Days"] {
  const buckets = new Map<string, { day: string; saved: number; tokensIn: number; writes: number }>();
  const order: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS);
    const key = localDayKey(d);
    buckets.set(key, { day: fmtDay(d), saved: 0, tokensIn: 0, writes: 0 });
    order.push(key);
  }
  for (const s of sessions) {
    if (!s.startTimestamp) continue;
    const ts = new Date(s.startTimestamp);
    if (Number.isNaN(ts.getTime())) continue;
    const bucket = buckets.get(localDayKey(ts));
    if (!bucket) continue;
    const reads = s.totals?.estimatedTokens ?? 0;
    const writeTokens = (s.totals?.writeCount ?? 0) * 600;
    bucket.tokensIn += Math.max(0, reads - writeTokens);
    bucket.writes += writeTokens;
    bucket.saved += s.estimatedSavings ?? 0;
  }
  return order.map((k) => buckets.get(k)!);
}

// Most recent session (last in array), matching overview-panel.tsx's
// `liveSession = sessions[sessions.length - 1]`.
function buildCurrentSession(sessions: LedgerSession[]): OverviewModel["currentSession"] {
  if (sessions.length === 0) return null;
  const s = sessions[sessions.length - 1];
  return {
    id: s.sessionId,
    isActive: !s.endTimestamp,
    endedAt: s.endTimestamp || null,
    reads: s.totals?.readCount ?? 0,
    writes: s.totals?.writeCount ?? 0,
    tokens: s.totals?.estimatedTokens ?? 0,
    saved: s.estimatedSavings ?? 0,
    indexHits: s.totals?.fileIndexHits ?? 0,
    indexMisses: s.totals?.fileIndexMisses ?? 0,
  };
}

// Port of the "Session history" table (overview-panel.tsx:345):
// [...sessions].reverse().slice(0, 30) — newest first, capped at 30.
// durationMs for a still-active session (no endTimestamp) is measured
// against `now` so it keeps advancing across refresh ticks.
function buildHistory(
  sessions: LedgerSession[],
  now: number = Date.now(),
): OverviewModel["history"] {
  return [...sessions]
    .reverse()
    .slice(0, 30)
    .map((s) => {
      const startMs = s.startTimestamp ? new Date(s.startTimestamp).getTime() : NaN;
      const endMs = s.endTimestamp ? new Date(s.endTimestamp).getTime() : now;
      const durationMs = Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : 0;
      return {
        id: s.sessionId,
        start: s.startTimestamp,
        durationMs,
        reads: s.totals?.readCount ?? 0,
        writes: s.totals?.writeCount ?? 0,
        tokens: s.totals?.estimatedTokens ?? 0,
        saved: s.estimatedSavings ?? 0,
      };
    });
}

// ── Assembly ─────────────────────────────────────────────────────────────

export function deriveOverviewModel(
  overview: OverviewPayload,
  ledger: TokenLedgerPayload,
  compression: CompressionPayload,
): OverviewModel {
  const sessions = ledger.sessions ?? [];

  // Savings split — two mechanisms, both lifetime aggregates
  // (overview-panel.tsx:164-167).
  const heuristicSavings = overview.summary?.estimatedSavings ?? 0;
  const measuredSavings =
    compression.lifetime?.totalMeasuredSavings ?? overview.compression?.totalMeasuredSavings ?? 0;
  const totalSaved = heuristicSavings + measuredSavings;

  // Compression detail — compressed arm only; holdout passes original
  // through unmodified (overview-panel.tsx:170-175).
  const compOrig =
    compression.arms?.compressed.originalTokens ?? overview.compression?.totalOriginalTokens ?? 0;
  const compComp =
    compression.arms?.compressed.compressedTokens ?? overview.compression?.totalCompressedTokens ?? 0;
  const compEvents =
    compression.arms?.compressed.events ?? overview.compression?.totalEvents ?? 0;
  const holdoutEvents =
    compression.lifetime?.totalHoldoutEvents ?? overview.compression?.totalHoldoutEvents ?? 0;
  const compRatioPct = pct(measuredSavings, compOrig);
  const hasCompressionData = compEvents > 0 || measuredSavings > 0;

  return {
    project: overview.project?.name ?? "—",
    daemon: {
      running: overview.daemon?.running ?? false,
      uptimeMs: overview.daemon?.running ? overview.daemon?.uptimeMs ?? null : null,
    },
    savings: { total: totalSaved, heuristic: heuristicSavings, measured: measuredSavings },
    lifetime: {
      totalTokens: overview.summary?.totalTokens ?? 0,
      totalSessions: overview.summary?.totalSessions ?? 0,
      heuristicSavings,
      measuredSavings,
      compRatioPct,
    },
    last7Days: buildLast7Days(sessions),
    currentSession: buildCurrentSession(sessions),
    compression: {
      enabled: compression.enabled ?? false,
      originalTokens: compOrig,
      compressedTokens: compComp,
      events: compEvents,
      holdoutEvents,
      measuredSavings,
      ratioPct: compRatioPct,
      hasData: hasCompressionData,
    },
    history: buildHistory(sessions),
  };
}

export function buildOverviewModel(cwd: string): OverviewModel {
  const overview = loadOverview(cwd);
  const ledger = loadTokenLedgerPanel(cwd);
  const compression = loadCompressionPanel(cwd);
  return deriveOverviewModel(overview, ledger, compression);
}

// ── Formatting helpers ──────────────────────────────────────────────────

// "1.23M", "45.6k", "987" — compact number formatting for narrow terminal
// columns. Uses more precision than the web dashboard's formatNum (which
// shows "1.2M") since TUI stat tiles have room for it and value density
// matters more than glanceability here.
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(2) + "M";
  if (abs >= 1_000) return sign + (abs / 1_000).toFixed(1) + "k";
  return sign + String(Math.round(abs));
}

// "2h 14m", "45s" — duration formatting, e.g. session length or daemon
// uptime. Unlike the web dashboard's formatUptime, non-positive input
// renders as "0s" rather than "—": in the TUI a duration always describes
// something concrete (an elapsed session), never an absent value.
export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return `${hr}h ${min % 60}m`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

export interface FmtTimeOpts {
  timezone?: "local" | "utc";
  clock?: "12h" | "24h";
}

// Time-only ("4:22 PM" / "16:22"), matching dashboard/lib/format.ts's
// formatTime conventions (timezone + clock preference, "—" for empty/invalid).
export function fmtTime(iso: string, opts: FmtTimeOpts = {}): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hour12 = opts.clock === "12h" ? true : opts.clock === "24h" ? false : undefined;
  const timeZone = opts.timezone === "utc" ? "UTC" : undefined;
  try {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12, timeZone });
  } catch {
    return iso;
  }
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// "Mon 7/8" — day label for the last-7-days chart axis. Built from raw date
// components (not Intl) so it is locale-independent and deterministic in
// tests.
export function fmtDay(date: Date): string {
  return `${WEEKDAYS[date.getDay()]} ${date.getMonth() + 1}/${date.getDate()}`;
}
