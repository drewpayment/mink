"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Icon } from "@/components/ui/icon";
import { Toggle } from "@/components/ui/toggle";
import { MOCK_CONFIG } from "@/lib/mock-dashboard-data";

export function ConfigPanel() {
  const [q, setQ] = useState("");

  const grouped = useMemo(() => {
    const out: Record<string, typeof MOCK_CONFIG> = {};
    for (const entry of MOCK_CONFIG) {
      if (q && !entry.key.toLowerCase().includes(q.toLowerCase())) continue;
      (out[entry.group] = out[entry.group] ?? []).push(entry);
    }
    return out;
  }, [q]);

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Configuration</span>
            <Chip tone="amber">preview</Chip>
          </h1>
          <p className="page-sub">
            ~/.mink/config.json (shared) · ~/.mink/config.local (machine-scoped)
          </p>
        </div>
        <div className="page-actions">
          <Btn icon="download" variant="ghost" disabled>Export</Btn>
          <Btn icon="upload" disabled>Import</Btn>
        </div>
      </div>

      <Card
        title="All settings"
        tools={
          <div className="row" style={{ maxWidth: 220 }}>
            <Icon name="search" size={12} className="muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter keys…"
              aria-label="Filter config keys"
              style={{
                background: "transparent",
                border: 0,
                color: "var(--fg-0)",
                outline: "none",
                fontSize: 11.5,
                flex: 1,
                fontFamily: "var(--font-mono), monospace",
              }}
            />
          </div>
        }
        flush
      >
        {Object.keys(grouped).length === 0 ? (
          <div className="empty"><h4>No settings match</h4></div>
        ) : (
          Object.entries(grouped).map(([g, items]) => (
            <div key={g}>
              <div
                style={{
                  padding: "8px 14px",
                  background: "var(--bg-2)",
                  borderTop: "1px solid var(--line-1)",
                  borderBottom: "1px solid var(--line-1)",
                  fontSize: 10.5,
                  color: "var(--fg-3)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  fontWeight: 600,
                }}
              >
                {g}
              </div>
              {items.map((entry) => (
                <div
                  key={entry.key}
                  className="row"
                  style={{ padding: "8px 14px", borderBottom: "1px solid var(--line-1)", gap: 14 }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mono strong" style={{ fontSize: 12 }}>{entry.key}</div>
                  </div>
                  <div style={{ width: 240 }}>
                    {typeof entry.value === "boolean" ? (
                      <Toggle on={entry.value} />
                    ) : (
                      <input
                        defaultValue={String(entry.value)}
                        readOnly
                        className="mono"
                        style={{
                          width: "100%",
                          background: "var(--bg-inset)",
                          border: "1px solid var(--line-1)",
                          borderRadius: 5,
                          padding: "4px 8px",
                          color: "var(--fg-0)",
                          fontSize: 11,
                          outline: "none",
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
