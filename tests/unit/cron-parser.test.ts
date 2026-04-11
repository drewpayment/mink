import { describe, test, expect } from "bun:test";
import {
  parseCronExpression,
  nextRunAfter,
  isInCurrentPeriod,
} from "../../src/core/cron-parser";

// ── parseCronExpression ─────────────────────────────────────────────────────

describe("parseCronExpression", () => {
  test("parses wildcard fields", () => {
    const s = parseCronExpression("* * * * *");
    expect(s.minute.length).toBe(60);
    expect(s.hour.length).toBe(24);
    expect(s.dayOfMonth.length).toBe(31);
    expect(s.month.length).toBe(12);
    expect(s.dayOfWeek.length).toBe(7);
  });

  test("parses literal values", () => {
    const s = parseCronExpression("0 2 * * *");
    expect(s.minute).toEqual([0]);
    expect(s.hour).toEqual([2]);
  });

  test("parses step values — */6", () => {
    const s = parseCronExpression("0 */6 * * *");
    expect(s.hour).toEqual([0, 6, 12, 18]);
    expect(s.minute).toEqual([0]);
  });

  test("parses step values — */15 for minutes", () => {
    const s = parseCronExpression("*/15 * * * *");
    expect(s.minute).toEqual([0, 15, 30, 45]);
  });

  test("parses ranges", () => {
    const s = parseCronExpression("0 9-17 * * *");
    expect(s.hour).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  });

  test("parses lists", () => {
    const s = parseCronExpression("0 0 * * 1,3,5");
    expect(s.dayOfWeek).toEqual([1, 3, 5]);
  });

  test("parses all 5 built-in schedules", () => {
    // File Index Rescan: every 6 hours
    const s1 = parseCronExpression("0 */6 * * *");
    expect(s1.minute).toEqual([0]);
    expect(s1.hour).toEqual([0, 6, 12, 18]);

    // Action Log Consolidation: daily at 2 AM
    const s2 = parseCronExpression("0 2 * * *");
    expect(s2.minute).toEqual([0]);
    expect(s2.hour).toEqual([2]);

    // Waste Detection: weekly on Mondays
    const s3 = parseCronExpression("0 0 * * 1");
    expect(s3.dayOfWeek).toEqual([1]);

    // Learning Memory Reflection: Sundays at 3 AM
    const s4 = parseCronExpression("0 3 * * 0");
    expect(s4.dayOfWeek).toEqual([0]);
    expect(s4.hour).toEqual([3]);

    // Project Suggestions: Mondays at 4 AM
    const s5 = parseCronExpression("0 4 * * 1");
    expect(s5.dayOfWeek).toEqual([1]);
    expect(s5.hour).toEqual([4]);
  });

  test("parses combined list and range", () => {
    const s = parseCronExpression("0 0 1,15 * *");
    expect(s.dayOfMonth).toEqual([1, 15]);
  });

  test("rejects wrong number of fields", () => {
    expect(() => parseCronExpression("0 0 * *")).toThrow("expected 5 fields");
    expect(() => parseCronExpression("0 0 * * * *")).toThrow(
      "expected 5 fields"
    );
  });

  test("rejects out-of-range values", () => {
    expect(() => parseCronExpression("60 * * * *")).toThrow();
    expect(() => parseCronExpression("* 25 * * *")).toThrow();
    expect(() => parseCronExpression("* * 0 * *")).toThrow();
    expect(() => parseCronExpression("* * * 13 *")).toThrow();
    expect(() => parseCronExpression("* * * * 7")).toThrow();
  });

  test("rejects invalid range", () => {
    expect(() => parseCronExpression("5-2 * * * *")).toThrow("Invalid range");
  });

  test("rejects invalid step", () => {
    expect(() => parseCronExpression("*/0 * * * *")).toThrow(
      "Invalid step value"
    );
  });
});

// ── nextRunAfter ────────────────────────────────────────────────────────────

