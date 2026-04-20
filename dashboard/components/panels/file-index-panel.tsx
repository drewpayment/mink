"use client";

import { useMemo, useState } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Icon } from "@/components/ui/icon";
import { triggerRescan } from "@/lib/api-client";
import { formatDateTime, formatNum } from "@/lib/format";
import type { FileIndexEntry } from "@mink/types/file-index";

function ageStatus(iso: string): "hot" | "fresh" | "stale" | "cold" {
  const t = new Date(iso).getTime();
  if (!t) return "cold";
  const delta = Date.now() - t;
  const h = delta / (1000 * 60 * 60);
  if (h < 1) return "hot";
  if (h < 24) return "fresh";
  if (h < 24 * 14) return "stale";
  return "cold";
}

function ageLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "—";
  const delta = Date.now() - t;
  const h = delta / (1000 * 60 * 60);
  if (h < 1) return `${Math.round(delta / 60_000)}m`;
  if (h < 24) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

function sizeLabel(tokens: number): string {
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k tok`;
  return `${tokens} tok`;
}

function toneFor(s: "hot" | "fresh" | "stale" | "cold"): "accent" | "" | "amber" | "red" {
  return s === "hot" ? "accent" : s === "fresh" ? "" : s === "stale" ? "amber" : "red";
}

export function FileIndexPanel() {
  const fileIndex = useDashboardStore((s) => s.fileIndex);
  const activeProjectId = useDashboardStore((s) => s.activeProjectId);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [rescanning, setRescanning] = useState(false);

  const entries = useMemo<FileIndexEntry[]>(() => {
    const raw = fileIndex?.entries as unknown;
    if (Array.isArray(raw)) return raw as FileIndexEntry[];
    if (raw && typeof raw === "object") return Object.values(raw as Record<string, FileIndexEntry>);
    return [];
  }, [fileIndex]);

  const filtered = useMemo(() => {
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter(
      (f) => f.filePath.toLowerCase().includes(q) || (f.description ?? "").toLowerCase().includes(q),
    );
  }, [entries, query]);

  const current = entries.find((f) => f.filePath === (selected ?? filtered[0]?.filePath));

  async function doRescan() {
    setRescanning(true);
    try {
      await triggerRescan(activeProjectId ?? undefined);
    } finally {
      setRescanning(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">File index</h1>
          <p className="page-sub">
            {entries.length} files indexed · last rescan{" "}
            {fileIndex?.header?.lastScanTimestamp ? formatDateTime(fileIndex.header.lastScanTimestamp) : "—"}
          </p>
        </div>
        <div className="page-actions">
          <Btn icon="refresh" onClick={doRescan} disabled={rescanning}>
            {rescanning ? "Rescanning…" : "Rescan"}
          </Btn>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 360px", gap: 14 }}>
        <Card
          title={
            <div className="row" style={{ width: "100%" }}>
              <span>All files</span>
              <div className="row" style={{ marginLeft: 12, flex: 1, maxWidth: 300 }}>
                <Icon name="search" size={12} className="muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Filter by path or description…"
                  aria-label="Filter files"
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
            </div>
          }
          flush
        >
          {filtered.length === 0 ? (
            <div className="empty"><h4>No files match</h4></div>
          ) : (
            <div style={{ maxHeight: 560, overflow: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Description</th>
                    <th className="right">Tokens</th>
                    <th className="right">Seen</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => {
                    const status = ageStatus(f.lastIndexed);
                    const isSelected = (selected ?? filtered[0]?.filePath) === f.filePath;
                    return (
                      <tr
                        key={f.filePath}
                        onClick={() => setSelected(f.filePath)}
                        style={{ cursor: "pointer", background: isSelected ? "var(--bg-2)" : undefined }}
                      >
                        <td className="mono" style={{ fontSize: 11 }}>{f.filePath}</td>
                        <td
                          className="muted"
                          style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        >
                          {f.description || "—"}
                        </td>
                        <td className="right num muted">{sizeLabel(f.estimatedTokens)}</td>
                        <td className="right num muted">{ageLabel(f.lastIndexed)}</td>
                        <td><Chip tone={toneFor(status)}>{status}</Chip></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="File details" sub={current ? ageStatus(current.lastIndexed) : "—"}>
          {current ? (
            <div className="vstack" style={{ gap: 10 }}>
              <div className="mono" style={{ fontSize: 12, color: "var(--fg-0)", wordBreak: "break-all" }}>
                {current.filePath}
              </div>
              <div className="inset">
                <div className="c">// description</div>
                {current.description || "no description"}
              </div>
              <div className="grid g-2" style={{ gap: 8 }}>
                <div>
                  <div className="muted" style={{ fontSize: 10 }}>TOKENS</div>
                  <div className="mono strong">{formatNum(current.estimatedTokens)}</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 10 }}>LAST INDEXED</div>
                  <div className="mono strong">{formatDateTime(current.lastIndexed)}</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 10 }}>LAST MODIFIED</div>
                  <div className="mono strong">{formatDateTime(current.lastModified)}</div>
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 10 }}>STATE</div>
                  <Chip tone={toneFor(ageStatus(current.lastIndexed))}>{ageStatus(current.lastIndexed)}</Chip>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty"><div>Select a file to see details</div></div>
          )}
        </Card>
      </div>
    </div>
  );
}
