export type TimezoneMode = "local" | "utc";
export type ClockFormat = "12h" | "24h";

export interface TimeFormatOpts {
  timezone?: TimezoneMode;
  clock?: ClockFormat;
}

/** Maps the timezone preference to an Intl `timeZone` value (undefined = browser local). */
function resolveTimeZone(timezone?: TimezoneMode): string | undefined {
  return timezone === "utc" ? "UTC" : undefined;
}

/** Maps the clock preference to Intl's `hour12` flag (undefined = locale default). */
function resolveHour12(clock?: ClockFormat): boolean | undefined {
  if (clock === "12h") return true;
  if (clock === "24h") return false;
  return undefined;
}

export function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function formatUptime(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return hr + "h " + (min % 60) + "m";
  if (min > 0) return min + "m " + (sec % 60) + "s";
  return sec + "s";
}

export function formatDate(iso: string, opts: TimeFormatOpts = {}): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString([], {
      timeZone: resolveTimeZone(opts.timezone),
    });
  } catch {
    return iso;
  }
}

/** Time-only ("4:22 PM" / "16:22"), honoring timezone + clock preferences. */
export function formatTime(iso: string, opts: TimeFormatOpts = {}): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: resolveHour12(opts.clock),
      timeZone: resolveTimeZone(opts.timezone),
    });
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string, opts: TimeFormatOpts = {}): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const tz = resolveTimeZone(opts.timezone);
    return (
      d.toLocaleDateString([], { timeZone: tz }) +
      " " +
      d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        hour12: resolveHour12(opts.clock),
        timeZone: tz,
      })
    );
  } catch {
    return iso;
  }
}

/** Short month/day label for chart axes ("Jun 22"), honoring the timezone preference. */
export function formatMonthDay(iso: string, opts: TimeFormatOpts = {}): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString([], {
      month: "short",
      day: "numeric",
      timeZone: resolveTimeZone(opts.timezone),
    });
  } catch {
    return iso;
  }
}
