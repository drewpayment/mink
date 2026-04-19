"use client";

import { useMemo } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Kpi } from "@/components/ui/kpi";
import { Bar } from "@/components/ui/bar";
import { Btn } from "@/components/ui/btn";
import { BarChart, type BarDatum } from "@/components/ui/bar-chart";
import { formatNum } from "@/lib/format";
import type { LedgerSession } from "@mink/types/token-ledger";

function dayKey(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

function groupDays(sessions: LedgerSession[], windowDays = 7): BarDatum[] {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: Record<string, number> = {};
  const order: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now - i * dayMs);
    const key = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    buckets[key] = 0;
    order.push(key);
  }
  for (const s of sessions) {
    const key = dayKey(s.startTimestamp);
    if (key in buckets) buckets[key] += s.totals?.estimatedTokens ?? 0;
  }
  return order.map((label) => ({ label, value: buckets[label], color: "var(--fg-2)" }));
}

export function TokenPanel() {
  const ledger = useDashboardStore((s) => s.ledger);

  const sessions = ledger?.sessions ?? [];
  const lt = ledger?.lifetime;
  const days = useMemo(() => groupDays(sessions, 7), [sessions]);

  const total7 = days.reduce((acc, d) => acc + d.value, 0);
  const savings7 = sessions
    .filter((s) => {
      const t = new Date(s.startTimestamp).getTime();
      return Date.now() - t < 7 * 24 * 60 * 60 * 1000;
    })
    .reduce((acc, s) => acc + (s.estimatedSavings ?? 0), 0);
  const ratio = total7 > 0 ? ((savings7 / (total7 + savings7)) * 100).toFixed(1) : "0.0";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Token ledger</h1>
          <p className="page-sub">Persistent usage history — per session, per day</p>
        </div>
        <div className="page-actions">
          <Btn icon="download" variant="ghost" disabled title="CSV export coming soon">Export CSV</Btn>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <Kpi label="Lifetime tokens" value={formatNum(lt?.totalTokens ?? 0)} />
        <Kpi label="Lifetime reads"  value={formatNum(lt?.totalReads  ?? 0)} />
        <Kpi label="Lifetime writes" value={formatNum(lt?.totalWrites ?? 0)} />
        <Kpi label="Lifetime saved"  value={formatNum(lt?.totalEstimatedSavings ?? 0)} deltaTone="up" delta="▲ savings" />
      </div>

      <div className="grid g-2">
        <Card title="Daily usage" sub="last 7 days · tokens">
          <BarChart bars={days} width={560} height={180} />
        </Card>
        <Card title="7-day savings" sub={`ratio ${ratio}%`}>
          <div className="vstack">
            <div>
              <div className="row" style={{ marginBottom: 3 }}>
                <span style={{ fontSize: 12 }}>Tokens processed</span>
                <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>{formatNum(total7)}</span>
              </div>
              <Bar value={total7} max={Math.max(total7 + savings7, 1)} />
            </div>
            <div>
              <div className="row" style={{ marginBottom: 3 }}>
                <span style={{ fontSize: 12 }}>Tokens saved</span>
                <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>{formatNum(savings7)}</span>
              </div>
              <Bar value={savings7} max={Math.max(total7 + savings7, 1)} tone="amber" />
            </div>
            <div>
              <div className="row" style={{ marginBottom: 3 }}>
                <span style={{ fontSize: 12 }}>File-index hits</span>
                <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>{formatNum(lt?.totalFileIndexHits ?? 0)}</span>
              </div>
              <Bar value={lt?.totalFileIndexHits ?? 0} max={Math.max(1, (lt?.totalFileIndexHits ?? 0) + (lt?.totalFileIndexMisses ?? 0))} />
            </div>
          </div>
        </Card>
      </div>

      <div style={{ height: 14 }} />

      <Card title="Per-session breakdown" sub={`${sessions.length} sessions`} flush>
        {sessions.length === 0 ? (
          <div className="empty"><h4>No sessions yet</h4></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Session</th>
                <th>Started</th>
                <th className="right">Reads</th>
                <th className="right">Writes</th>
                <th className="right">Tokens</th>
                <th className="right">Saved</th>
                <th>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {[...sessions].reverse().slice(0, 30).map((s) => {
                const tokens = s.totals?.estimatedTokens ?? 0;
                const saved = s.estimatedSavings ?? 0;
                const r = tokens > 0 ? (saved / (tokens + saved)) * 100 : 0;
                return (
                  <tr key={s.sessionId}>
                    <td className="mono">{s.sessionId}</td>
                    <td>{s.startTimestamp ? new Date(s.startTimestamp).toLocaleString() : "—"}</td>
                    <td className="right num">{s.totals?.readCount ?? 0}</td>
                    <td className="right num">{s.totals?.writeCount ?? 0}</td>
                    <td className="right num">{formatNum(tokens)}</td>
                    <td className="right num strong">{formatNum(saved)}</td>
                    <td style={{ width: 160 }}>
                      <div className="row">
                        <Bar value={r} max={100} />
                        <span className="mono muted" style={{ fontSize: 10 }}>{r.toFixed(0)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
