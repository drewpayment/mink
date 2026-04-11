import type { CronSchedule } from "../types/scheduler";

// ── Field Parsing ───────────────────────────────────────────────────────────

function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (part.includes("/")) {
      const [range, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) {
        throw new Error(`Invalid step value: ${part}`);
      }
      const start = range === "*" ? min : parseInt(range, 10);
      if (isNaN(start) || start < min || start > max) {
        throw new Error(`Invalid range start: ${part}`);
      }
      for (let i = start; i <= max; i += step) values.add(i);
    } else if (part.includes("-")) {
      const [lo, hi] = part.split("-").map(Number);
      if (isNaN(lo) || isNaN(hi) || lo < min || hi > max || lo > hi) {
        throw new Error(`Invalid range: ${part}`);
      }
      for (let i = lo; i <= hi; i++) values.add(i);
    } else {
      const n = parseInt(part, 10);
      if (isNaN(n) || n < min || n > max) {
        throw new Error(`Invalid value: ${part} (must be ${min}-${max})`);
      }
      values.add(n);
    }
  }

  return [...values].sort((a, b) => a - b);
}

// ── Public API ──────────────────────────────────────────────────────────────

export function parseCronExpression(expr: string): CronSchedule {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression: expected 5 fields, got ${fields.length}`
    );
  }

  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dayOfMonth: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    dayOfWeek: parseField(fields[4], 0, 6),
  };
}

function matches(schedule: CronSchedule, date: Date): boolean {
  return (
    schedule.minute.includes(date.getUTCMinutes()) &&
    schedule.hour.includes(date.getUTCHours()) &&
    schedule.dayOfMonth.includes(date.getUTCDate()) &&
    schedule.month.includes(date.getUTCMonth() + 1) &&
    schedule.dayOfWeek.includes(date.getUTCDay())
  );
}

export function nextRunAfter(schedule: CronSchedule, after: Date): Date {
  // Start from the next whole minute
  const candidate = new Date(after.getTime());
  candidate.setUTCSeconds(0, 0);
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

  const limit = after.getTime() + 366 * 24 * 60 * 60 * 1000;

  while (candidate.getTime() <= limit) {
    if (matches(schedule, candidate)) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }

  throw new Error("No matching time found within 366 days");
}

export function isInCurrentPeriod(
  schedule: CronSchedule,
  lastRun: Date,
  now: Date
): boolean {
  const next = nextRunAfter(schedule, lastRun);
  return now.getTime() < next.getTime();
}
