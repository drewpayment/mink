"use client";

import { useMemo } from "react";
import { usePreferences } from "./use-preferences";
import {
  formatDate as fmtDate,
  formatDateTime as fmtDateTime,
  formatTime as fmtTime,
  formatMonthDay as fmtMonthDay,
} from "@/lib/format";

/**
 * Timestamp formatters bound to the user's timezone + clock preferences.
 * All dashboard timestamps should render through this hook so the Tweaks
 * menu toggles (Local/UTC, 12h/24h) take effect everywhere.
 */
export function useFormat() {
  const timezone = usePreferences((s) => s.timezone);
  const clock = usePreferences((s) => s.clock);

  return useMemo(() => {
    const opts = { timezone, clock };
    return {
      timezone,
      clock,
      formatDate: (iso: string) => fmtDate(iso, opts),
      formatDateTime: (iso: string) => fmtDateTime(iso, opts),
      formatTime: (iso: string) => fmtTime(iso, opts),
      formatMonthDay: (iso: string) => fmtMonthDay(iso, opts),
    };
  }, [timezone, clock]);
}
