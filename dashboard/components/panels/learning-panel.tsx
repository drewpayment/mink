"use client";

import { useState } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card } from "@/components/ui/panel-card";
import { Btn } from "@/components/ui/btn";
import { Icon } from "@/components/ui/icon";
import type { SectionName, RuleSource } from "@mink/types/learning-memory";
import type { LearningEntryPayload } from "@mink/types/dashboard";
import {
  deleteLearningEntry,
  fetchLearningMemory,
  fetchLearningSuggestions,
  proposeLearningRules,
} from "@/lib/api-client";
import { AddRuleModal } from "./learning/add-rule-modal";
import { SuggestionsCard } from "./learning/suggestions-card";

interface SectionDef {
  key: SectionName;
  tabLabel: string;
  title: string;
  sub: string;
}

const SECTIONS: SectionDef[] = [
  { key: "User Preferences", tabLabel: "Preferences",   title: "Preferences",    sub: "How the human likes to work" },
  { key: "Key Learnings",    tabLabel: "Learnings",     title: "Learnings",      sub: "Facts discovered this project" },
  { key: "Do-Not-Repeat",    tabLabel: "Do-not-repeat", title: "Do-not-repeat",  sub: "Mistakes already corrected" },
  { key: "Decision Log",     tabLabel: "Decisions",     title: "Decision log",   sub: "Committed project decisions" },
];

function sourceLabel(source: RuleSource): { label: string; tone: string } {
  switch (source) {
    case "llm:auto":     return { label: "AI", tone: "violet" };
    case "llm:refined":  return { label: "AI-refined", tone: "blue" };
    case "reflection":   return { label: "reflection", tone: "amber" };
    default:             return { label: "user", tone: "" };
  }
}

