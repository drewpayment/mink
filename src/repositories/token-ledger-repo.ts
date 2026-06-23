// Token-ledger repository. Sessions + reads + writes + per-device lifetime
// counters all live in mink.db. The legacy archive file is subsumed by the
// `archived` column on ledger_sessions — "archive" becomes
// `UPDATE ledger_sessions SET archived = 1 WHERE ...`.
//
// Sessions are insert-only from the perspective of the merge driver
// (first-writer-wins keyed on session_id). The only post-insert mutations
// allowed are:
//   - updateSession(): replaces totals/lists for the latest session before
//     it's been seen by any other device — the in-process device knows
//     its own session_id is exclusive until session_stop persists it.
//   - archive(): flips `archived = 1` once the active-session count
//     exceeds the retention threshold.
//
// Lifetime counters are also per-device; the merge driver MAX-merges them
// across shards so concurrent activity on different devices keeps the
// project-wide total monotonic.

import type { DbDriver } from "../storage/driver";
import type {
  TokenLedger,
  LedgerSession,
  LifetimeCounters,
  CompressionEvent,
  CompressionEventInput,
  CompressionLifetime,
  CompressionArms,
  CompressionBreakdownRow,
} from "../types/token-ledger";
import type { SessionSummary } from "../types/session";
import type { WasteFlag, WastePattern } from "../types/waste-detection";
import { openProjectDb } from "../storage/db";
import { getOrCreateDeviceId } from "../core/device";

function emptyLifetime(): LifetimeCounters {
  return {
    totalTokens: 0,
    totalReads: 0,
    totalWrites: 0,
    totalSessions: 0,
    totalFileIndexHits: 0,
    totalFileIndexMisses: 0,
    totalRepeatedReads: 0,
    totalEstimatedSavings: 0,
  };
}

export class TokenLedgerRepo {
  constructor(private readonly db: DbDriver) {}

  static for(cwd: string): TokenLedgerRepo {
    return new TokenLedgerRepo(openProjectDb(cwd));
  }

  // ── Append / update sessions ──────────────────────────────────────────

  // Insert a session as the active (archived = 0) ledger entry, append its
  // reads/writes, and bump this device's lifetime counters. Wrapped in a
  // transaction so a partial write never leaves the lifetime out of sync
  // with the per-session rows.
  appendSession(summary: SessionSummary, deviceId: string = getOrCreateDeviceId()): void {
    this.db.transaction(() => {
      this.insertSessionRow(summary, deviceId, 0);
      this.appendChildRows(summary);
      this.addToLifetime(deviceId, summary);
    });
  }

  // Replace a previously-inserted active session. Used when a session is
  // stopped multiple times — only the last stop's totals are authoritative
  // for this device, so we subtract the old contribution and add the new.
  // We don't allow updating an archived session (the merge driver assumes
  // archived rows are immutable).
  updateSession(summary: SessionSummary, deviceId: string = getOrCreateDeviceId()): void {
    this.db.transaction(() => {
      const existing = this.fetchSession(summary.sessionId);
      if (!existing) {
        this.insertSessionRow(summary, deviceId, 0);
        this.appendChildRows(summary);
        this.addToLifetime(deviceId, summary);
        return;
      }
      this.subtractFromLifetime(existing.device_id, existing);
      this.db.prepare(
        "DELETE FROM ledger_reads  WHERE session_id = ?"
      ).run(summary.sessionId);
      this.db.prepare(
        "DELETE FROM ledger_writes WHERE session_id = ?"
      ).run(summary.sessionId);
      this.db.prepare(`
        UPDATE ledger_sessions SET
          start_timestamp     = ?,
          end_timestamp       = ?,
          read_count          = ?,
          write_count         = ?,
          estimated_tokens    = ?,
          repeated_reads      = ?,
          file_index_hits     = ?,
          file_index_misses   = ?,
          estimated_savings   = ?
        WHERE session_id = ?
      `).run(
        summary.startTimestamp, summary.endTimestamp,
        summary.totals.readCount, summary.totals.writeCount,
        summary.totals.estimatedTokens, summary.totals.repeatedReads,
        summary.totals.fileIndexHits, summary.totals.fileIndexMisses,
        summary.estimatedSavings, summary.sessionId
      );
      this.appendChildRows(summary);
      this.addToLifetime(existing.device_id, summary);
    });
  }

