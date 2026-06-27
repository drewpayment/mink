"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Kpi } from "@/components/ui/kpi";
import { Bar } from "@/components/ui/bar";
import { BarChart, type BarDatum } from "@/components/ui/bar-chart";
import { formatNum } from "@/lib/format";
import { useFormat } from "@/hooks/use-format";
import type { CompressionBreakdownRow } from "@mink/types/token-ledger";

function pct(n: number, d: number): number {
  return d > 0 ? (n / d) * 100 : 0;
}

function BreakdownTable({ title, sub, rows }: { title: string; sub: string; rows: CompressionBreakdownRow[] }) {
  return (
    <Card title={title} sub={sub} flush>
      {rows.length === 0 ? (
        <div className="empty"><h4>No data</h4></div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>{title.includes("tool") ? "Tool" : "Kind"}</th>
              <th className="right">Events</th>
              <th className="right">Original</th>
              <th className="right">Compressed</th>
              <th className="right">Saved</th>
              <th>Ratio</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const ratio = pct(r.savings, r.originalTokens);
              return (
                <tr key={r.key}>
                  <td className="mono">{r.key}</td>
                  <td className="right num">{r.events}</td>
                  <td className="right num">{formatNum(r.originalTokens)}</td>
                  <td className="right num">{formatNum(r.compressedTokens)}</td>
                  <td className="right num strong">{formatNum(r.savings)}</td>
                  <td style={{ width: 150 }}>
                    <div className="row">
                      <Bar value={ratio} max={100} tone="amber" />
                      <span className="mono muted" style={{ fontSize: 10 }}>{ratio.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}

export function CompressionPanel() {
  const c = useDashboardStore((s) => s.compression);
  const { formatDateTime } = useFormat();

  const lifetime = c?.lifetime;
  const arms = c?.arms;
  const enabled = c?.enabled ?? false;
  const events = lifetime?.totalEvents ?? 0;

  // Headline metrics come from the compressed arm only (the holdout arm passes
  // the original through unchanged, so it would dilute the ratio).
  const origC = arms?.compressed.originalTokens ?? 0;
  const compC = arms?.compressed.compressedTokens ?? 0;
  const savings = lifetime?.totalMeasuredSavings ?? Math.max(0, origC - compC);
  const ratioPct = pct(savings, origC);

  const compEvents = arms?.compressed.events ?? 0;
  const holdoutEvents = lifetime?.totalHoldoutEvents ?? 0;
  const holdoutOrig = arms?.holdout.originalTokens ?? 0;

  // Holdout A/B: average original size of each arm should be comparable (no
  // selection bias), and we project what the held-out control would have saved.
  const avgCompressed = compEvents > 0 ? origC / compEvents : 0;
  const avgHoldout = holdoutEvents > 0 ? holdoutOrig / holdoutEvents : 0;
  const projectedHoldoutSavings = origC > 0 ? holdoutOrig * (savings / origC) : 0;

  const beforeAfter: BarDatum[] = [
    { label: "original", value: origC, color: "var(--fg-2)" },
    { label: "compressed", value: compC, color: "var(--accent)" },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Compression</h1>
          <p className="page-sub">Measured tool-output compression — reversible, holdout-validated</p>
        </div>
      </div>

      {events === 0 ? (
        <Card title="No compression activity" sub={enabled ? "enabled" : "disabled"}>
          <div className="empty">
            <h4>{enabled ? "No compression events yet" : "Compression is disabled"}</h4>
            <p className="muted" style={{ fontSize: 12 }}>
              {enabled
                ? "Large tool outputs (Read / Bash / Grep / MCP) will appear here once compressed."
                : "Enable it with:"}
            </p>
            {!enabled && (
              <pre className="mono" style={{ fontSize: 12, marginTop: 8 }}>
                mink config set compression.enabled true
              </pre>
            )}
          </div>
        </Card>
      ) : (
        <>
          <div className="grid g-4" style={{ marginBottom: 14 }}>
            <Kpi
              label="Measured savings"
              value={formatNum(savings)}
              deltaTone="up"
              delta="▲ tokens"
            />
            <Kpi label="Compression ratio" value={`${ratioPct.toFixed(0)}%`} />
            <Kpi label="Compressed events" value={formatNum(compEvents)} />
            <Kpi label="Held out (control)" value={formatNum(holdoutEvents)} />
          </div>

          <div className="grid g-2">
            <Card title="Before → after" sub={`compressed arm · ${formatNum(origC)} → ${formatNum(compC)} tokens`}>
              <BarChart bars={beforeAfter} width={560} height={180} />
            </Card>

            <Card title="Holdout A/B" sub="measured vs control">
              <div className="vstack">
                <div className="row">
                  <span style={{ fontSize: 12 }}>Compressed — avg original</span>
                  <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>{formatNum(Math.round(avgCompressed))} tok</span>
                </div>
                <div className="row">
                  <span style={{ fontSize: 12 }}>Holdout — avg original</span>
                  <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>{formatNum(Math.round(avgHoldout))} tok</span>
                </div>
                <div className="row">
                  <span style={{ fontSize: 12 }}>Realised savings (compressed)</span>
                  <span className="mono strong" style={{ marginLeft: "auto", fontSize: 11 }}>{formatNum(savings)} tok</span>
                </div>
                <div className="row">
                  <span style={{ fontSize: 12 }}>Projected if control compressed</span>
                  <span className="mono muted" style={{ marginLeft: "auto", fontSize: 11 }}>~{formatNum(Math.round(projectedHoldoutSavings))} tok</span>
                </div>
                <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                  Comparable average original sizes across arms indicate the savings reflect compression, not selection bias.
                </p>
              </div>
            </Card>
          </div>

          <div style={{ height: 14 }} />

          <div className="grid g-2">
            <BreakdownTable title="By content kind" sub={`${c?.byKind.length ?? 0} kinds`} rows={c?.byKind ?? []} />
            <BreakdownTable title="By tool" sub={`${c?.byTool.length ?? 0} tools`} rows={c?.byTool ?? []} />
          </div>

          <div style={{ height: 14 }} />

          <Card title="Recent events" sub={`${c?.recent.length ?? 0} most recent`} flush>
            {(c?.recent.length ?? 0) === 0 ? (
              <div className="empty"><h4>No events</h4></div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Tool</th>
                    <th>Kind</th>
                    <th className="right">Original</th>
                    <th className="right">Compressed</th>
                    <th>Arm</th>
                  </tr>
                </thead>
                <tbody>
                  {(c?.recent ?? []).map((e) => (
                    <tr key={e.id}>
                      <td>{e.createdAt ? formatDateTime(e.createdAt) : "—"}</td>
                      <td className="mono">{e.toolName}</td>
                      <td className="mono">{e.contentKind}</td>
                      <td className="right num">{formatNum(e.originalTokens)}</td>
                      <td className="right num">{formatNum(e.compressedTokens)}</td>
                      <td>{e.holdout ? <span className="muted">control</span> : <span className="strong">compressed</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
