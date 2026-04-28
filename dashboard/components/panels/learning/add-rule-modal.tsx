"use client";

import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Btn } from "@/components/ui/btn";
import { Icon } from "@/components/ui/icon";
import {
  addLearningEntry,
  refineLearningRule,
} from "@/lib/api-client";
import type { SectionName } from "@mink/types/learning-memory";

const SECTION_OPTIONS: { value: SectionName; label: string }[] = [
  { value: "User Preferences", label: "User Preferences" },
  { value: "Key Learnings", label: "Key Learnings" },
  { value: "Do-Not-Repeat", label: "Do-Not-Repeat" },
  { value: "Decision Log", label: "Decision Log" },
];

interface AddRuleModalProps {
  open: boolean;
  defaultSection?: SectionName;
  projectId?: string;
  refineEnabled: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface RefinedState {
  text: string;
  rationale: string;
  confidence: number;
}

export function AddRuleModal({
  open,
  defaultSection = "User Preferences",
  projectId,
  refineEnabled,
  onClose,
  onSaved,
}: AddRuleModalProps) {
  const [section, setSection] = useState<SectionName>(defaultSection);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"refine" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refined, setRefined] = useState<RefinedState | null>(null);

  useEffect(() => {
    if (open) {
      setSection(defaultSection);
      setText("");
      setRefined(null);
      setError(null);
      setBusy(null);
    }
  }, [open, defaultSection]);

  async function handleRefine() {
    if (!text.trim()) return;
    setBusy("refine");
    setError(null);
    try {
      const result = await refineLearningRule(
        { section, text },
        projectId
      );
      if ("error" in result) {
        setError(result.error);
      } else {
        setRefined({
          text: result.refinedText,
          rationale: result.rationale,
          confidence: result.confidence,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSave(useRefined: boolean) {
    const value = useRefined && refined ? refined.text : text;
    if (!value.trim()) return;
    setBusy("save");
    setError(null);
    try {
      const result = await addLearningEntry(
        {
          section,
          text: value,
          source: useRefined && refined ? "llm:refined" : "user",
        },
        projectId
      );
      if (result.ok) {
        onSaved();
        onClose();
      } else {
        setError(result.error || "Failed to add rule");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-overlay" />
        <DialogPrimitive.Content className="modal-content">
          <DialogPrimitive.Title className="modal-title">
            Add learning rule
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="modal-desc">
            Capture a workflow preference, project fact, mistake-to-avoid, or
            committed decision.
          </DialogPrimitive.Description>

          <div className="field">
            <label htmlFor="add-rule-section">Section</label>
            <select
              id="add-rule-section"
              value={section}
              onChange={(e) => setSection(e.target.value as SectionName)}
            >
              {SECTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="add-rule-text">Rule</label>
            <textarea
              id="add-rule-text"
              rows={3}
              placeholder="Single imperative sentence describing the rule…"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setRefined(null);
              }}
            />
            <span className="hint">
              {refineEnabled
                ? "Tip: click Refine to let the AI tighten phrasing before saving."
                : "AI manual triggers are disabled in config."}
            </span>
          </div>

          {refined && (
            <div
              className="inset"
              style={{ display: "flex", flexDirection: "column", gap: 6 }}
            >
              <div style={{ fontWeight: 600, color: "var(--fg-0)" }}>
                AI refinement
                <span
                  className="chip accent"
                  style={{ marginLeft: 8, fontSize: 10 }}
                >
                  conf {refined.confidence.toFixed(2)}
                </span>
              </div>
              <div>{refined.text}</div>
              {refined.rationale && (
                <div className="c" style={{ fontSize: 11 }}>
                  {refined.rationale}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="chip red" style={{ alignSelf: "flex-start" }}>
              {error}
            </div>
          )}

          <div className="modal-footer">
            <Btn
              variant="ghost"
              icon="wand"
              onClick={handleRefine}
              disabled={!refineEnabled || !text.trim() || busy !== null}
            >
              {busy === "refine" ? "Refining…" : "Refine with AI"}
            </Btn>
            {refined && (
              <Btn
                variant="primary"
                icon="check"
                onClick={() => handleSave(true)}
                disabled={busy !== null}
              >
                Save refined
              </Btn>
            )}
            <Btn
              variant={refined ? "ghost" : "primary"}
              icon="plus"
              onClick={() => handleSave(false)}
              disabled={!text.trim() || busy !== null}
            >
              {busy === "save" ? "Saving…" : refined ? "Save original" : "Save"}
            </Btn>
            <Btn variant="ghost" onClick={onClose} disabled={busy !== null}>
              Cancel
            </Btn>
          </div>

          <DialogPrimitive.Close
            className="modal-close"
            aria-label="Close"
          >
            <Icon name="x" size={12} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
