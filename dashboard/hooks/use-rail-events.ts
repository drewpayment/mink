"use client";

import { useEffect, useState } from "react";
import { useDashboardStore, type ActionLogRow } from "./use-dashboard-store";
import { usePreferences } from "./use-preferences";
import { formatTime, type TimezoneMode, type ClockFormat } from "@/lib/format";

export interface RailEvent {
  t: string;
  type: string;
  msg: string;
  tgt: string;
  meta?: string;
  flavor?: "hit" | "warn";
  id: string;
}

const ACTION_LABEL: Record<string, { type: string; verb: string; flavor?: "hit" | "warn" }> = {
  "Read":          { type: "read",    verb: "Read" },
  "Create":        { type: "write",   verb: "Create" },
  "Edit":          { type: "write",   verb: "Edit" },
  "Session start": { type: "session", verb: "Session started" },
  "Session end":   { type: "session", verb: "Session ended" },
};

function actionLogToEvent(
  row: ActionLogRow,
  i: number,
  timezone: TimezoneMode,
  clock: ClockFormat,
): RailEvent {
  const mapping = ACTION_LABEL[row.action] ?? { type: "other", verb: row.action };
  const outcome = row.outcome?.toLowerCase() ?? "";
  const flavor =
    outcome.includes("hit") || outcome.includes("saved") ? "hit"
    : outcome.includes("miss") || outcome.includes("blocked") ? "warn"
    : mapping.flavor;
  // Prefer the reconstructed UTC instant so the rail honors the tz/clock
  // preferences; fall back to the raw backend time (UTC HH:MM) when absent.
  const t = row.iso ? formatTime(row.iso, { timezone, clock }) : row.time;
  return {
    t,
    type: mapping.type,
    msg: mapping.verb,
    tgt: row.files || "—",
    meta: row.tokens && row.tokens !== "—" ? `${row.tokens} tok` : row.outcome,
    flavor,
    id: `al-${i}-${row.time}-${row.files}`,
  };
}

/**
 * Produces the rolling list shown in the right-side "Live activity" rail.
 * Today it derives from the most recent action-log entries (newest first).
 * Preferences.liveFeel controls the pulse/animation cadence on the UI side.
 */
export function useRailEvents(limit = 60): RailEvent[] {
  const rows = useDashboardStore((s) => s.actionLog);
  const liveFeel = usePreferences((s) => s.liveFeel);
  const timezone = usePreferences((s) => s.timezone);
  const clock = usePreferences((s) => s.clock);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!liveFeel) return;
    const id = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(id);
  }, [liveFeel]);

  // Tick just forces a rerender so `fresh` animations re-apply; the underlying
  // data source is the action-log rows kept up-to-date by SSE.
  void tick;

  return rows
    .slice()
    .reverse()
    .slice(0, limit)
    .map((r, i) => actionLogToEvent(r, i, timezone, clock));
}
