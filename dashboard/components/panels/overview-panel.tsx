"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Kpi } from "@/components/ui/kpi";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Bar } from "@/components/ui/bar";
import { Icon } from "@/components/ui/icon";
import { LineChart, type LineSeries } from "@/components/ui/line-chart";
import { BarChart, type BarDatum } from "@/components/ui/bar-chart";
import { formatUptime } from "@/lib/format";
import { useFormat } from "@/hooks/use-format";
import type { TimezoneMode } from "@/lib/format";
import type { LedgerSession } from "@mink/types/token-ledger";

function fmt(n: number | undefined | null): string {
  if (!n) return "0";
  return n.toLocaleString();
}

function pct(n: number, d: number): number {
  return d > 0 ? (n / d) * 100 : 0;
}

const miniLabel: React.CSSProperties = {
  fontSize: 10.5,
  color: "var(--fg-3)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 4,
  fontWeight: 600,
};

function dayKey(iso: string, timezone: TimezoneMode = "local"): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: timezone === "utc" ? "UTC" : undefined,
    });
  } catch {
    return iso.slice(0, 10);
  }
}

interface DayAgg {
  x: string;
  inT: number;
  outT: number;
  saved: number;
}

// Per-session heuristic only. Measured compression has no per-session/per-day
// attribution (no session_id on compression events), so it is deliberately
// NOT folded into these daily buckets — see the Compression card for the
// lifetime measured figure.
function groupLast7Days(sessions: LedgerSession[], timezone: TimezoneMode = "local"): DayAgg[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: Record<string, DayAgg> = {};
  const order: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const key = dayKey(d.toISOString(), timezone);
    buckets[key] = { x: key, inT: 0, outT: 0, saved: 0 };
    order.push(key);
  }
  for (const s of sessions) {
    const key = dayKey(s.startTimestamp, timezone);
    if (!buckets[key]) continue;
    const reads = (s.totals?.estimatedTokens ?? 0);
    const writes = (s.totals?.writeCount ?? 0) * 600;
    buckets[key].inT += Math.max(0, reads - writes);
    buckets[key].outT += writes;
    buckets[key].saved += s.estimatedSavings ?? 0;
  }
  return order.map((k) => buckets[k]);
}

/**
 * Hero decomposition: total saved = heuristic read savings + measured
 * compression savings. The two measure disjoint token streams (avoided
 * re-reads vs. shrunk tool output), so they are honestly additive. The bar
 * shows the contribution split; chips encode the trust level of each mechanism
 * (muted "est." vs. accent "measured").
 */
function SavingsBreakdown({ heuristic, measured }: { heuristic: number; measured: number }) {
  const total = heuristic + measured;
  const hPct = total > 0 ? (heuristic / total) * 100 : 100;
  const mPct = total > 0 ? (measured / total) * 100 : 0;

  return (
    <div>
      <div className="row" style={{ alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <span className="mono strong" style={{ fontSize: 34, lineHeight: 1 }}>{fmt(total)}</span>
        <span className="muted" style={{ fontSize: 12 }}>tokens saved · lifetime</span>
      </div>

      {/* Stacked contribution bar */}
      <div
        className="row"
        style={{ height: 12, borderRadius: 6, overflow: "hidden", background: "var(--bg-2)", gap: 0 }}
        role="img"
        aria-label={`Read savings ${heuristic} tokens, compression savings ${measured} tokens`}
      >
        <span style={{ width: `${hPct}%`, background: "var(--fg-2)", display: "block", height: "100%" }} />
        <span style={{ width: `${mPct}%`, background: "var(--accent)", display: "block", height: "100%" }} />
      </div>

      <div className="grid g-2" style={{ marginTop: 12, gap: 16 }}>
        <div>
          <div className="row tight" style={{ gap: 6 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: "var(--fg-2)", display: "inline-block" }} />
            <span style={{ fontSize: 12 }}>Read savings</span>
            <Chip>est.</Chip>
          </div>
          <div className="mono strong" style={{ fontSize: 18, marginTop: 2 }}>{fmt(heuristic)}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>avoided re-reads via file index</div>
        </div>
        <div>
          <div className="row tight" style={{ gap: 6 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: "var(--accent)", display: "inline-block" }} />
            <span style={{ fontSize: 12 }}>Compression savings</span>
            <Chip tone="accent">measured</Chip>
          </div>
          <div className="mono strong" style={{ fontSize: 18, marginTop: 2 }}>{fmt(measured)}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>
            {measured > 0 ? "shrunk tool output, byte-reversible" : "not active yet"}
          </div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 11, marginTop: 12 }}>
        Two mechanisms, disjoint token streams: <strong>read savings</strong> is an estimate of context Mink
        kept the model from re-reading; <strong>compression savings</strong> is a measured byte delta on tool
        output. They sum without double-counting.
      </p>
    </div>
  );
}

