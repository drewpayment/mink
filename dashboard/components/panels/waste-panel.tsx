"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Kpi } from "@/components/ui/kpi";
import { Chip } from "@/components/ui/chip";
import { Bar } from "@/components/ui/bar";
import { Btn } from "@/components/ui/btn";
import { formatNum } from "@/lib/format";
import { useFormat } from "@/hooks/use-format";
import type { WasteFlag, WastePattern } from "@mink/types/waste-detection";

// Pattern severity mapping — impact heuristic based on tokens wasted.
function severityFor(flag: WasteFlag): "high" | "med" | "low" {
  const t = flag.estimatedTokensWasted;
  if (t >= 10_000) return "high";
  if (t >= 2_000) return "med";
  return "low";
}

function toneFor(sev: "high" | "med" | "low"): "red" | "amber" | "" {
  return sev === "high" ? "red" : sev === "med" ? "amber" : "";
}

function patternLabel(p: WastePattern): string {
  return p.replaceAll("-", " ");
}

export function WastePanel() {
  const flags = useDashboardStore((s) => s.wasteFlags);
  const { formatTime } = useFormat();

  const total = flags.reduce((acc, f) => acc + f.estimatedTokensWasted, 0);
  const counts = flags.reduce(
    (acc, f) => {
      const sev = severityFor(f);
      acc[sev] += 1;
      return acc;
    },
    { high: 0, med: 0, low: 0 },
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Waste detection</h1>
          <p className="page-sub">Token waste patterns — redundancies, oversized scans, stale caches</p>
        </div>
        <div className="page-actions">
          <Btn icon="refresh" disabled title="Detection runs on the daemon's waste-detect cron">Re-scan</Btn>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <Kpi label="Wasted (tok)" value={formatNum(total)} />
        <Kpi label="Patterns" value={flags.length} delta={`${counts.high} high · ${counts.med} med · ${counts.low} low`} />
        <Kpi label="Est. $ lost" value={`$${(total / 1_000_000 * 3).toFixed(2)}`} delta="@ $3 / Mtok" />
        <Kpi label="Last scan" value={flags[0] ? formatTime(flags[0].detectedAt) : "—"} />
      </div>

      <Card title="Detected patterns" sub="sorted by impact" flush>
        {flags.length === 0 ? (
          <div className="empty">
            <h4>No waste patterns detected</h4>
            <span>waste-detect cron will populate this when patterns emerge.</span>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Pattern</th>
                <th>Description</th>
                <th className="right">Loss (tok)</th>
                <th className="right">Impact</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {[...flags]
                .sort((a, b) => b.estimatedTokensWasted - a.estimatedTokensWasted)
                .map((f, i) => {
                  const sev = severityFor(f);
                  return (
                    <tr key={`${f.pattern}-${i}`}>
                      <td><Chip tone={toneFor(sev)}>{sev}</Chip></td>
                      <td className="mono" style={{ fontSize: 11 }}>{patternLabel(f.pattern)}</td>
                      <td>{f.description}</td>
                      <td className="right num strong">{formatNum(f.estimatedTokensWasted)}</td>
                      <td className="right" style={{ width: 160 }}>
                        <Bar
                          value={f.estimatedTokensWasted}
                          max={Math.max(total || 1, f.estimatedTokensWasted)}
                          tone={sev === "high" ? "red" : sev === "med" ? "amber" : ""}
                        />
                      </td>
                      <td className="right">
                        <Btn size="sm" variant="ghost" title={f.suggestion}>
                          Suggestion
                        </Btn>
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
