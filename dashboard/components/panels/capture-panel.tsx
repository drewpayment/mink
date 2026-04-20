"use client";

import { useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Chip } from "@/components/ui/chip";
import { Btn } from "@/components/ui/btn";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { createNote, appendDaily, ingestFile } from "@/lib/api-client";

type Mode = "quick" | "structured" | "daily" | "file";
type Status = "idle" | "saving" | "saved" | "error";

const EMPTY_TAGS: ReadonlyArray<[string, number]> = [];

function randomKey() {
  return (
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `dedup-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function CapturePanel() {
  const [mode, setMode] = useState<Mode>("quick");
  const tags = useDashboardStore((s) => s.wiki?.tags ?? EMPTY_TAGS);

  // Per-mode form state.
  const [quickBody, setQuickBody] = useState("");
  const [stTitle, setStTitle] = useState("");
  const [stCategory, setStCategory] = useState("inbox");
  const [stBody, setStBody] = useState("");
  const [stTags, setStTags] = useState("");
  const [dailyBody, setDailyBody] = useState("");
  const [fileSourcePath, setFileSourcePath] = useState("");
  const [fileCategory, setFileCategory] = useState("resources");

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);

  async function run(fn: () => Promise<{ success: boolean; error?: string; filePath?: string }>) {
    setStatus("saving");
    setError(null);
    try {
      const result = await fn();
      if (result.success) {
        setStatus("saved");
        setLastSaved(result.filePath ?? null);
        setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 2000);
      } else {
        setStatus("error");
        setError(result.error ?? "Save failed");
      }
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function parseTags(raw: string): string[] {
    return raw
      .split(",")
      .map((t) => t.trim().replace(/^#/, ""))
      .filter(Boolean);
  }

  function doQuick() {
    const body = quickBody.trim();
    if (!body) return;
    const dedupKey = randomKey();
    run(() =>
      createNote({ mode: "quick", body, dedupKey }),
    ).then(() => setQuickBody(""));
  }

  function doStructured() {
    const body = stBody.trim();
    if (!body) return;
    const dedupKey = randomKey();
    run(() =>
      createNote({
        mode: "structured",
        title: stTitle.trim(),
        category: stCategory,
        body,
        tags: parseTags(stTags),
        dedupKey,
      }),
    ).then(() => {
      setStTitle("");
      setStBody("");
      setStTags("");
    });
  }

  function doDaily() {
    const content = dailyBody.trim();
    if (!content) return;
    const dedupKey = randomKey();
    run(() => appendDaily(content, dedupKey)).then(() => setDailyBody(""));
  }

  function doIngest() {
    const source = fileSourcePath.trim();
    if (!source) return;
    const dedupKey = randomKey();
    run(() => ingestFile({ sourcePath: source, category: fileCategory, dedupKey })).then(() =>
      setFileSourcePath(""),
    );
  }

  function StatusBanner() {
    if (status === "saved" && lastSaved) {
      return (
        <div className="muted" style={{ fontSize: 11, color: "var(--accent)" }}>
          Saved → <span className="mono">{lastSaved}</span>
        </div>
      );
    }
    if (status === "error" && error) {
      return (
        <div style={{ fontSize: 11, color: "var(--danger, #c33)", whiteSpace: "pre-wrap" }}>
          {error}
        </div>
      );
    }
    if (status === "saving") {
      return <div className="muted" style={{ fontSize: 11 }}>Saving…</div>;
    }
    return null;
  }

  return (
    <div className="page" style={{ maxWidth: 900 }}>
      <div className="page-head">
        <div>
          <h1 className="page-title row tight">
            <span>Capture</span>
          </h1>
          <p className="page-sub">Quick or structured — captures land in the vault immediately</p>
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
              <textarea
                rows={4}
                value={quickBody}
                onChange={(e) => setQuickBody(e.target.value)}
                placeholder="What's on your mind? First line becomes the title; lands in inbox/."
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doQuick();
                }}
              />
              <div className="hint">
                Lands in <span className="mono">inbox/</span>. Cmd/Ctrl+Enter to save.
              </div>
            </div>
            <div className="row tight">
              <Btn
                variant="primary"
                icon="plus"
                onClick={doQuick}
                disabled={status === "saving" || !quickBody.trim()}
              >
                {status === "saving" ? "Saving…" : "Capture"}
              </Btn>
              <StatusBanner />
            </div>
          </div>
        )}

        {mode === "structured" && (
          <div className="grid g-2">
            <div className="field">
              <label>Title</label>
              <input
                value={stTitle}
                onChange={(e) => setStTitle(e.target.value)}
                placeholder="e.g. JWT Cookie Pattern"
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={stCategory} onChange={(e) => setStCategory(e.target.value)}>
                <option value="inbox">inbox</option>
                <option value="projects">projects</option>
                <option value="areas">areas</option>
                <option value="resources">resources</option>
                <option value="archives">archives</option>
              </select>
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Body (markdown)</label>
              <textarea
                rows={6}
                className="mono"
                value={stBody}
                onChange={(e) => setStBody(e.target.value)}
                placeholder={"## Context\n\nUse httpOnly cookies for token storage..."}
              />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Tags (comma-separated)</label>
              <input
                value={stTags}
                onChange={(e) => setStTags(e.target.value)}
                placeholder="auth, security, pattern"
              />
            </div>
            <div style={{ gridColumn: "span 2" }} className="row tight">
              <Btn
                variant="primary"
                icon="plus"
                onClick={doStructured}
                disabled={status === "saving" || !stBody.trim()}
              >
                {status === "saving" ? "Saving…" : "Create note"}
              </Btn>
              <StatusBanner />
            </div>
          </div>
        )}

        {mode === "daily" && (
          <div className="vstack">
            <div className="field">
              <label>Today</label>
              <textarea
                rows={5}
                value={dailyBody}
                onChange={(e) => setDailyBody(e.target.value)}
                placeholder="Append to today's daily entry…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) doDaily();
                }}
              />
            </div>
            <div className="row tight">
              <Btn
                variant="primary"
                icon="plus"
                onClick={doDaily}
                disabled={status === "saving" || !dailyBody.trim()}
              >
                {status === "saving" ? "Saving…" : "Append"}
              </Btn>
              <StatusBanner />
            </div>
          </div>
        )}

        {mode === "file" && (
          <div className="vstack">
            <div className="field">
              <label>Source file</label>
              <input
                value={fileSourcePath}
                onChange={(e) => setFileSourcePath(e.target.value)}
                placeholder="./scratch-notes.md"
                className="mono"
              />
            </div>
            <div className="field">
              <label>Category</label>
              <select value={fileCategory} onChange={(e) => setFileCategory(e.target.value)}>
                <option value="resources">resources</option>
                <option value="inbox">inbox</option>
                <option value="projects">projects</option>
                <option value="archives">archives</option>
              </select>
            </div>
            <div className="row tight">
              <Btn
                variant="primary"
                icon="upload"
                onClick={doIngest}
                disabled={status === "saving" || !fileSourcePath.trim()}
              >
                {status === "saving" ? "Ingesting…" : "Ingest"}
              </Btn>
              <StatusBanner />
            </div>
          </div>
        )}
      </Card>

      <div style={{ height: 14 }} />

      <Card title="Tag cloud" sub="top tags across the vault">
        <div className="row tight" style={{ flexWrap: "wrap", gap: 6 }}>
          {tags.length === 0 ? (
            <span className="muted" style={{ fontSize: 11 }}>No tags yet — capture a note to get started.</span>
          ) : (
            tags.slice(0, 40).map(([t, c]) => (
              <Chip key={t}>
                <span>#{t}</span>
                <span className="muted">{c}</span>
              </Chip>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
