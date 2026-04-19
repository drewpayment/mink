"use client";

import { useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Icon } from "@/components/ui/icon";
import { MOCK_NOTES } from "@/lib/mock-dashboard-data";

const CATS = ["all", "inbox", "daily", "project", "resource", "pattern"] as const;
type Cat = (typeof CATS)[number];

const TREE = [
  { n: "inbox",     c: 3,  depth: 0 },
  { n: "projects",  c: 6,  depth: 0 },
  { n: "mink",      c: 14, depth: 1 },
  { n: "payroll-ui",c: 8,  depth: 1 },
  { n: "areas",     c: 4,  depth: 0 },
  { n: "daily",     c: 86, depth: 1 },
  { n: "resources", c: 41, depth: 0 },
  { n: "patterns",  c: 12, depth: 0 },
  { n: "archives",  c: 18, depth: 0 },
];

export function WikiPanel() {
  const [selected, setSelected] = useState(MOCK_NOTES.recent[0].path);
  const [cat, setCat] = useState<Cat>("all");

  const filtered = cat === "all" ? MOCK_NOTES.recent : MOCK_NOTES.recent.filter((n) => n.cat === cat);
  const current = MOCK_NOTES.recent.find((n) => n.path === selected);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Vault</span>
            <Chip tone="amber">preview</Chip>
          </h1>
          <p className="page-sub">{MOCK_NOTES.totalNotes} notes · inbox {MOCK_NOTES.inbox} · ~/.mink/wiki/</p>
        </div>
        <div className="page-actions">
          <Btn icon="plus" variant="primary" disabled title="Wiki write endpoint coming soon">New note</Btn>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "200px 1fr 380px", gap: 14 }}>
        <Card title="Tree" flush>
          <div className="tree" style={{ padding: 8 }}>
            {TREE.map((n, i) => (
              <div key={i} className="tree-row dir" style={{ paddingLeft: 10 + n.depth * 14 }}>
                <Icon name="folder" size={11} />
                <span className="fn">{n.n}</span>
                <span className="meta">{n.c}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title={
            <div className="row" style={{ flex: 1 }}>
              <span>Notes</span>
              <div className="seg" style={{ marginLeft: 10 }}>
                {CATS.map((c) => (
                  <button key={c} type="button" className={cat === c ? "on" : ""} onClick={() => setCat(c)}>
                    {c}
                  </button>
                ))}
              </div>
            </div>
          }
          flush
        >
          <table className="tbl">
            <thead>
              <tr>
                <th>Title</th>
                <th>Tags</th>
                <th>Category</th>
                <th className="right">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((n) => (
                <tr
                  key={n.path}
                  onClick={() => setSelected(n.path)}
                  style={{ cursor: "pointer", background: selected === n.path ? "var(--bg-2)" : undefined }}
                >
                  <td>
                    <div className="strong">{n.title}</div>
                    <div className="mono muted" style={{ fontSize: 10 }}>{n.path}</div>
                  </td>
                  <td>
                    <div className="row tight">
                      {n.tags.map((t) => <Chip key={t}>#{t}</Chip>)}
                    </div>
                  </td>
                  <td><Chip tone={n.cat === "inbox" ? "amber" : n.cat === "project" ? "accent" : ""}>{n.cat}</Chip></td>
                  <td className="right mono muted">{n.at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card
          title={current?.title}
          sub={current?.path}
          tools={
            <div className="row tight">
              <Btn size="sm" variant="ghost" icon="copy" disabled>Copy link</Btn>
            </div>
          }
        >
          <div className="inset" style={{ fontFamily: "var(--font-inter)", fontSize: 12, lineHeight: 1.55 }}>
            <div className="muted mono" style={{ fontSize: 10.5, marginBottom: 8 }}>
              ---<br />created: 2026-04-19<br />tags: [{current?.tags.join(", ")}]<br />category: {current?.cat}<br />---
            </div>
            <div className="strong" style={{ color: "var(--fg-0)", fontSize: 14, marginBottom: 6 }}>
              {current?.title}
            </div>
            <div style={{ color: "var(--fg-1)" }}>
              Preview content. The real vault will render note bodies from the daemon once the
              wiki API is wired up.
              <br />
              <br />
              Link examples: <span className="mono" style={{ color: "var(--accent)" }}>[[JWT Cookie Pattern]]</span>,{" "}
              <span className="mono" style={{ color: "var(--accent)" }}>[[Exponential Backoff]]</span>
            </div>
          </div>

          <div className="divider" />
          <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>
            Backlinks
          </div>
          <div className="vstack" style={{ gap: 4 }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--fg-1)" }}>projects/mink/sessions/2026-04-18.md</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--fg-1)" }}>patterns/retry-strategies.md</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
