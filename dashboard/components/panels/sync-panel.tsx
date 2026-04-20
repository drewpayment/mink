"use client";

import { useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Toggle } from "@/components/ui/toggle";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { triggerSyncPull, triggerSyncPush, triggerSyncDisconnect } from "@/lib/api-client";
import type { SyncPendingChange } from "@mink/types/dashboard";

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}

function opTone(op: SyncPendingChange["op"]): "" | "accent" | "red" | "blue" | "amber" {
  if (op === "A") return "accent";
  if (op === "D") return "red";
  if (op === "?") return "amber";
  return "blue";
}

function EmptyState() {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Sync</h1>
          <p className="page-sub">Git-backed sync of ~/.mink across machines</p>
        </div>
      </div>

      <Card title="Not connected">
        <div className="vstack" style={{ padding: "12px 0" }}>
          <p className="muted" style={{ fontSize: 12 }}>
            Cross-device sync is not set up yet. Initialize it from the CLI:
          </p>
          <pre className="mono inset" style={{ padding: "10px 12px", fontSize: 12 }}>
            mink sync init git@github.com:you/mink-backup.git
          </pre>
          <p className="muted" style={{ fontSize: 11 }}>
            Once initialized, ~/.mink will pull on session start and push on session stop.
          </p>
        </div>
      </Card>
    </div>
  );
}

export function SyncPanel() {
  const s = useDashboardStore((st) => st.sync);
  const [busy, setBusy] = useState<"pull" | "push" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!s) {
    return <div className="page"><Card title="Sync"><div className="empty"><h4>Loading…</h4></div></Card></div>;
  }

  if (!s.initialized) {
    return <EmptyState />;
  }

  async function run(
    kind: "pull" | "push" | "disconnect",
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

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Sync</h1>
          <p className="page-sub">Git-backed sync of ~/.mink across machines — auto pull on start, auto push on stop</p>
        </div>
        <div className="page-actions">
          <Btn
            icon="arrowDown"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => run("pull", triggerSyncPull)}
          >
            {busy === "pull" ? "Pulling…" : "Pull"}
          </Btn>
          <Btn
            icon="arrowUp"
            variant="primary"
            disabled={busy !== null}
            onClick={() => run("push", triggerSyncPush)}
          >
            {busy === "push" ? "Pushing…" : "Push"}
          </Btn>
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
          <div className="value" style={{ fontSize: 14 }}>
            {s.enabled ? "● Connected" : "○ Paused"}
          </div>
          <div className="delta">{s.branch || "—"}</div>
        </div>
        <div className="kpi">
          <div className="label">Ahead / Behind</div>
          <div className="value mono">↑{s.ahead} ↓{s.behind}</div>
          <div className="delta">vs origin/{s.branch || "main"}</div>
        </div>
        <div className="kpi">
          <div className="label">Last push</div>
          <div className="value mono" style={{ fontSize: 14 }}>{formatTimestamp(s.lastPush)}</div>
        </div>
        <div className="kpi">
          <div className="label">Last pull</div>
          <div className="value mono" style={{ fontSize: 14 }}>{formatTimestamp(s.lastPull)}</div>
        </div>
      </div>

      <div className="grid g-2">
        <Card title="Remote">
          <div className="vstack">
            <div className="field">
              <label>Remote URL</label>
              <input value={s.remote || ""} className="mono" readOnly />
            </div>
            <div className="field">
              <label>Branch</label>
              <input value={s.branch || ""} className="mono" readOnly />
            </div>
            <div className="row" style={{ padding: "4px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--fg-0)" }}>Auto-pull on session start</div>
                <div className="muted" style={{ fontSize: 11 }}>rebase-based, preserves local work</div>
              </div>
              <Toggle on={s.enabled} />
            </div>
            <div className="row" style={{ padding: "4px 0" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: "var(--fg-0)" }}>Auto-push on session stop</div>
                <div className="muted" style={{ fontSize: 11 }}>commits changed state files</div>
              </div>
              <Toggle on={s.enabled} />
            </div>
            <div className="divider" />
            <Btn
              size="sm"
              variant="ghost"
              icon="stop"
              onClick={() => {
                if (typeof window !== "undefined" && !window.confirm("Disconnect sync? This removes .git/ and clears sync config. Your data stays.")) {
                  return;
                }
                return run("disconnect", triggerSyncDisconnect);
              }}
              disabled={busy !== null}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect sync"}
            </Btn>
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
                <tr><th>Op</th><th>File</th></tr>
              </thead>
              <tbody>
                {s.pending.map((p) => (
                  <tr key={p.file}>
                    <td><Chip tone={opTone(p.op)}>{p.op}</Chip></td>
                    <td className="mono" style={{ fontSize: 11 }}>{p.file}</td>
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
