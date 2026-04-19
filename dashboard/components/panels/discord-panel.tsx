"use client";

import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Toggle } from "@/components/ui/toggle";
import { MOCK_DISCORD } from "@/lib/mock-dashboard-data";

export function DiscordPanel() {
  const d = MOCK_DISCORD;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Discord channel</span>
            <Chip tone="amber">preview</Chip>
          </h1>
          <p className="page-sub">DM your bot to capture, search, and summarize your wiki from anywhere</p>
        </div>
        <div className="page-actions">
          <Btn icon="stop" variant="danger" disabled>Stop channel</Btn>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pulse" style={{ width: 8, height: 8, borderRadius: 4, background: "var(--accent)" }} />
            Running
          </div>
          <div className="delta">screen: mink-channel-discord</div>
        </div>
        <div className="kpi">
          <div className="label">Uptime</div>
          <div className="value mono">{d.uptime}</div>
        </div>
        <div className="kpi">
          <div className="label">Messages (24h)</div>
          <div className="value mono">{d.messages}</div>
        </div>
        <div className="kpi">
          <div className="label">Bot</div>
          <div className="value mono" style={{ fontSize: 13 }}>{d.bot}</div>
        </div>
      </div>

      <div className="grid g-2">
        <Card title="Configuration">
          <div className="vstack">
            <div className="field">
              <label>Bot token</label>
              <input defaultValue={d.token} className="mono" readOnly />
            </div>
            <div className="field">
              <label>Sender allowlist</label>
              <div className="row tight" style={{ flexWrap: "wrap" }}>
                {d.allowlist.map((u) => <Chip key={u} tone="accent">{u}</Chip>)}
                <Btn size="sm" variant="ghost" icon="plus" disabled>Add</Btn>
              </div>
            </div>
            <div className="row" style={{ padding: "4px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--fg-0)" }}>Auto-start on daemon</div>
                <div className="muted" style={{ fontSize: 11 }}>channel.discord.enabled</div>
              </div>
              <Toggle on={true} />
            </div>
            <div className="row tight" style={{ marginTop: 6 }}>
              <Btn size="sm" icon="refresh" disabled>Restart</Btn>
              <Btn size="sm" variant="ghost" icon="copy" disabled>Copy invite URL</Btn>
            </div>
          </div>
        </Card>

        <Card
          title="Session logs"
          sub="live hardcopy"
          tools={
            <span className="chip accent mono" style={{ gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--accent)" }} />
              live
            </span>
          }
          flush
        >
          <div style={{ padding: "10px 12px" }}>
            {d.logs.map((l, i) => (
              <div
                key={i}
                style={{ display: "flex", gap: 10, padding: "3px 0", fontFamily: "var(--font-mono), monospace", fontSize: 11 }}
              >
                <span className="muted">{l.t}</span>
                <span style={{ color: "var(--fg-1)" }}>{l.m}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
