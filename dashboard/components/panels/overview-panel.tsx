"use client";

import { useMemo } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Kpi } from "@/components/ui/kpi";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Bar } from "@/components/ui/bar";
import { LineChart, type LineSeries } from "@/components/ui/line-chart";
import { formatUptime } from "@/lib/format";
import type { LedgerSession } from "@mink/types/token-ledger";

function fmt(n: number | undefined | null): string {
  if (!n) return "0";
  return n.toLocaleString();
}

function dayKey(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
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

function groupLast7Days(sessions: LedgerSession[]): DayAgg[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: Record<string, DayAgg> = {};
  const order: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const key = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    buckets[key] = { x: key, inT: 0, outT: 0, saved: 0 };
    order.push(key);
  }
  for (const s of sessions) {
    const key = dayKey(s.startTimestamp);
    if (!buckets[key]) continue;
    const reads = (s.totals?.estimatedTokens ?? 0);
    const writes = (s.totals?.writeCount ?? 0) * 600;
    buckets[key].inT += Math.max(0, reads - writes);
    buckets[key].outT += writes;
    buckets[key].saved += s.estimatedSavings ?? 0;
  }
  return order.map((k) => buckets[k]);
}

export function OverviewPanel() {
  const overview = useDashboardStore((s) => s.overview);
  const ledger = useDashboardStore((s) => s.ledger);
  const health = useDashboardStore((s) => s.health);

  const summary = overview?.summary;
  const sessions = ledger?.sessions ?? [];
  const liveSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

  const agg = useMemo(() => groupLast7Days(sessions), [sessions]);
  const series: LineSeries[] = [
    { name: "saved", color: "var(--accent)", fill: true,  data: agg.map((a) => ({ x: a.x, y: Math.round(a.saved / 1000) })) },
    { name: "in",    color: "var(--fg-2)",   fill: false, data: agg.map((a) => ({ x: a.x, y: Math.round(a.inT   / 1000) })) },
    { name: "out",   color: "var(--fg-3)",   fill: false, data: agg.map((a) => ({ x: a.x, y: Math.round(a.outT  / 1000) })) },
  ];

  const activeReads = liveSession?.totals?.readCount ?? 0;
  const activeWrites = liveSession?.totals?.writeCount ?? 0;
  const activeTokens = liveSession?.totals?.estimatedTokens ?? 0;
  const activeSaved = liveSession?.estimatedSavings ?? 0;
  const isLive = liveSession && !liveSession.endTimestamp;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Sessions</h1>
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

      {/* Active session */}
      <Card
        title={
          <span className="row tight">
            <span>{isLive ? "Active session" : "Most recent session"}</span>
            {isLive && <span className="chip accent mono">● live</span>}
          </span>
        }
        sub={
          <span className="mono">
            {liveSession?.sessionId ?? "—"}
          </span>
        }
      >
        <div className="grid g-4" style={{ marginBottom: 12 }}>
          <Kpi label="Tokens (session)" value={fmt(activeTokens)}  live={!!isLive} />
          <Kpi label="Reads"             value={fmt(activeReads)}   live={!!isLive} />
          <Kpi label="Writes"            value={fmt(activeWrites)}  live={!!isLive} />
          <Kpi
            label="Saved"
            value={fmt(activeSaved)}
            deltaTone="up"
            delta={activeSaved > 0 ? "▲ vs unassisted" : undefined}
            spark={agg.map((a) => Math.round(a.saved / 1000))}
            sparkTone="accent"
            live={!!isLive}
          />
        </div>

        <div className="grid g-3">
          <div>
            <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontWeight: 600 }}>Reads</div>
            <div className="row"><span className="mono strong" style={{ fontSize: 20 }}>{activeReads}</span><Bar value={activeReads} max={200} /></div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontWeight: 600 }}>Writes</div>
            <div className="row"><span className="mono strong" style={{ fontSize: 20 }}>{activeWrites}</span><Bar value={activeWrites} max={80} /></div>
          </div>
          <div>
            <div style={{ fontSize: 10.5, color: "var(--fg-3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4, fontWeight: 600 }}>File-index hits</div>
            <div className="row">
              <span className="mono strong" style={{ fontSize: 20 }}>{liveSession?.totals?.fileIndexHits ?? 0}</span>
              <Bar value={liveSession?.totals?.fileIndexHits ?? 0} max={Math.max(1, (liveSession?.totals?.fileIndexHits ?? 0) + (liveSession?.totals?.fileIndexMisses ?? 0))} />
            </div>
          </div>
        </div>
      </Card>

      <div style={{ height: 14 }} />

      <div className="grid g-2">
        <Card title="Token usage — last 7 days" sub="in · out · saved">
          <LineChart series={series} width={560} height={180} />
          <div className="chart-legend">
            <span><i style={{ background: "var(--accent)" }} />saved</span>
            <span><i style={{ background: "var(--fg-2)" }} />in</span>
            <span><i style={{ background: "var(--fg-3)" }} />out</span>
          </div>
        </Card>

        <Card title="Lifetime totals" sub="from token ledger">
          <div className="vstack">
            <Kpi label="Total sessions" value={fmt(summary?.totalSessions)} className="kpi" />
            <Kpi label="Total tokens"   value={fmt(summary?.totalTokens)} />
            <Kpi label="Savings · estimated" value={fmt(summary?.estimatedSavings)} deltaTone="up" delta="▲ heuristic" />
            <Kpi label="Savings · measured"  value={fmt(overview?.compression?.totalMeasuredSavings)} deltaTone="up" delta="▲ compression" />
          </div>
        </Card>
      </div>

      <div style={{ height: 14 }} />

      <Card title="Session history" sub={`${sessions.length} sessions`} flush>
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
                <th className="right">Saved</th>
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
                  <td>{s.startTimestamp ? new Date(s.startTimestamp).toLocaleString() : "—"}</td>
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