describe("nextRunAfter", () => {
  test("finds next run for every-6-hours schedule", () => {
    const schedule = parseCronExpression("0 */6 * * *");
    // After 2026-04-11 01:00 UTC → next is 06:00
    const after = new Date("2026-04-11T01:00:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2026-04-11T06:00:00.000Z");
  });

  test("finds next run for daily-at-2am schedule", () => {
    const schedule = parseCronExpression("0 2 * * *");
    // After 2026-04-11 03:00 UTC → next is 2026-04-12 02:00
    const after = new Date("2026-04-11T03:00:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2026-04-12T02:00:00.000Z");
  });

  test("finds next run for weekly Monday schedule", () => {
    const schedule = parseCronExpression("0 0 * * 1");
    // 2026-04-11 is a Saturday → next Monday is 2026-04-13
    const after = new Date("2026-04-11T00:00:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2026-04-13T00:00:00.000Z");
  });

  test("finds next run for weekly Sunday-at-3am schedule", () => {
    const schedule = parseCronExpression("0 3 * * 0");
    // 2026-04-11 is Saturday → next Sunday is 2026-04-12
    const after = new Date("2026-04-11T00:00:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2026-04-12T03:00:00.000Z");
  });

  test("advances past the current minute", () => {
    const schedule = parseCronExpression("0 */6 * * *");
    // Exactly on the scheduled time — should advance to next occurrence
    const after = new Date("2026-04-11T06:00:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2026-04-11T12:00:00.000Z");
  });

  test("handles midnight crossing", () => {
    const schedule = parseCronExpression("0 2 * * *");
    // After 23:00 → next is 02:00 the next day
    const after = new Date("2026-04-11T23:00:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2026-04-12T02:00:00.000Z");
  });

  test("handles month boundary crossing", () => {
    const schedule = parseCronExpression("0 0 1 * *");
    // After 2026-04-15 → next is 2026-05-01
    const after = new Date("2026-04-15T00:00:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  test("handles year boundary crossing", () => {
    const schedule = parseCronExpression("0 0 1 1 *");
    // After 2026-03-01 → next is 2027-01-01
    const after = new Date("2026-03-01T00:00:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  test("every-minute schedule returns next minute", () => {
    const schedule = parseCronExpression("* * * * *");
    const after = new Date("2026-04-11T12:34:00.000Z");
    const next = nextRunAfter(schedule, after);
    expect(next.toISOString()).toBe("2026-04-11T12:35:00.000Z");
  });
});

// ── isInCurrentPeriod ───────────────────────────────────────────────────────

describe("isInCurrentPeriod", () => {
  test("returns true when task ran and next run is still future", () => {
    const schedule = parseCronExpression("0 */6 * * *");
    // Ran at 06:00, now 07:00 — next run is 12:00, still in current period
    const lastRun = new Date("2026-04-11T06:00:00.000Z");
    const now = new Date("2026-04-11T07:00:00.000Z");
    expect(isInCurrentPeriod(schedule, lastRun, now)).toBe(true);
  });

  test("returns false when next period has started", () => {
    const schedule = parseCronExpression("0 */6 * * *");
    // Ran at 06:00, now 13:00 — next run was 12:00, already past
    const lastRun = new Date("2026-04-11T06:00:00.000Z");
    const now = new Date("2026-04-11T13:00:00.000Z");
    expect(isInCurrentPeriod(schedule, lastRun, now)).toBe(false);
  });

  test("returns true immediately after run", () => {
    const schedule = parseCronExpression("0 2 * * *");
    // Ran at 02:00, now 02:01 — next run is tomorrow 02:00
    const lastRun = new Date("2026-04-11T02:00:00.000Z");
    const now = new Date("2026-04-11T02:01:00.000Z");
    expect(isInCurrentPeriod(schedule, lastRun, now)).toBe(true);
  });

  test("returns false a full day after daily task", () => {
    const schedule = parseCronExpression("0 2 * * *");
    // Ran at 02:00, now 03:00 next day — past the next scheduled run
    const lastRun = new Date("2026-04-11T02:00:00.000Z");
    const now = new Date("2026-04-12T03:00:00.000Z");
    expect(isInCurrentPeriod(schedule, lastRun, now)).toBe(false);
  });
});
