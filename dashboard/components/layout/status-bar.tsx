"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";

function fmtK(n: number): string {
  if (!n) return "0";
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

export function StatusBar() {
  const overview = useDashboardStore((s) => s.overview);
  const connected = useDashboardStore((s) => s.connected);
  const deadLetters = useDashboardStore((s) => s.deadLetters.length);
  const tasks = useDashboardStore((s) => s.tasks.length);

  const online = overview?.daemon?.running ?? false;
  const pid = overview?.daemon?.pid;

  const summary = overview?.summary;

  return (
    <footer className="statusbar">
      <span className="sb-stat daemon-stat">
        <span className="dot-mini" />
        <span className="k">daemon</span>
        <span className="v">
          {online ? (pid ? `online · pid ${pid}` : "online") : "offline"}
        </span>
      </span>

      {online && (
        <>
          {summary && (
            <>
              <span className="sb-stat">
                <span className="k">sessions</span>
                <span className="v">{summary.totalSessions}</span>
              </span>
              <span className="sb-stat">
                <span className="k">reads</span>
                <span className="v">{summary.totalReads}</span>
              </span>
              <span className="sb-stat">
                <span className="k">writes</span>
                <span className="v">{summary.totalWrites}</span>
              </span>
              <span className="sb-stat">
                <span className="k">saved</span>
                <span className="v">{fmtK(summary.estimatedSavings)}</span>
              </span>
            </>
          )}
          <span style={{ flex: 1 }} />
          <span className="sb-stat">
            <span className="k">cron</span>
            <span className="v">
              {tasks} tasks{deadLetters > 0 ? ` · ${deadLetters} DLQ` : ""}
            </span>
          </span>
          <span className="sb-stat">
            <span className="k">sse</span>
            <span className="v">{connected ? "connected" : "reconnecting"}</span>
          </span>
        </>
      )}
      {!online && (
        <>
          <span style={{ flex: 1 }} />
          <span className="sb-stat">
            <span className="k">run</span>
            <span className="v">mink daemon start</span>
          </span>
        </>
      )}
    </footer>
  );
}