export function OverviewPanel() {
  const overview = useDashboardStore((s) => s.overview);
  const ledger = useDashboardStore((s) => s.ledger);
  const compression = useDashboardStore((s) => s.compression);
  const health = useDashboardStore((s) => s.health);
  const { formatDateTime, timezone } = useFormat();

  const summary = overview?.summary;
  const sessions = ledger?.sessions ?? [];
  const liveSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

  const agg = useMemo(() => groupLast7Days(sessions, timezone), [sessions, timezone]);
  const series: LineSeries[] = [
    { name: "saved", color: "var(--accent)", fill: true,  data: agg.map((a) => ({ x: a.x, y: Math.round(a.saved / 1000) })) },
    { name: "in",    color: "var(--fg-2)",   fill: false, data: agg.map((a) => ({ x: a.x, y: Math.round(a.inT   / 1000) })) },
    { name: "out",   color: "var(--fg-3)",   fill: false, data: agg.map((a) => ({ x: a.x, y: Math.round(a.outT  / 1000) })) },
  ];

  // Savings — two mechanisms, both lifetime aggregates.
  const heuristicSavings = summary?.estimatedSavings ?? 0;
  const measuredSavings =
    compression?.lifetime.totalMeasuredSavings ?? overview?.compression?.totalMeasuredSavings ?? 0;
  const totalSaved = heuristicSavings + measuredSavings;

  // Compression detail (compressed arm only — holdout passes original through).
  const compOrig = compression?.arms.compressed.originalTokens ?? overview?.compression?.totalOriginalTokens ?? 0;
  const compComp = compression?.arms.compressed.compressedTokens ?? overview?.compression?.totalCompressedTokens ?? 0;
  const compEvents = compression?.arms.compressed.events ?? overview?.compression?.totalEvents ?? 0;
  const holdoutEvents = compression?.lifetime.totalHoldoutEvents ?? overview?.compression?.totalHoldoutEvents ?? 0;
  const compRatio = pct(measuredSavings, compOrig);
  const hasCompression = compEvents > 0 || measuredSavings > 0;

  const beforeAfter: BarDatum[] = [
    { label: "original", value: compOrig, color: "var(--fg-2)" },
    { label: "compressed", value: compComp, color: "var(--accent)" },
  ];

  // Current / live session.
  const activeReads = liveSession?.totals?.readCount ?? 0;
  const activeWrites = liveSession?.totals?.writeCount ?? 0;
  const activeTokens = liveSession?.totals?.estimatedTokens ?? 0;
  const activeSaved = liveSession?.estimatedSavings ?? 0;
  const isLive = !!(liveSession && !liveSession.endTimestamp);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">
            {overview?.project?.name ?? "—"} · {overview?.daemon?.running
              ? `daemon online · uptime ${formatUptime(health?.uptimeMs ?? 0)}`
              : "daemon offline"}
          </p>
        </div>
        <div className="page-actions">
          <Btn icon="refresh" variant="ghost" onClick={() => location.reload()}>Refresh</Btn>
        </div>
      </div>

      {/* Hero: combined total saved, decomposed into its two mechanisms */}
      <div className="grid g-2" style={{ gridTemplateColumns: "1.4fr 1fr", alignItems: "stretch" }}>
        <Card title="Total tokens saved" sub="read savings (est.) + compression (measured)">
          <SavingsBreakdown heuristic={heuristicSavings} measured={measuredSavings} />
        </Card>

        <Card title="Lifetime" sub="across all sessions">
          <div className="grid g-2" style={{ gap: 12 }}>
            <Kpi label="Total tokens" value={fmt(summary?.totalTokens)} />
            <Kpi label="Sessions" value={fmt(summary?.totalSessions)} />
            <Kpi
              label="Read savings · est."
              value={fmt(heuristicSavings)}
              deltaTone="up"
              delta="▲ heuristic"
              spark={agg.map((a) => Math.round(a.saved / 1000))}
              sparkTone="accent"
            />
            <Kpi
              label="Compression · measured"
              value={fmt(measuredSavings)}
              deltaTone="up"
              delta={hasCompression ? `▲ ${compRatio.toFixed(0)}% smaller` : "— inactive"}
            />
          </div>
        </Card>
      </div>

      <div style={{ height: 14 }} />

      {/* Historical trend beside the current session — the "at a glance" pairing */}
      <div className="grid g-2">
        <Card title="Token usage — last 7 days" sub="in · out · read savings (est., per session)">
          <LineChart series={series} width={560} height={180} />
          <div className="chart-legend">
            <span><i style={{ background: "var(--accent)" }} />read saved</span>
            <span><i style={{ background: "var(--fg-2)" }} />in</span>
            <span><i style={{ background: "var(--fg-3)" }} />out</span>
          </div>
        </Card>

        <Card
          title={
            <span className="row tight">
              <span>{isLive ? "Active session" : "Most recent session"}</span>
              {isLive && <span className="chip accent mono">● live</span>}
            </span>
          }
          sub={<span className="mono">{liveSession?.sessionId ?? "—"}</span>}
        >
          <div className="grid g-2" style={{ marginBottom: 12, gap: 12 }}>
            <Kpi label="Tokens (session)" value={fmt(activeTokens)} live={isLive} />
            <Kpi label="Read saved · est." value={fmt(activeSaved)} deltaTone="up" delta={activeSaved > 0 ? "▲ vs unassisted" : undefined} live={isLive} />
          </div>
          <div className="grid g-3">
            <div>
              <div style={miniLabel}>Reads</div>
              <div className="row"><span className="mono strong" style={{ fontSize: 18 }}>{activeReads}</span><Bar value={activeReads} max={200} /></div>
            </div>
            <div>
              <div style={miniLabel}>Writes</div>
              <div className="row"><span className="mono strong" style={{ fontSize: 18 }}>{activeWrites}</span><Bar value={activeWrites} max={80} /></div>
            </div>
            <div>
              <div style={miniLabel}>Index hits</div>
              <div className="row">
                <span className="mono strong" style={{ fontSize: 18 }}>{liveSession?.totals?.fileIndexHits ?? 0}</span>
                <Bar value={liveSession?.totals?.fileIndexHits ?? 0} max={Math.max(1, (liveSession?.totals?.fileIndexHits ?? 0) + (liveSession?.totals?.fileIndexMisses ?? 0))} />
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div style={{ height: 14 }} />

      {/* Compression summary — surfaces the measured mechanism inline, links to detail */}
      <Card
        title="Compression — measured savings"
        sub="reversible tool-output compression · lifetime"
        tools={
          <Link href="/compression" className="sb-item" style={{ fontSize: 11, padding: "2px 8px" }}>
            View detail <Icon name="chev" size={11} />
          </Link>
        }
      >
        {!hasCompression ? (
          <div className="empty">
            <h4>{overview?.compression || compression ? "No compression events yet" : "Compression inactive"}</h4>
            <p className="muted" style={{ fontSize: 12 }}>
              Your read savings above still apply. Large tool outputs (Read / Bash / Grep / MCP) will be measured
              here once compression runs. Enable with:
            </p>
            <pre className="mono" style={{ fontSize: 12, marginTop: 8 }}>mink config set compression.enabled true</pre>
          </div>
        ) : (
          <div className="grid g-2" style={{ gap: 16, alignItems: "center" }}>
            <div className="grid g-2" style={{ gap: 12 }}>
              <Kpi label="Measured savings" value={fmt(measuredSavings)} deltaTone="up" delta="▲ tokens" />
              <Kpi label="Compression ratio" value={`${compRatio.toFixed(0)}%`} />
              <Kpi label="Compressed events" value={fmt(compEvents)} />
              <Kpi
                label="Held out (control)"
                value={fmt(holdoutEvents)}
                delta={holdoutEvents === 0 ? "⚠ no A/B control yet" : undefined}
              />
            </div>
            <div>
              <BarChart bars={beforeAfter} width={360} height={150} />
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                ⓘ Lifetime totals — not broken down per session.
                {holdoutEvents === 0 && " Measured, but not yet holdout-validated."}
              </p>
            </div>
          </div>
        )}
      </Card>

      <div style={{ height: 14 }} />

      <Card title="Session history" sub={`${sessions.length} sessions · per-session read savings`} flush>
        {sessions.length === 0 ? (
          <div className="empty">
            <h4>No sessions recorded yet</h4>
            <span>start Claude Code in a project with mink hooks to see data.</span>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Status</th>
                <th>ID</th>
                <th>Started</th>
                <th className="right">Reads</th>
                <th className="right">Writes</th>
                <th className="right">Tokens</th>
                <th className="right">Read saved · est.</th>
              </tr>
            </thead>
            <tbody>
              {[...sessions].reverse().slice(0, 30).map((s) => (
                <tr key={s.sessionId}>
                  <td>
                    {s.endTimestamp
                      ? <span className="muted mono" style={{ fontSize: 10 }}>done</span>
                      : <Chip tone="accent">● live</Chip>}
                  </td>
                  <td className="mono">{s.sessionId}</td>
                  <td>{s.startTimestamp ? formatDateTime(s.startTimestamp) : "—"}</td>
                  <td className="right num">{s.totals?.readCount ?? 0}</td>
                  <td className="right num">{s.totals?.writeCount ?? 0}</td>
                  <td className="right num">{fmt(s.totals?.estimatedTokens)}</td>
                  <td className="right num"><span className="strong">{fmt(s.estimatedSavings)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