export function LearningPanel() {
  const learning = useDashboardStore((s) => s.learningMemory);
  const suggestions = useDashboardStore((s) => s.learningSuggestions);
  const setLearningMemory = useDashboardStore((s) => s.setLearningMemory);
  const setLearningSuggestions = useDashboardStore((s) => s.setLearningSuggestions);
  const activeProjectId = useDashboardStore((s) => s.activeProjectId);
  const projectId = activeProjectId ?? undefined;

  const [active, setActive] = useState<SectionName>("User Preferences");
  const [addOpen, setAddOpen] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [proposeMessage, setProposeMessage] = useState<string | null>(null);

  const sections = learning?.sections ?? ({} as Record<SectionName, string[]>);
  const entries = learning?.entries ?? [];
  const current = SECTIONS.find((s) => s.key === active) ?? SECTIONS[0];
  const items = sections[current.key] ?? [];
  const ai = learning?.ai;
  const aiOn = ai?.enabled ?? false;
  const refineEnabled = aiOn && (ai?.manualTriggers ?? false);
  const proposeEnabled = refineEnabled;

  const pendingSuggestions = suggestions?.pending ?? [];

  function entryFor(section: SectionName, index: number): LearningEntryPayload | undefined {
    return entries.find((e) => e.section === section && e.index === index);
  }

  async function refreshAll() {
    try {
      const [mem, sug] = await Promise.all([
        fetchLearningMemory(projectId),
        fetchLearningSuggestions(projectId),
      ]);
      setLearningMemory(mem);
      setLearningSuggestions(sug);
    } catch (err) {
      console.warn("[mink] refresh learning failed", err);
    }
  }

  async function handleDelete(section: SectionName, index: number) {
    const result = await deleteLearningEntry({ section, index }, projectId);
    if (result.ok) refreshAll();
  }

  async function handlePropose() {
    setProposing(true);
    setProposeMessage(null);
    try {
      const result = await proposeLearningRules(undefined, projectId);
      if (result.ok) {
        setProposeMessage(
          `Proposed ${result.total} rule(s): ${result.autoAccepted} auto-accepted, ${result.queued} queued for review.`
        );
        refreshAll();
      } else {
        setProposeMessage(result.message ?? "Propose failed");
      }
    } catch (err) {
      setProposeMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setProposing(false);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Learning memory</h1>
          <p className="page-sub">
            4-section knowledge store · {learning?.projectName || "—"}
            {ai && (
              <span style={{ marginLeft: 8 }}>
                ·
                <span
                  className={`chip ${aiOn ? "accent" : ""}`}
                  style={{ marginLeft: 6, fontSize: 10 }}
                  title={`AI accept threshold: ${ai.autoAcceptThreshold.toFixed(2)}`}
                >
                  AI {aiOn ? "on" : "off"}
                </span>
              </span>
            )}
          </p>
        </div>
        <div className="page-actions">
          <Btn
            icon="sparkles"
            variant="ghost"
            disabled={!proposeEnabled || proposing}
            onClick={handlePropose}
            title={
              proposeEnabled
                ? "Mine the action log for new rule suggestions"
                : "AI manual triggers are disabled"
            }
          >
            {proposing ? "Proposing…" : "Propose rules"}
          </Btn>
          <Btn
            icon="plus"
            variant="primary"
            onClick={() => setAddOpen(true)}
          >
            Add rule
          </Btn>
        </div>
      </div>

      {proposeMessage && (
        <div
          className="chip accent"
          style={{ alignSelf: "flex-start", marginBottom: 10 }}
        >
          {proposeMessage}
        </div>
      )}

      <div className="grid g-4" style={{ marginBottom: 14 }}>
        {SECTIONS.map((s) => {
          const count = (sections[s.key] ?? []).length;
          return (
            <button
              key={s.key}
              type="button"
              className="kpi"
              style={{ cursor: "pointer", borderColor: active === s.key ? "var(--accent)" : undefined, textAlign: "left" }}
              onClick={() => setActive(s.key)}
            >
              <div className="label">{s.title}</div>
              <div className="value mono">{count}</div>
              <div className="delta">{s.sub}</div>
            </button>
          );
        })}
      </div>

      {pendingSuggestions.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <SuggestionsCard
            pending={pendingSuggestions}
            projectId={projectId}
            onChanged={refreshAll}
          />
        </div>
      )}

      <Card
        title={current.title}
        sub={current.sub}
        flush
      >
        {items.length === 0 ? (
          <div className="empty">
            <h4>No entries yet</h4>
            <span>rules will appear here as Claude learns from your sessions.</span>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>Rule</th>
                <th>Source</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((rule, i) => {
                const meta = entryFor(current.key, i)?.meta;
                const tag = sourceLabel(meta?.source ?? "user");
                return (
                  <tr key={`${current.key}-${i}`}>
                    <td className="mono muted" style={{ width: 40 }}>{i + 1}</td>
                    <td>{rule}</td>
                    <td>
                      <span className={`chip ${tag.tone}`} style={{ fontSize: 10 }}>
                        {tag.label}
                      </span>
                      {meta?.confidence !== undefined && (
                        <span className="mono muted" style={{ marginLeft: 6, fontSize: 10 }}>
                          {meta.confidence.toFixed(2)}
                        </span>
                      )}
                    </td>
                    <td className="right">
                      <div className="row tight" style={{ justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="tb-icon-btn"
                          aria-label="Preview rule"
                          title={meta?.rationale || "No rationale"}
                        >
                          <Icon name="eye" size={12} />
                        </button>
                        <button
                          type="button"
                          className="tb-icon-btn"
                          aria-label="Delete rule"
                          title="Delete"
                          onClick={() => handleDelete(current.key, i)}
                        >
                          <Icon name="trash" size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <AddRuleModal
        open={addOpen}
        defaultSection={current.key}
        projectId={projectId}
        refineEnabled={refineEnabled}
        onClose={() => setAddOpen(false)}
        onSaved={refreshAll}
      />
    </div>
  );
}
