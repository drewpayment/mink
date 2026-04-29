"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Icon } from "@/components/ui/icon";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { fetchWikiNote } from "@/lib/api-client";

const CATS = ["all", "inbox", "projects", "areas", "resources", "archives"] as const;
type Cat = (typeof CATS)[number];

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function isInTreePath(filePath: string, treePath: string): boolean {
  const f = normalizeSlashes(filePath);
  const t = normalizeSlashes(treePath);
  return f === t || f.startsWith(t + "/");
}

function formatTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    day: "2-digit",
    month: "short",
  });
}

export function WikiPanel() {
  const wiki = useDashboardStore((s) => s.wiki);
  const wikiNote = useDashboardStore((s) => s.wikiNote);
  const setWikiNote = useDashboardStore((s) => s.setWikiNote);
  const [cat, setCat] = useState<Cat>("all");
  const [selectedTreePath, setSelectedTreePath] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Auto-select first recent note once the payload arrives.
  useEffect(() => {
    if (!selected && wiki && wiki.recent.length > 0) {
      setSelected(wiki.recent[0].filePath);
    }
  }, [selected, wiki]);

  // Load selected note body.
  useEffect(() => {
    if (!selected) {
      setWikiNote(null);
      setNoteError(null);
      return;
    }
    setNoteError(null);
    fetchWikiNote(selected)
      .then(setWikiNote)
      .catch((err) => {
        setWikiNote(null);
        setNoteError(err instanceof Error ? err.message : String(err));
      });
  }, [selected, setWikiNote]);

  if (!wiki) {
    return <div className="page"><Card title="Wiki"><div className="empty"><h4>Loading…</h4></div></Card></div>;
  }

  if (!wiki.initialized) {
    return (
      <div className="page">
        <div className="page-head">
          <div>
            <h1 className="page-title">Vault</h1>
            <p className="page-sub">{wiki.vaultPath}</p>
          </div>
        </div>
        <Card title="Wiki not initialized">
          <div className="vstack" style={{ padding: "12px 0" }}>
            <p className="muted" style={{ fontSize: 12 }}>
              Initialize the vault from the CLI:
            </p>
            <pre className="mono inset" style={{ padding: "10px 12px", fontSize: 12 }}>
              mink wiki init
            </pre>
          </div>
        </Card>
      </div>
    );
  }

  const byCat = cat === "all" ? wiki.recent : wiki.recent.filter((n) => n.category === cat);
  const filtered = selectedTreePath
    ? byCat.filter((n) => isInTreePath(n.filePath, selectedTreePath))
    : byCat;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Vault</h1>
          <p className="page-sub">
            {wiki.totalNotes} notes · inbox {wiki.inboxCount} · {wiki.vaultPath}
          </p>
        </div>
        <div className="page-actions">
          <Btn icon="plus" variant="primary" disabled title="Capture panel handles writes (PR 6)">New note</Btn>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "220px 1fr 380px", gap: 14 }}>
        <Card title="Tree" flush>
          <div className="tree" style={{ padding: 8, maxHeight: 520, overflowY: "auto" }}>
            {wiki.tree.length === 0 ? (
              <div className="muted" style={{ fontSize: 11, padding: 6 }}>Vault is empty.</div>
            ) : (
              wiki.tree.map((n) => {
                const active = selectedTreePath === n.path;
                return (
                  <button
                    key={n.path}
                    type="button"
                    className={`tree-row dir${active ? " on" : ""}`}
                    style={{
                      paddingLeft: 10 + n.depth * 14,
                      width: "100%",
                      background: "transparent",
                      border: 0,
                      textAlign: "left",
                      font: "inherit",
                      color: "inherit",
                    }}
                    onClick={() =>
                      setSelectedTreePath((prev) => (prev === n.path ? null : n.path))
                    }
                  >
                    <Icon name="folder" size={11} />
                    <span className="fn">{n.name}</span>
                    <span className="meta">{n.count}</span>
                  </button>
                );
              })
            )}
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
              {selectedTreePath && (
                <button
                  type="button"
                  onClick={() => setSelectedTreePath(null)}
                  title="Clear folder filter"
                  style={{ background: "transparent", border: 0, padding: 0, marginLeft: 8, cursor: "pointer" }}
                >
                  <Chip tone="accent">{selectedTreePath} ×</Chip>
                </button>
              )}
            </div>
          }
          flush
        >
          {filtered.length === 0 ? (
            <div className="empty"><h4>No notes</h4></div>
          ) : (
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
                    key={n.filePath}
                    onClick={() => setSelected(n.filePath)}
                    style={{ cursor: "pointer", background: selected === n.filePath ? "var(--bg-2)" : undefined }}
                  >
                    <td>
                      <div className="strong">{n.title}</div>
                      <div className="mono muted" style={{ fontSize: 10 }}>{n.filePath}</div>
                    </td>
                    <td>
                      <div className="row tight">
                        {n.tags.map((t) => <Chip key={t}>#{t}</Chip>)}
                      </div>
                    </td>
                    <td>
                      <Chip tone={n.category === "inbox" ? "amber" : n.category === "projects" ? "accent" : ""}>
                        {n.category}
                      </Chip>
                    </td>
                    <td className="right mono muted">{formatTimestamp(n.lastModified)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title={wikiNote ? (wikiNote.frontmatter.title as string) || wikiNote.path : "Select a note"}
          sub={wikiNote?.path}
          tools={
            <div className="row tight">
              <Btn size="sm" variant="ghost" icon="copy" disabled>Copy link</Btn>
            </div>
          }
        >
          {noteError && (
            <div style={{ color: "var(--danger, #c33)", fontSize: 11 }}>{noteError}</div>
          )}
          {!wikiNote && !noteError && (
            <div className="muted" style={{ fontSize: 11 }}>No note selected.</div>
          )}
          {wikiNote && (
            <>
              <div className="inset" style={{ fontFamily: "var(--font-inter)", fontSize: 12, lineHeight: 1.55, maxHeight: 360, overflowY: "auto" }}>
                {Object.keys(wikiNote.frontmatter).length > 0 && (
                  <div className="muted mono" style={{ fontSize: 10.5, marginBottom: 8 }}>
                    ---
                    {Object.entries(wikiNote.frontmatter).map(([k, v]) => (
                      <div key={k}>
                        {k}: {Array.isArray(v) ? `[${v.join(", ")}]` : String(v)}
                      </div>
                    ))}
                    ---
                  </div>
                )}
                <div style={{ color: "var(--fg-1)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {wikiNote.body}
                </div>
              </div>

              <div className="divider" />
              <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 6 }}>
                Backlinks ({wikiNote.backlinks.length})
              </div>
              <div className="vstack" style={{ gap: 4 }}>
                {wikiNote.backlinks.length === 0 ? (
                  <div className="muted" style={{ fontSize: 11 }}>No backlinks yet.</div>
                ) : (
                  wikiNote.backlinks.map((b) => (
                    <button
                      key={b.path}
                      type="button"
                      onClick={() => setSelected(b.path)}
                      className="mono"
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "var(--accent)",
                        cursor: "pointer",
                        fontSize: 11,
                        textAlign: "left",
                        padding: 0,
                      }}
                    >
                      {b.title} <span className="muted">({b.path})</span>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
