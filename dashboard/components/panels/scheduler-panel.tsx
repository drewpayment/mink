"use client";

import { useState } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Toggle } from "@/components/ui/toggle";
import { TabsLine } from "@/components/ui/tabs-line";
import { triggerTaskRun, triggerDeadLetterRetry } from "@/lib/api-client";
import { useFormat } from "@/hooks/use-format";

type Tab = "tasks" | "dlq";

function statusTone(status: string): "accent" | "amber" | "red" | "" {
  if (status === "running") return "accent";
  if (status === "retrying") return "amber";
  if (status === "dead-lettered") return "red";
  return "";
}

export function SchedulerPanel() {
  const taskDefinitions = useDashboardStore((s) => s.taskDefinitions);
  const tasks = useDashboardStore((s) => s.tasks);
  const { formatDateTime, formatTime } = useFormat();
  const deadLetters = useDashboardStore((s) => s.deadLetters);
  const activeProjectId = useDashboardStore((s) => s.activeProjectId);

  const [tab, setTab] = useState<Tab>("tasks");
  const [busy, setBusy] = useState<Set<string>>(new Set());

  function wrap(key: string, fn: () => Promise<unknown>) {
    setBusy((prev) => new Set(prev).add(key));
    fn().finally(() => {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    });
  }

  const nextRun = tasks
    .map((t) => t.nextRunAt)
    .filter(Boolean)
    .sort()[0];
  const successRate = (() => {
    const total = tasks.length;
    if (total === 0) return "—";
    const ok = tasks.filter((t) => t.consecutiveFailures === 0).length;
    return `${((ok / total) * 100).toFixed(1)}%`;
  })();

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Scheduler</h1>
          <p className="page-sub">Cron-based tasks · retry with exponential backoff · dead letter queue</p>
        </div>
        <div className="page-actions">
          <Btn icon="plus" variant="primary" disabled title="Write endpoint coming soon">New task</Btn>
        </div>
      </div>

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        <div className="kpi">
          <div className="label">Tasks</div>
          <div className="value mono">{taskDefinitions.length}</div>
          <div className="delta">
            {taskDefinitions.filter((d) => d.enabled).length} enabled
          </div>
        </div>
        <div className="kpi">
          <div className="label">Next run</div>
          <div className="value mono" style={{ fontSize: 14 }}>
            {nextRun ? formatTime(nextRun) : "—"}
          </div>
        </div>
        <div className="kpi">
          <div className="label">Success rate</div>
          <div className="value mono">{successRate}</div>
          <div className="delta">consecutive-success based</div>
        </div>
        <div className="kpi">
          <div className="label">Dead-letter</div>
          <div className="value mono" style={{ color: deadLetters.length ? "var(--amber)" : undefined }}>
            {deadLetters.length}
          </div>
          <div className="delta">retryable</div>
        </div>
      </div>

      <TabsLine
        tabs={[
          { id: "tasks", label: "Tasks", count: taskDefinitions.length },
          { id: "dlq", label: "Dead letter", count: deadLetters.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "tasks" && (
        <Card flush>
          {taskDefinitions.length === 0 ? (
            <div className="empty"><h4>No tasks configured</h4></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th></th>
                  <th>Name</th>
                  <th>Schedule</th>
                  <th>Last</th>
                  <th>Next</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {taskDefinitions.map((def) => {
                  const rec = tasks.find((r) => r.taskId === def.id);
                  const status = rec?.status ?? "idle";
                  const busyRun = busy.has(def.id);
                  return (
                    <tr key={def.id}>
                      <td><Toggle on={def.enabled} className="" /></td>
                      <td className="mono strong">{def.name}</td>
                      <td className="mono muted">{def.schedule}</td>
                      <td className="mono muted">{formatDateTime(rec?.lastRunAt ?? "")}</td>
                      <td className="mono">{formatDateTime(rec?.nextRunAt ?? "")}</td>
                      <td><Chip tone={statusTone(status)}>{status}</Chip></td>
                      <td className="right">
                        <Btn
                          size="sm"
                          variant="ghost"
                          icon={busyRun ? "refresh" : "play"}
                          disabled={busyRun}
                          onClick={() => wrap(def.id, () => triggerTaskRun(def.id, activeProjectId ?? undefined))}
                        >
                          {busyRun ? "Running…" : "Run"}
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === "dlq" && (
        <Card title="Dead letter queue" sub={`${deadLetters.length} failed runs retained`} flush>
          {deadLetters.length === 0 ? (
            <div className="empty"><h4>No dead-lettered tasks</h4></div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Last error</th>
                  <th className="right">Attempts</th>
                  <th>At</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {deadLetters.map((dl) => {
                  const key = `dl-${dl.taskId}`;
                  const busyDl = busy.has(key);
                  const lastError = dl.errorMessages?.[dl.errorMessages.length - 1];
                  return (
                    <tr key={dl.taskId}>
                      <td className="mono strong">{dl.taskId}</td>
                      <td className="muted" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {lastError ?? "—"}
                      </td>
                      <td className="right num">{dl.attemptCount}</td>
                      <td className="mono muted">{formatDateTime(dl.deadLetteredAt)}</td>
                      <td className="right">
                        <Btn
                          size="sm"
                          icon="refresh"
                          disabled={busyDl}
                          onClick={() => wrap(key, () => triggerDeadLetterRetry(dl.taskId, activeProjectId ?? undefined))}
                        >
                          {busyDl ? "Retrying…" : "Retry"}
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
