"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Toggle } from "@/components/ui/toggle";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import {
  triggerChannelStart,
  triggerChannelStop,
  triggerChannelRestart,
  setConfigValue,
  fetchChannel,
} from "@/lib/api-client";

function formatUptime(seconds: number): string {
  if (!seconds) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${String(hours).padStart(2, "0")}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

export function DiscordPanel() {
  const d = useDashboardStore((s) => s.channel);
  const setChannel = useDashboardStore((s) => s.setChannel);
  const [busy, setBusy] = useState<"start" | "stop" | "restart" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newAllow, setNewAllow] = useState("");
  const allowRef = useRef<HTMLInputElement | null>(null);

  // Poll logs every 4s while running.
  useEffect(() => {
    if (!d || d.status !== "running") return;
    const timer = setInterval(() => {
      fetchChannel().then(setChannel).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [d?.status, setChannel, d]);

  if (!d) {
    return <div className="page"><Card title="Discord channel"><div className="empty"><h4>Loading…</h4></div></Card></div>;
  }

  const running = d.status === "running";

  async function run(
    kind: "start" | "stop" | "restart",
    fn: () => Promise<{ success: boolean; error?: string }>,
  ) {
    setBusy(kind);
    setError(null);
    try {
      const result = await fn();
      if (!result.success) setError(result.error ?? `Failed to ${kind}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function saveAllowlist(next: string[]) {
    setError(null);
    setConfigValue("channel.discord.allowlist", next.join(","))
      .then((result) => {
        if (!result.success) setError(result.error ?? "Failed to save allowlist");
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }

  function addAllow() {
    const val = newAllow.trim();
    if (!val) return;
    if (d!.allowlist.includes(val)) {
      setNewAllow("");
      return;
    }
    saveAllowlist([...d!.allowlist, val]);
    setNewAllow("");
    allowRef.current?.focus();
  }

  function removeAllow(entry: string) {
    saveAllowlist(d!.allowlist.filter((e) => e !== entry));
  }

  function toggleAutoStart(next: boolean) {
    setError(null);
    setConfigValue("channel.discord.enabled", next ? "true" : "false").catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Discord channel</span>
          </h1>
          <p className="page-sub">DM your bot to capture, search, and summarize your wiki from anywhere</p>
        </div>
        <div className="page-actions">
          {running ? (
            <Btn
              icon="stop"
              variant="danger"
              disabled={busy !== null}
              onClick={() => run("stop", triggerChannelStop)}
            >
              {busy === "stop" ? "Stopping…" : "Stop channel"}
            </Btn>
          ) : (
            <Btn
              icon="play"
              variant="primary"
              disabled={busy !== null}
              onClick={() => run("start", triggerChannelStart)}
            >
              {busy === "start" ? "Starting…" : "Start channel"}
            </Btn>
          )}
        </div>
      </div>

      {error && (
        <div className="kpi" style={{ marginBottom: 14, borderColor: "var(--danger, #c33)" }}>
          <div className="label" style={{ color: "var(--danger, #c33)" }}>Error</div>
          <div className="value" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{error}</div>
        </div>
      )}

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
            <span className="pulse" style={{ width: 8, height: 8, borderRadius: 4, background: running ? "var(--accent)" : "var(--fg-3)" }} />
            {running ? "Running" : "Stopped"}
          </div>
          <div className="delta">{d.session || "—"}</div>
        </div>
        <div className="kpi">
          <div className="label">Uptime</div>
          <div className="value mono">{formatUptime(d.uptimeSec)}</div>
        </div>
        <div className="kpi">
          <div className="label">Platform</div>
          <div className="value mono">{d.platform ?? "—"}</div>
        </div>
        <div className="kpi">
          <div className="label">Allowlist</div>
          <div className="value mono">{d.allowlist.length}</div>
        </div>
      </div>

      <div className="grid g-2">
        <Card title="Configuration">
          <div className="vstack">
            <div className="field">
              <label>Bot token</label>
              <input value={d.tokenMasked || "(not set)"} className="mono" readOnly />
            </div>
            <div className="field">
              <label>Sender allowlist</label>
              <div className="row tight" style={{ flexWrap: "wrap", gap: 6 }}>
                {d.allowlist.length === 0 && (
                  <span className="muted" style={{ fontSize: 11 }}>no entries yet</span>
                )}
                {d.allowlist.map((u) => (
                  <span key={u} className="row tight" style={{ gap: 4 }}>
                    <Chip tone="accent">{u}</Chip>
                    <button
                      type="button"
                      onClick={() => removeAllow(u)}
                      style={{ background: "transparent", border: 0, color: "var(--fg-3)", cursor: "pointer", fontSize: 11 }}
                      aria-label={`Remove ${u}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="row tight" style={{ marginTop: 6, gap: 6 }}>
                <input
                  ref={allowRef}
                  value={newAllow}
                  onChange={(e) => setNewAllow(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addAllow()}
                  placeholder="discord user id or name#tag"
                  className="mono"
                  style={{
                    flex: 1,
                    background: "var(--bg-inset)",
                    border: "1px solid var(--line-1)",
                    borderRadius: 5,
                    padding: "4px 8px",
                    color: "var(--fg-0)",
                    fontSize: 11,
                    outline: "none",
                  }}
                />
                <Btn size="sm" variant="ghost" icon="plus" onClick={addAllow} disabled={!newAllow.trim()}>Add</Btn>
              </div>
            </div>
            <div className="row" style={{ padding: "4px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--fg-0)" }}>Auto-start on daemon</div>
                <div className="muted" style={{ fontSize: 11 }}>channel.discord.enabled</div>
              </div>
              <Toggle on={d.autoStart} onChange={toggleAutoStart} />
            </div>
            <div className="row tight" style={{ marginTop: 6 }}>
              <Btn
                size="sm"
                icon="refresh"
                disabled={busy !== null || !running}
                onClick={() => run("restart", triggerChannelRestart)}
              >
                {busy === "restart" ? "Restarting…" : "Restart"}
              </Btn>
            </div>
          </div>
        </Card>

        <Card
          title="Session logs"
          sub={running ? "live hardcopy" : "session not running"}
          tools={
            running ? (
              <span className="chip accent mono" style={{ gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--accent)" }} />
                live
              </span>
            ) : undefined
          }
          flush
        >
          <div style={{ padding: "10px 12px", maxHeight: 320, overflowY: "auto" }}>
            {d.logs.length === 0 ? (
              <div className="muted" style={{ fontSize: 11 }}>
                {running ? "No log output captured yet." : "Start the channel to see live logs."}
              </div>
            ) : (
              d.logs.map((l, i) => (
                <div
                  key={`${i}-${l.t}-${l.m.slice(0, 20)}`}
                  style={{ display: "flex", gap: 10, padding: "3px 0", fontFamily: "var(--font-mono), monospace", fontSize: 11 }}
                >
                  {l.t && <span className="muted" style={{ minWidth: 56 }}>{l.t}</span>}
                  <span style={{ color: "var(--fg-1)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{l.m}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
