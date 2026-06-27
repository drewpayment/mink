"use client";

import { Fragment, useMemo, useState } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Icon } from "@/components/ui/icon";
import { useFormat } from "@/hooks/use-format";
import type { BugEntry } from "@mink/types/bug-memory";

type Only = "all" | "open" | "fixed";

function isFixed(b: BugEntry): boolean {
  return !!b.fixDescription && b.fixDescription.trim().length > 0;
}

export function BugPanel() {
  const bugs = useDashboardStore((s) => s.bugs);
  const { formatDateTime } = useFormat();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<Only>("all");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    bugs.forEach((b) => b.tags?.forEach((t) => set.add(t)));
    return Array.from(set).sort();
  }, [bugs]);

  const filtered = useMemo(() => {
    return bugs.filter((b) => {
      if (only === "open" && isFixed(b)) return false;
      if (only === "fixed" && !isFixed(b)) return false;
      if (
        q &&
        !(b.errorMessage?.toLowerCase().includes(q.toLowerCase()) ||
          b.id.toLowerCase().includes(q.toLowerCase()))
      ) return false;
      if (activeTags.length && !activeTags.every((t) => b.tags.includes(t))) return false;
      return true;
    });
  }, [bugs, q, only, activeTags]);

  const openCount = bugs.filter((b) => !isFixed(b)).length;

  function toggleTag(t: string) {
    setActiveTags((ts) => (ts.includes(t) ? ts.filter((x) => x !== t) : [...ts, t]));
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Bug memory</h1>
          <p className="page-sub">
            {bugs.length} bugs · {openCount} open
          </p>
        </div>
        <div className="page-actions">
          <Btn icon="plus" variant="primary" disabled title="Write endpoint coming soon">Log bug</Btn>
        </div>
      </div>

      <Card
        title={
          <div className="row" style={{ flex: 1, gap: 10, flexWrap: "wrap" }}>
            <div className="row" style={{ maxWidth: 280, flex: 1 }}>
              <Icon name="search" size={12} className="muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search bugs…"
                aria-label="Search bugs"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: 0,
                  color: "var(--fg-0)",
                  fontSize: 11.5,
                  outline: "none",
                  fontFamily: "var(--font-mono), monospace",
                }}
              />
            </div>
            <div className="seg">
              {(["all", "open", "fixed"] as const).map((k) => (
                <button key={k} type="button" className={only === k ? "on" : ""} onClick={() => setOnly(k)}>
                  {k}
                </button>
              ))}
            </div>
            <div className="row tight" style={{ flexWrap: "wrap" }}>
              {allTags.map((t) => (
                <button key={t} type="button" onClick={() => toggleTag(t)}>
                  <Chip tone={activeTags.includes(t) ? "accent" : ""}>#{t}</Chip>
                </button>
              ))}
            </div>
          </div>
        }
        flush
      >
        {filtered.length === 0 ? (
          <div className="empty"><h4>No bugs match</h4></div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th></th>
                <th>ID</th>
                <th>Error</th>
                <th>Tags</th>
                <th>File</th>
                <th>Root cause</th>
                <th className="right">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const fixed = isFixed(b);
                const open = expanded === b.id;
                return (
                  <Fragment key={b.id}>
                    <tr onClick={() => setExpanded(open ? null : b.id)} style={{ cursor: "pointer" }}>
                      <td>
                        {fixed ? <Chip tone="accent">fixed</Chip> : <Chip tone="red">open</Chip>}
                      </td>
                      <td className="mono">{b.id}</td>
                      <td className="strong" style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.errorMessage}
                      </td>
                      <td>
                        <div className="row tight" style={{ flexWrap: "wrap" }}>
                          {b.tags.map((t) => <Chip key={t}>#{t}</Chip>)}
                        </div>
                      </td>
                      <td className="mono muted" style={{ fontSize: 10.5 }}>
                        {b.filePath}{b.lineNumber ? `:${b.lineNumber}` : ""}
                      </td>
                      <td className="muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.rootCause}
                      </td>
                      <td className="right mono muted">{formatDateTime(b.lastSeenAt)}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={7} style={{ background: "var(--bg-2)", padding: "12px 14px" }}>
                          <div className="vstack">
                            <div>
                              <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>Root cause</div>
                              <div>{b.rootCause || "—"}</div>
                            </div>
                            <div>
                              <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 4 }}>Fix</div>
                              <div>{b.fixDescription || <span className="muted">not fixed yet</span>}</div>
                            </div>
                            <div className="mono muted" style={{ fontSize: 11 }}>
                              seen {b.occurrenceCount}× · created {formatDateTime(b.createdAt)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
