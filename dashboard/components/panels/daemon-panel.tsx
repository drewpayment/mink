"use client";

import { useState } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Toggle } from "@/components/ui/toggle";
import { formatUptime } from "@/lib/format";
import {
  triggerDaemonStart,
  triggerDaemonStop,
  triggerDaemonRestart,
} from "@/lib/api-client";

export function DaemonPanel() {
  const overview = useDashboardStore((s) => s.overview);
  const health = useDashboardStore((s) => s.health);
  const [busy, setBusy] = useState<"start" | "stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const online = overview?.daemon?.running ?? false;
  const pid = overview?.daemon?.pid;
  const uptime = online && health?.uptimeMs ? formatUptime(health.uptimeMs) : "—";

  async function runAction(
    kind: "start" | "stop" | "restart",
    fn: () => Promise<{ success: boolean; error?: string }>,
  ) {
    setBusy(kind);
    setError(null);
    try {
      const result = await fn();
      if (!result.success) {
        setError(result.error ?? `Failed to ${kind} daemon`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Daemon</span>
          </h1>
          <p className="page-sub">Background process — runs scheduled tasks, listens for hook events, pushes live updates</p>
        </div>
        <div className="page-actions">
          {online ? (
            <Btn
              icon="stop"
              variant="danger"
              disabled={busy !== null}
              onClick={() => runAction("stop", triggerDaemonStop)}
            >
              {busy === "stop" ? "Stopping…" : "Stop daemon"}
            </Btn>
          ) : (
            <Btn
              icon="play"
              variant="primary"
              disabled={busy !== null}
              onClick={() => runAction("start", triggerDaemonStart)}
            >
              {busy === "start" ? "Starting…" : "Start daemon"}
            </Btn>
          )}
        </div>
      </div>

      {error && (
        <div className="kpi" style={{ marginBottom: 14, borderColor: "var(--danger, #c33)" }}>
          <div className="label" style={{ color: "var(--danger, #c33)" }}>Error</div>
          <div className="value" style={{ fontSize: 13 }}>{error}</div>
        </div>
      )}

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="label">Status</div>
          <div className="value" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16 }}>
            <span className="pulse" style={{ width: 8, height: 8, borderRadius: 4, background: online ? "var(--accent)" : "var(--fg-3)" }} />
            {online ? "Online" : "Offline"}
          </div>
          <div className="delta">{online ? (pid ? `pid ${pid}` : "running") : "run: mink daemon start"}</div>
        </div>
        <div className="kpi"><div className="label">Uptime</div><div className="value mono">{uptime}</div></div>
        <div className="kpi">
          <div className="label">Heartbeat</div>
          <div className="value mono">{online ? "5.0s" : "—"}</div>
          <div className="delta">{online ? "healthy" : "paused"}</div>
        </div>
        <div className="kpi">
          <div className="label">Hook wiring</div>
          <div className="value" style={{ fontSize: 16 }}>{online ? "6 events" : "—"}</div>
          <div className="delta">.claude/settings.json</div>
        </div>
      </div>

      <div className="grid g-2">
        <Card title="Controls">
          <div className="vstack">
            <div className="row">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12 }}>Auto-restart on failure</div>
                <div className="muted" style={{ fontSize: 11 }}>max 5 attempts, backoff 30s</div>
              </div>
              <Toggle on={true} />
            </div>
            <div className="row">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12 }}>Boot on system login</div>
                <div className="muted" style={{ fontSize: 11 }}>launchd / systemd user service</div>
              </div>
              <Toggle on={false} />
            </div>
            <div className="row">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12 }}>Verbose logging</div>
                <div className="muted" style={{ fontSize: 11 }}>log level: debug</div>
              </div>
              <Toggle on={false} />
            </div>
            <div className="divider" />
            <div className="row tight" style={{ flexWrap: "wrap" }}>
              <Btn
                size="sm"
                icon="refresh"
                disabled={busy !== null || !online}
                onClick={() => runAction("restart", triggerDaemonRestart)}
              >
                {busy === "restart" ? "Restarting…" : "Restart"}
              </Btn>
              <Btn size="sm" variant="ghost" icon="eye" disabled>Open log file</Btn>
              <Btn size="sm" variant="ghost" icon="download" disabled>Dump state</Btn>
            </div>
          </div>
        </Card>

        <Card
          title="Hook integration"
          sub=".claude/settings.json"
          flush
        >
          <table className="tbl">
            <thead>
              <tr><th>Event</th><th>Command</th><th>Purpose</th><th>Status</th></tr>
            </thead>
            <tbody>
              {[
                ["SessionStart",       "mink session-start", "Create fresh session state"],
                ["Stop",                "mink session-stop",  "Finalize session, calculate savings"],
                ["PreToolUse (Read)",   "mink pre-read",      "Check file index, warn on repeats"],
                ["PostToolUse (Read)",  "mink post-read",     "Track read, estimate tokens"],
                ["PreToolUse (Write)",  "mink pre-write",     "Enforce learned rules, surface bugs"],
                ["PostToolUse (Write)", "mink post-write",    "Log write, update file index"],
              ].map(([e, c, p]) => (
                <tr key={e}>
                  <td className="mono strong">{e}</td>
                  <td className="mono muted">{c}</td>
                  <td>{p}</td>
                  <td><Chip tone={online ? "accent" : ""}>{online ? "wired" : "—"}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
