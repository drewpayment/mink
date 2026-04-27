"use client";

import { useState } from "react";
import { Card } from "@/components/ui/panel-card";
import { Btn } from "@/components/ui/btn";
import {
  acceptLearningSuggestion,
  rejectLearningSuggestion,
} from "@/lib/api-client";
import type { SuggestedRule, SectionName } from "@mink/types/learning-memory";

interface SuggestionsCardProps {
  pending: SuggestedRule[];
  projectId?: string;
  onChanged: () => void;
}

const SECTION_OPTIONS: SectionName[] = [
  "User Preferences",
  "Key Learnings",
  "Do-Not-Repeat",
  "Decision Log",
];

export function SuggestionsCard({
  pending,
  projectId,
  onChanged,
}: SuggestionsCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editSection, setEditSection] = useState<SectionName>(
    "User Preferences"
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  if (pending.length === 0) {
    return null;
  }

  function startEdit(s: SuggestedRule) {
    setEditingId(s.id);
    setEditText(s.text);
    setEditSection(s.section);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
  }

  async function handleAccept(s: SuggestedRule, useEdits: boolean) {
    setBusyId(s.id);
    try {
      const edits = useEdits
        ? { section: editSection, text: editText }
        : undefined;
      const result = await acceptLearningSuggestion(s.id, edits, projectId);
      if (result.ok) {
        cancelEdit();
        onChanged();
      }
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(s: SuggestedRule) {
    setBusyId(s.id);
    try {
      const result = await rejectLearningSuggestion(s.id, projectId);
      if (result.ok) onChanged();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card
      title={`Suggestions (${pending.length})`}
      sub="Pending AI-proposed rules awaiting your call"
      flush
    >
      <table className="tbl">
        <thead>
          <tr>
            <th>Section</th>
            <th>Rule</th>
            <th>Confidence</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {pending.map((s) => {
            const isEditing = editingId === s.id;
            const isBusy = busyId === s.id;
            return (
              <tr key={s.id}>
                <td>
                  {isEditing ? (
                    <select
                      value={editSection}
                      onChange={(e) =>
                        setEditSection(e.target.value as SectionName)
                      }
                      style={{
                        background: "var(--bg-inset)",
                        border: "1px solid var(--line-1)",
                        borderRadius: 6,
                        padding: "3px 6px",
                        color: "var(--fg-0)",
                        fontSize: 11,
                      }}
                    >
                      {SECTION_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="chip">{s.section}</span>
                  )}
                </td>
                <td>
                  {isEditing ? (
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={2}
                      style={{
                        width: "100%",
                        background: "var(--bg-inset)",
                        border: "1px solid var(--line-1)",
                        borderRadius: 6,
                        padding: "5px 7px",
                        color: "var(--fg-0)",
                        fontSize: 12,
                      }}
                    />
                  ) : (
                    <>
                      <div>{s.text}</div>
                      {s.rationale && (
                        <div
                          className="muted"
                          style={{ fontSize: 11, marginTop: 2 }}
                        >
                          {s.rationale}
                        </div>
                      )}
                    </>
                  )}
                </td>
                <td className="mono">{s.confidence.toFixed(2)}</td>
                <td className="right">
                  <div
                    className="row tight"
                    style={{ justifyContent: "flex-end", gap: 6 }}
                  >
                    {isEditing ? (
                      <>
                        <Btn
                          size="sm"
                          variant="primary"
                          icon="check"
                          onClick={() => handleAccept(s, true)}
                          disabled={isBusy || !editText.trim()}
                        >
                          Save
                        </Btn>
                        <Btn
                          size="sm"
                          variant="ghost"
                          onClick={cancelEdit}
                          disabled={isBusy}
                        >
                          Cancel
                        </Btn>
                      </>
                    ) : (
                      <>
                        <Btn
                          size="sm"
                          variant="primary"
                          icon="check"
                          onClick={() => handleAccept(s, false)}
                          disabled={isBusy}
                        >
                          Accept
                        </Btn>
                        <Btn
                          size="sm"
                          variant="ghost"
                          icon="settings"
                          onClick={() => startEdit(s)}
                          disabled={isBusy}
                        >
                          Edit
                        </Btn>
                        <Btn
                          size="sm"
                          variant="danger"
                          icon="x"
                          onClick={() => handleReject(s)}
                          disabled={isBusy}
                        >
                          Reject
                        </Btn>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
