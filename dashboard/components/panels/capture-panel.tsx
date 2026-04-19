"use client";

import { useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { MOCK_NOTES } from "@/lib/mock-dashboard-data";

type Mode = "quick" | "structured" | "daily" | "file";

export function CapturePanel() {
  const [mode, setMode] = useState<Mode>("quick");

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Capture</span>
            <Chip tone="amber">preview</Chip>
          </h1>
          <p className="page-sub">Quick or structured — Claude categorizes, tags, and wikilinks automatically</p>
        </div>
        <div className="page-actions">
          <Btn icon="sparkles" variant="ghost" disabled>Use /mink:note skill</Btn>
        </div>
      </div>

      <Card>
        <div className="seg" style={{ marginBottom: 12 }}>
          {(["quick", "structured", "daily", "file"] as const).map((k) => (
            <button key={k} type="button" className={mode === k ? "on" : ""} onClick={() => setMode(k)}>
              {k === "file" ? "Ingest file" : k === "daily" ? "Daily journal" : k[0].toUpperCase() + k.slice(1)}
            </button>
          ))}
        </div>

        {mode === "quick" && (
          <div className="vstack">
            <div className="field">
              <label>Quick capture</label>
              <textarea rows={4} placeholder="What's on your mind? Claude will pick the category and tags." />
              <div className="hint">
                Lands in <span className="mono">inbox/</span> unless Claude detects a better home.
              </div>
            </div>
            <div className="row tight">
              <Btn variant="primary" icon="plus" disabled title="Write endpoint coming soon">Capture</Btn>
              <Btn variant="ghost" disabled>Let Claude decide</Btn>
            </div>
          </div>
        )}

        {mode === "structured" && (
          <div className="grid g-2">
            <div className="field"><label>Title</label><input placeholder="e.g. JWT Cookie Pattern" /></div>
            <div className="field">
              <label>Category</label>
              <select>
                <option>inbox</option><option>projects</option><option>areas</option>
                <option>resources</option><option>patterns</option><option>archives</option>
              </select>
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Body (markdown)</label>
              <textarea rows={6} className="mono" placeholder={"## Context\n\nUse httpOnly cookies for token storage..."} />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Tags</label>
              <input placeholder="auth, security, pattern" />
            </div>
            <div style={{ gridColumn: "span 2" }} className="row tight">
              <Btn variant="primary" icon="plus" disabled>Create note</Btn>
              <Btn variant="ghost" disabled>Save draft</Btn>
            </div>
          </div>
        )}

        {mode === "daily" && (
          <div className="vstack">
            <div className="field">
              <label>Today</label>
              <textarea rows={5} placeholder="Append to today's daily entry…" />
            </div>
            <div className="row tight">
              <Btn variant="primary" icon="plus" disabled>Append</Btn>
              <Btn variant="ghost" icon="eye" disabled>View day</Btn>
            </div>
          </div>
        )}

        {mode === "file" && (
          <div className="vstack">
            <div className="field">
              <label>Source file</label>
              <input placeholder="./scratch-notes.md" className="mono" />
            </div>
            <div className="field">
              <label>Category</label>
              <select>
                <option>resources</option><option>patterns</option><option>inbox</option>
              </select>
            </div>
            <div className="row tight">
              <Btn variant="primary" icon="upload" disabled>Ingest</Btn>
            </div>
          </div>
        )}
      </Card>

      <div style={{ height: 14 }} />

      <Card title="Tag cloud" sub="top tags across the vault">
        <div className="row tight" style={{ flexWrap: "wrap", gap: 6 }}>
          {MOCK_NOTES.tags.map(([t, c]) => (
            <Chip key={t}>
              <span>#{t}</span>
              <span className="muted">{c}</span>
            </Chip>
          ))}
        </div>
      </Card>
    </div>
  );
}
