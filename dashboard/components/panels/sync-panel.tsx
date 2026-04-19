"use client";

import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Toggle } from "@/components/ui/toggle";
import { MOCK_SYNC } from "@/lib/mock-dashboard-data";

export function SyncPanel() {
  const s = MOCK_SYNC;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Sync</span>
            <Chip tone="amber">preview</Chip>
          </h1>
          <p className="page-sub">Git-backed sync of ~/.mink across machines — auto pull on start, auto push on stop</p>
        </div>
        <div className="page-actions">
          <Btn icon="arrowDown" variant="ghost" disabled>Pull</Btn>
          <Btn icon="arrowUp" variant="primary" disabled>Push</Btn>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: 14 }}>● Connected</div>
          <div className="delta">{s.branch}</div>
        </div>
        <div className="kpi">
          <div className="label">Ahead / Behind</div>
          <div className="value mono">↑{s.ahead} ↓{s.behind}</div>
          <div className="delta">vs origin/{s.branch}</div>
        </div>
        <div className="kpi"><div className="label">Last push</div><div className="value mono" style={{ fontSize: 14 }}>{s.lastPush}</div></div>
        <div className="kpi"><div className="label">Last pull</div><div className="value mono" style={{ fontSize: 14 }}>{s.lastPull}</div></div>
      </div>

      <div className="grid g-2">
        <Card title="Remote">
          <div className="vstack">
            <div className="field"><label>Remote URL</label><input defaultValue={s.remote} className="mono" readOnly /></div>
            <div className="field"><label>Branch</label><input defaultValue={s.branch} className="mono" readOnly /></div>
            <div className="row" style={{ padding: "4px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--fg-0)" }}>Auto-pull on session start</div>
                <div className="muted" style={{ fontSize: 11 }}>rebase-based, preserves local work</div>
              </div>
              <Toggle on={true} />
            </div>
            <div className="row" style={{ padding: "4px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--fg-0)" }}>Auto-push on session stop</div>
                <div className="muted" style={{ fontSize: 11 }}>commits changed state files</div>
              </div>
              <Toggle on={true} />
            </div>
          </div>
        </Card>

        <Card title={`Pending changes (${s.pending.length})`} sub="ready to push" flush>
          {s.pending.length === 0 ? (
            <div className="empty">
              <h4>Nothing to push</h4>
              <span>working tree clean</span>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr><th>Op</th><th>File</th><th className="right">Delta</th></tr>
              </thead>
              <tbody>
                {s.pending.map((p) => (
                  <tr key={p.file}>
                    <td><Chip tone={p.op === "A" ? "accent" : p.op === "D" ? "red" : "blue"}>{p.op}</Chip></td>
                    <td className="mono" style={{ fontSize: 11 }}>{p.file}</td>
                    <td className="right mono">{p.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div style={{ height: 14 }} />

      <Card title="Conflict handling" sub="what happens when things go wrong">
        <div className="grid g-3" style={{ gap: 10 }}>
          {[
            ["Pull conflict", "Rebase is aborted. You're warned to resolve manually. Auto-sync pauses until resolved."],
            ["Push failure",  "Local commit is preserved. It will be included in the next push."],
            ["Timeout (>15s)","Operation cancelled. Sync never blocks your Claude session."],
          ].map(([t, d]) => (
            <div key={t} className="inset" style={{ padding: "10px 12px" }}>
              <div className="strong" style={{ color: "var(--fg-0)", fontSize: 12, marginBottom: 4, fontFamily: "var(--font-inter)" }}>{t}</div>
              <div className="muted" style={{ fontSize: 11, fontFamily: "var(--font-inter)" }}>{d}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
