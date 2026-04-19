"use client";

import { useMemo, useState } from "react";
import { useDashboardStore, type ActionLogRow } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";

type Filter = "all" | "read" | "write" | "session" | "other";

const FILTERS: Filter[] = ["all", "read", "write", "session", "other"];

function classify(row: ActionLogRow): Filter {
  const action = row.action.toLowerCase();
  if (action === "read") return "read";
  if (action === "create" || action === "edit" || action === "write") return "write";
  if (action.includes("session")) return "session";
  return "other";
}

function toneFor(kind: Filter): "" | "accent" | "blue" | "amber" {
  switch (kind) {
    case "read":    return "";
    case "write":   return "blue";
    case "session": return "accent";
    default:        return "amber";
  }
}

export function ActivityPanel() {
  const rows = useDashboardStore((s) => s.actionLog);
  const [filter, setFilter] = useState<Filter>("all");

  const flat = useMemo(() => [...rows].reverse(), [rows]);
  const list = filter === "all" ? flat : flat.filter((r) => classify(r) === filter);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Activity log</h1>
          <p className="page-sub">Chronological, human-readable record of every hook event</p>
        </div>
        <div className="page-actions">
          <Btn icon="download" variant="ghost" disabled title="Export coming soon">Export .md</Btn>
        </div>
      </div>

      <Card
        title="Recent activity"
        sub={`${list.length} events`}
        tools={
          <div className="row tight">
            {FILTERS.map((t) => (
              <button
                key={t}
                type="button"
                className={`tab ${filter === t ? "on" : ""}`}
                style={{
                  padding: "3px 8px",
                  fontSize: 10.5,
                  marginBottom: 0,
                  borderBottom: 0,
                  borderRadius: 4,
                  background: filter === t ? "var(--bg-3)" : "transparent",
                }}
                onClick={() => setFilter(t)}
              >
                {t}
              </button>
            ))}
          </div>
        }
        flush
      >
        {list.length === 0 ? (
          <div className="empty">
            <h4>No activity recorded</h4>
            <span>start a Claude session with mink hooks enabled to populate this log.</span>
          </div>
        ) : (
          <div>
            {list.map((row, i) => {
              const kind = classify(row);
              return (
                <div key={`${row.time}-${i}`} className={`evt ${i < 2 ? "fresh" : ""}`.trim()}>
                  <span className="t">{row.time}</span>
                  <span className="c">
                    <Chip tone={toneFor(kind)}>{kind}</Chip>
                    <span> {row.action} </span>
                    {row.files && row.files !== "—" && <code>{row.files}</code>}
                    {row.outcome && row.outcome !== "—" && (
                      <span className="muted" style={{ marginLeft: 8, fontSize: 10.5, fontFamily: "var(--font-mono), monospace" }}>
                        {row.outcome}
                      </span>
                    )}
                    {row.tokens && row.tokens !== "—" && (
                      <span className="muted" style={{ marginLeft: 8, fontSize: 10.5, fontFamily: "var(--font-mono), monospace" }}>
                        {row.tokens} tok
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