  // Archive everything past the retention threshold. Returns the number of
  // sessions newly archived. We sort by start_timestamp ASC and flip the
  // oldest ones so the most recent N stay active — same intent as the v1
  // JSON archive flow.
  archive(threshold: number = 1000): number {
    if (threshold <= 0) return 0;
    const active = Number(
      (this.db.prepare(
        "SELECT COUNT(*) AS n FROM ledger_sessions WHERE archived = 0"
      ).get() as { n: number }).n
    );
    if (active <= threshold) return 0;
    const excess = active - threshold;
    const r = this.db.prepare(`
      UPDATE ledger_sessions SET archived = 1
      WHERE session_id IN (
        SELECT session_id FROM ledger_sessions
        WHERE archived = 0
        ORDER BY start_timestamp ASC
        LIMIT ?
      )
    `).run(excess);
    return Number(r.changes);
  }

  // ── Read ──────────────────────────────────────────────────────────────

  lifetime(): LifetimeCounters {
    // Sum across every device's row — gives the project-wide total.
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_tokens),             0) AS totalTokens,
        COALESCE(SUM(total_reads),              0) AS totalReads,
        COALESCE(SUM(total_writes),             0) AS totalWrites,
        COALESCE(SUM(total_sessions),           0) AS totalSessions,
        COALESCE(SUM(total_file_index_hits),    0) AS totalFileIndexHits,
        COALESCE(SUM(total_file_index_misses),  0) AS totalFileIndexMisses,
        COALESCE(SUM(total_repeated_reads),     0) AS totalRepeatedReads,
        COALESCE(SUM(total_estimated_savings),  0) AS totalEstimatedSavings
      FROM ledger_lifetime
    `).get();
    if (!row) return emptyLifetime();
    const r = row as Record<string, number>;
    return {
      totalTokens:             Number(r.totalTokens),
      totalReads:              Number(r.totalReads),
      totalWrites:             Number(r.totalWrites),
      totalSessions:           Number(r.totalSessions),
      totalFileIndexHits:      Number(r.totalFileIndexHits),
      totalFileIndexMisses:    Number(r.totalFileIndexMisses),
      totalRepeatedReads:      Number(r.totalRepeatedReads),
      totalEstimatedSavings:   Number(r.totalEstimatedSavings),
    };
  }

  // All active (archived = 0) sessions, hydrated with their reads + writes.
  // Sorted by start_timestamp to match the JSON aggregator's ordering.
  activeSessions(): LedgerSession[] {
    return this.hydrateSessions(
      "SELECT * FROM ledger_sessions WHERE archived = 0 ORDER BY start_timestamp"
    );
  }

  archivedSessions(): LedgerSession[] {
    return this.hydrateSessions(
      "SELECT * FROM ledger_sessions WHERE archived = 1 ORDER BY start_timestamp"
    );
  }

  // Project-wide snapshot in the legacy TokenLedger shape — used by the
  // dashboard, status, and detect-waste. wasteFlags are pulled from
  // waste_flags and deduped by (pattern, detected_at).
  snapshot(): TokenLedger {
    const ledger: TokenLedger = {
      lifetime: this.lifetime(),
      sessions: this.activeSessions(),
      compression: this.compressionLifetime(),
    };
    const flagRows = this.db
      .prepare(
        "SELECT pattern, detected_at, details FROM waste_flags ORDER BY detected_at"
      )
      .all();
    if (flagRows.length > 0) {
      ledger.wasteFlags = flagRows.map((r) => {
        const row = r as { pattern: string; detected_at: string; details: string | null };
        const flag: WasteFlag = {
          pattern: row.pattern as WastePattern,
          detectedAt: row.detected_at,
          description: "",
          estimatedTokensWasted: 0,
          suggestion: "",
        };
        if (row.details) {
          try {
            const parsed = JSON.parse(row.details) as Partial<WasteFlag>;
            Object.assign(flag, parsed);
          } catch {
            // ignore bad JSON — keep base flag
          }
        }
        return flag;
      });
    }
    return ledger;
  }

  // Replace all waste_flags rows for THIS device with the provided set.
  // detect-waste re-runs and overwrites every cycle, so we don't try to
  // merge with previous flags.
  replaceWasteFlagsForDevice(
    deviceId: string,
    flags: NonNullable<TokenLedger["wasteFlags"]>
  ): void {
    this.db.transaction(() => {
      this.db.prepare(
        "DELETE FROM waste_flags WHERE device_id = ?"
      ).run(deviceId);
      const stmt = this.db.prepare(
        "INSERT OR REPLACE INTO waste_flags (pattern, detected_at, details, device_id) VALUES (?, ?, ?, ?)"
      );
      for (const flag of flags) {
        const { pattern, detectedAt, ...rest } = flag;
        stmt.run(pattern, detectedAt, JSON.stringify(rest), deviceId);
      }
    });
  }

  // ── Compression measurement (spec 22) ────────────────────────────────

  // Record one compression decision and fold it into this device's
  // compression-lifetime aggregates, transactionally so the row and the
  // aggregate never drift. measured savings credits compressed arms only —
  // a holdout arm saves nothing by construction.
  recordCompression(
    event: CompressionEventInput,
    deviceId: string = getOrCreateDeviceId()
  ): void {
    const id = event.id ?? crypto.randomUUID();
    const createdAt = event.createdAt ?? new Date().toISOString();
    const holdout = event.holdout ? 1 : 0;
    const savings = event.holdout
      ? 0
      : Math.max(0, event.originalTokens - event.compressedTokens);
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT OR REPLACE INTO ledger_compressions
          (id, created_at, tool_name, content_kind,
           original_tokens, compressed_tokens, holdout, device_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, createdAt, event.toolName, event.contentKind,
        event.originalTokens, event.compressedTokens, holdout, deviceId
      );
      this.db.prepare(`
        INSERT INTO ledger_compression_lifetime
          (device_id, total_events, total_holdout_events,
           total_original_tokens, total_compressed_tokens, total_measured_savings)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          total_events            = ledger_compression_lifetime.total_events            + excluded.total_events,
          total_holdout_events    = ledger_compression_lifetime.total_holdout_events    + excluded.total_holdout_events,
          total_original_tokens   = ledger_compression_lifetime.total_original_tokens   + excluded.total_original_tokens,
          total_compressed_tokens = ledger_compression_lifetime.total_compressed_tokens + excluded.total_compressed_tokens,
          total_measured_savings  = ledger_compression_lifetime.total_measured_savings  + excluded.total_measured_savings
      `).run(
        deviceId, 1, holdout,
        event.originalTokens, event.compressedTokens, savings
      );
    });
  }

  // Project-wide compression aggregates — summed across every device's row.
  compressionLifetime(): CompressionLifetime {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_events),            0) AS totalEvents,
        COALESCE(SUM(total_holdout_events),    0) AS totalHoldoutEvents,
        COALESCE(SUM(total_original_tokens),   0) AS totalOriginalTokens,
        COALESCE(SUM(total_compressed_tokens), 0) AS totalCompressedTokens,
        COALESCE(SUM(total_measured_savings),  0) AS totalMeasuredSavings
      FROM ledger_compression_lifetime
    `).get() as Record<string, number> | undefined;
    return {
      totalEvents:           Number(row?.totalEvents ?? 0),
      totalHoldoutEvents:    Number(row?.totalHoldoutEvents ?? 0),
      totalOriginalTokens:   Number(row?.totalOriginalTokens ?? 0),
      totalCompressedTokens: Number(row?.totalCompressedTokens ?? 0),
      totalMeasuredSavings:  Number(row?.totalMeasuredSavings ?? 0),
    };
  }

  // Recent compression events, newest first. Primarily for inspection/tests.
  compressionEvents(limit = 100): CompressionEvent[] {
    const rows = this.db.prepare(`
      SELECT id, created_at, tool_name, content_kind,
             original_tokens, compressed_tokens, holdout
      FROM ledger_compressions
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id:               String(r.id),
      createdAt:        String(r.created_at),
      toolName:         String(r.tool_name),
      contentKind:      String(r.content_kind),
      originalTokens:   Number(r.original_tokens),
      compressedTokens: Number(r.compressed_tokens),
      holdout:          Number(r.holdout) === 1,
    }));
  }

  // Compression split by arm (holdout A/B). Compressed-arm carries the savings
  // story; the holdout arm records the originals we deliberately left
  // uncompressed as a control.
  compressionArms(): CompressionArms {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN holdout = 0 THEN 1 END),                 0) AS cEvents,
        COALESCE(SUM(CASE WHEN holdout = 0 THEN original_tokens END),   0) AS cOriginal,
        COALESCE(SUM(CASE WHEN holdout = 0 THEN compressed_tokens END), 0) AS cCompressed,
        COALESCE(SUM(CASE WHEN holdout = 1 THEN 1 END),                 0) AS hEvents,
        COALESCE(SUM(CASE WHEN holdout = 1 THEN original_tokens END),   0) AS hOriginal
      FROM ledger_compressions
    `).get() as Record<string, number> | undefined;
    return {
      compressed: {
        events:          Number(row?.cEvents ?? 0),
        originalTokens:  Number(row?.cOriginal ?? 0),
        compressedTokens: Number(row?.cCompressed ?? 0),
      },
      holdout: {
        events:         Number(row?.hEvents ?? 0),
        originalTokens: Number(row?.hOriginal ?? 0),
      },
    };
  }

  // Compression aggregates grouped by a dimension (content_kind or tool_name),
  // ordered by measured savings. `savings` credits compressed arms only, so the
  // breakdown reflects realised reductions, not held-out controls.
  compressionBreakdown(
    dimension: "content_kind" | "tool_name"
  ): CompressionBreakdownRow[] {
    const rows = this.db.prepare(`
      SELECT
        ${dimension} AS key,
        COUNT(*) AS events,
        COALESCE(SUM(original_tokens),   0) AS originalTokens,
        COALESCE(SUM(compressed_tokens), 0) AS compressedTokens,
        COALESCE(SUM(CASE WHEN holdout = 0 THEN original_tokens - compressed_tokens END), 0) AS savings
      FROM ledger_compressions
      GROUP BY ${dimension}
      ORDER BY savings DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      key:              String(r.key),
      events:           Number(r.events),
      originalTokens:   Number(r.originalTokens),
      compressedTokens: Number(r.compressedTokens),
      savings:          Number(r.savings),
    }));
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private insertSessionRow(
    summary: SessionSummary,
    deviceId: string,
    archived: 0 | 1
  ): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO ledger_sessions
        (session_id, device_id, start_timestamp, end_timestamp,
         read_count, write_count, estimated_tokens, repeated_reads,
         file_index_hits, file_index_misses, estimated_savings, archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      summary.sessionId, deviceId,
      summary.startTimestamp, summary.endTimestamp,
      summary.totals.readCount, summary.totals.writeCount,
      summary.totals.estimatedTokens, summary.totals.repeatedReads,
      summary.totals.fileIndexHits, summary.totals.fileIndexMisses,
      summary.estimatedSavings, archived
    );
  }

  private appendChildRows(summary: SessionSummary): void {
    const insertRead = this.db.prepare(
      "INSERT INTO ledger_reads (session_id, file_path, estimated_tokens, read_count) VALUES (?, ?, ?, ?)"
    );
    for (const r of summary.reads ?? []) {
      insertRead.run(summary.sessionId, r.filePath, r.estimatedTokens, r.readCount);
    }
    const insertWrite = this.db.prepare(
      "INSERT INTO ledger_writes (session_id, file_path, estimated_tokens, action) VALUES (?, ?, ?, ?)"
    );
    for (const w of summary.writes ?? []) {
      insertWrite.run(summary.sessionId, w.filePath, w.estimatedTokens, w.action);
    }
  }

  private addToLifetime(deviceId: string, summary: SessionSummary): void {
    this.adjustLifetime(deviceId, summary, +1);
  }

  private subtractFromLifetime(
    deviceId: string,
    existing: { estimated_tokens: number; read_count: number; write_count: number; file_index_hits: number; file_index_misses: number; repeated_reads: number; estimated_savings: number }
  ): void {
    // Reconstruct a SessionSummary-shaped delta from the stored row.
    const synthetic: SessionSummary = {
      sessionId: "",
      startTimestamp: "",
      endTimestamp: "",
      reads: [],
      writes: [],
      totals: {
        readCount: existing.read_count,
        writeCount: existing.write_count,
        estimatedTokens: existing.estimated_tokens,
        repeatedReads: existing.repeated_reads,
        fileIndexHits: existing.file_index_hits,
        fileIndexMisses: existing.file_index_misses,
      },
      estimatedSavings: existing.estimated_savings,
    };
    this.adjustLifetime(deviceId, synthetic, -1);
  }

  private adjustLifetime(
    deviceId: string,
    summary: SessionSummary,
    sign: 1 | -1
  ): void {
    const s = sign;
    this.db.prepare(`
      INSERT INTO ledger_lifetime
        (device_id, total_tokens, total_reads, total_writes, total_sessions,
         total_file_index_hits, total_file_index_misses, total_repeated_reads,
         total_estimated_savings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET
        total_tokens             = ledger_lifetime.total_tokens             + excluded.total_tokens,
        total_reads              = ledger_lifetime.total_reads              + excluded.total_reads,
        total_writes             = ledger_lifetime.total_writes             + excluded.total_writes,
        total_sessions           = ledger_lifetime.total_sessions           + excluded.total_sessions,
        total_file_index_hits    = ledger_lifetime.total_file_index_hits    + excluded.total_file_index_hits,
        total_file_index_misses  = ledger_lifetime.total_file_index_misses  + excluded.total_file_index_misses,
        total_repeated_reads     = ledger_lifetime.total_repeated_reads     + excluded.total_repeated_reads,
        total_estimated_savings  = ledger_lifetime.total_estimated_savings  + excluded.total_estimated_savings
    `).run(
      deviceId,
      s * summary.totals.estimatedTokens,
      s * summary.totals.readCount,
      s * summary.totals.writeCount,
      s * 1,
      s * summary.totals.fileIndexHits,
      s * summary.totals.fileIndexMisses,
      s * summary.totals.repeatedReads,
      s * summary.estimatedSavings
    );
  }

  private fetchSession(sessionId: string): {
    session_id: string;
    device_id: string;
    estimated_tokens: number;
    read_count: number;
    write_count: number;
    file_index_hits: number;
    file_index_misses: number;
    repeated_reads: number;
    estimated_savings: number;
  } | null {
    const row = this.db
      .prepare("SELECT * FROM ledger_sessions WHERE session_id = ?")
      .get(sessionId);
    if (!row) return null;
    return row as never;
  }

  private hydrateSessions(sql: string): LedgerSession[] {
    const rows = this.db.prepare(sql).all() as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];
    const ids = rows.map((r) => String(r.session_id));
    const readsBySession = this.groupChildren(
      "SELECT session_id, file_path, estimated_tokens, read_count FROM ledger_reads WHERE session_id IN (" +
        ids.map(() => "?").join(",") + ")",
      ids
    );
    const writesBySession = this.groupChildren(
      "SELECT session_id, file_path, estimated_tokens, action FROM ledger_writes WHERE session_id IN (" +
        ids.map(() => "?").join(",") + ")",
      ids
    );
    return rows.map((r) => {
      const sid = String(r.session_id);
      return {
        sessionId: sid,
        startTimestamp: String(r.start_timestamp),
        endTimestamp: String(r.end_timestamp),
        reads: (readsBySession.get(sid) ?? []).map((x) => ({
          filePath: String(x.file_path),
          estimatedTokens: Number(x.estimated_tokens),
          readCount: Number(x.read_count),
        })),
        writes: (writesBySession.get(sid) ?? []).map((x) => ({
          filePath: String(x.file_path),
          estimatedTokens: Number(x.estimated_tokens),
          action: x.action as "create" | "edit",
        })),
        totals: {
          readCount:        Number(r.read_count),
          writeCount:       Number(r.write_count),
          estimatedTokens:  Number(r.estimated_tokens),
          repeatedReads:    Number(r.repeated_reads),
          fileIndexHits:    Number(r.file_index_hits),
          fileIndexMisses:  Number(r.file_index_misses),
        },
        estimatedSavings: Number(r.estimated_savings),
      };
    });
  }

  private groupChildren(sql: string, ids: string[]): Map<string, Array<Record<string, unknown>>> {
    const out = new Map<string, Array<Record<string, unknown>>>();
    if (ids.length === 0) return out;
    const rows = this.db.prepare(sql).all(...ids) as Array<Record<string, unknown>>;
    for (const r of rows) {
      const sid = String(r.session_id);
      let list = out.get(sid);
      if (!list) {
        list = [];
        out.set(sid, list);
      }
      list.push(r);
    }
    return out;
  }
}
