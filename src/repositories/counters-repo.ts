// Per-device hit/miss counters for the file index. Replaces the legacy
// `.mink-state-counters.json` file (read by the dashboard and by
// `mink status`) with a SQLite-backed table that's queryable per device
// or aggregated across all devices in a single SQL statement.

import type { DbDriver } from "../storage/driver";
import { openProjectDb } from "../storage/db";
import { getOrCreateDeviceId } from "../core/device";

const INCREMENT_HIT = `
  INSERT INTO counters (device_id, file_index_hits, file_index_misses)
  VALUES (?, 1, 0)
  ON CONFLICT(device_id) DO UPDATE SET
    file_index_hits = counters.file_index_hits + 1
`;

const INCREMENT_MISS = `
  INSERT INTO counters (device_id, file_index_hits, file_index_misses)
  VALUES (?, 0, 1)
  ON CONFLICT(device_id) DO UPDATE SET
    file_index_misses = counters.file_index_misses + 1
`;

export class CountersRepo {
  constructor(private readonly db: DbDriver) {}

  static for(cwd: string): CountersRepo {
    return new CountersRepo(openProjectDb(cwd));
  }

  incrementHit(deviceId: string = getOrCreateDeviceId()): void {
    this.db.prepare(INCREMENT_HIT).run(deviceId);
  }

  incrementMiss(deviceId: string = getOrCreateDeviceId()): void {
    this.db.prepare(INCREMENT_MISS).run(deviceId);
  }

  // Returns this device's hit + miss counts (zero for either if no row
  // exists yet). The dashboard and `mink status` show per-device totals,
  // but callers that want a project-wide view use totals().
  forDevice(deviceId: string = getOrCreateDeviceId()): { hits: number; misses: number } {
    const row = this.db
      .prepare(
        "SELECT file_index_hits, file_index_misses FROM counters WHERE device_id = ?"
      )
      .get(deviceId);
    if (!row) return { hits: 0, misses: 0 };
    return {
      hits: Number((row as { file_index_hits: number }).file_index_hits),
      misses: Number((row as { file_index_misses: number }).file_index_misses),
    };
  }

  totals(): { hits: number; misses: number } {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(file_index_hits), 0) AS h, COALESCE(SUM(file_index_misses), 0) AS m FROM counters"
      )
      .get();
    if (!row) return { hits: 0, misses: 0 };
    return {
      hits: Number((row as { h: number }).h),
      misses: Number((row as { m: number }).m),
    };
  }

  perDevice(): Record<string, { hits: number; misses: number }> {
    const rows = this.db
      .prepare(
        "SELECT device_id, file_index_hits, file_index_misses FROM counters"
      )
      .all();
    const out: Record<string, { hits: number; misses: number }> = {};
    for (const r of rows) {
      const row = r as {
        device_id: string;
        file_index_hits: number;
        file_index_misses: number;
      };
      out[row.device_id] = {
        hits: Number(row.file_index_hits),
        misses: Number(row.file_index_misses),
      };
    }
    return out;
  }
}
