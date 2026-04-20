"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { Icon } from "@/components/ui/icon";
import { Toggle } from "@/components/ui/toggle";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { setConfigValue, resetConfigKey } from "@/lib/api-client";
import type { ConfigEntry, ConfigValueSource } from "@mink/types/dashboard";

const SOURCE_TONES: Record<ConfigValueSource, "" | "accent" | "amber" | ""> = {
  default: "",
  shared: "accent",
  local: "accent",
  env: "amber",
};

const SOURCE_LABEL: Record<ConfigValueSource, string> = {
  default: "default",
  shared: "shared",
  local: "local",
  env: "env",
};

function GroupHeader({ label }: { label: string }) {
  return (
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
      {label}
    </div>
  );
}

function ConfigRow({ entry }: { entry: ConfigEntry }) {
  const [draft, setDraft] = useState(entry.value);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPropValue = useRef(entry.value);

  // Keep draft in sync with incoming server state unless the user is actively editing.
  useEffect(() => {
    if (entry.value !== lastPropValue.current) {
      lastPropValue.current = entry.value;
      if (status !== "saving") setDraft(entry.value);
    }
  }, [entry.value, status]);

  function save(nextValue: string) {
    setStatus("saving");
    setError(null);
    setConfigValue(entry.key, nextValue)
      .then((result) => {
        if (result.success) {
          setStatus("saved");
          setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
        } else {
          setStatus("error");
          setError(result.error ?? "Failed to save");
        }
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  function onTextChange(nextValue: string) {
    setDraft(nextValue);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(nextValue), 500);
  }

  function onToggle(next: boolean) {
    const nextValue = next ? "true" : "false";
    setDraft(nextValue);
    save(nextValue);
  }

  function onReset() {
    setStatus("saving");
    setError(null);
    resetConfigKey(entry.key)
      .then((result) => {
        if (result.success) {
          setStatus("saved");
          setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1500);
        } else {
          setStatus("error");
          setError(result.error ?? "Failed to reset");
        }
      })
      .catch((err) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : String(err));
      });
  }

  const isBoolean = entry.type === "boolean";
  const displayValue =
    entry.isSecret && !revealSecret ? draft : draft;

  return (
    <div
      className="row"
      style={{
        padding: "8px 14px",
        borderBottom: "1px solid var(--line-1)",
        gap: 14,
        alignItems: "center",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row tight" style={{ gap: 6 }}>
          <span className="mono strong" style={{ fontSize: 12 }}>{entry.key}</span>
          <Chip tone={SOURCE_TONES[entry.source]}>{SOURCE_LABEL[entry.source]}</Chip>
          {entry.isSecret && <Chip>secret</Chip>}
        </div>
        {entry.description && (
          <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
            {entry.description}
          </div>
        )}
        {error && (
          <div style={{ fontSize: 10.5, color: "var(--danger, #c33)", marginTop: 2 }}>
            {error}
          </div>
        )}
      </div>
      <div style={{ width: 260, display: "flex", gap: 6, alignItems: "center" }}>
        {isBoolean ? (
          <Toggle on={draft === "true"} onChange={onToggle} />
        ) : (
          <input
            value={displayValue}
            onChange={(e) => onTextChange(e.target.value)}
            type={entry.isSecret && !revealSecret ? "password" : "text"}
            className="mono"
            aria-label={entry.key}
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
        {entry.isSecret && !isBoolean && (
          <Btn
            size="sm"
            variant="ghost"
            icon="eye"
            onClick={() => setRevealSecret((v) => !v)}
            title={revealSecret ? "Hide" : "Reveal"}
          >
            {revealSecret ? "Hide" : "Show"}
          </Btn>
        )}
        <Btn
          size="sm"
          variant="ghost"
          icon="refresh"
          onClick={onReset}
          disabled={status === "saving" || entry.source === "default"}
          title="Reset to default"
        >
          {status === "saving" ? "…" : status === "saved" ? "✓" : "Reset"}
        </Btn>
      </div>
    </div>
  );
}

export function ConfigPanel() {
  const config = useDashboardStore((s) => s.config);
  const [q, setQ] = useState("");

  const entries = config?.entries ?? [];

  const grouped = useMemo(() => {
    const out: Record<string, ConfigEntry[]> = {};
    for (const entry of entries) {
      if (q && !entry.key.toLowerCase().includes(q.toLowerCase())) continue;
      (out[entry.group] = out[entry.group] ?? []).push(entry);
    }
    return out;
  }, [entries, q]);

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Configuration</span>
          </h1>
          <p className="page-sub">
            ~/.mink/config (shared) · ~/.mink/config.local (per-machine) · env vars override
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
        {entries.length === 0 ? (
          <div className="empty"><h4>Loading configuration…</h4></div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="empty"><h4>No settings match</h4></div>
        ) : (
          Object.entries(grouped).map(([g, items]) => (
            <div key={g}>
              <GroupHeader label={g} />
              {items.map((entry) => (
                <ConfigRow key={entry.key} entry={entry} />
              ))}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
