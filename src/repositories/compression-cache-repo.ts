// Reversible-compression cache repository (spec 22 §Reversibility). Stores the
// byte-exact original of a compressed tool output keyed by a short retrieval
// token, with a TTL. `get` treats an expired row as a miss and evicts it lazily,
// so a stale token can never return partial or wrong content.
//
// This is a local cache — it is never injected into model context and is not
// part of the cross-device sync surface. device_id is recorded for audit only.

import { randomUUID } from "crypto";
import type { DbDriver } from "../storage/driver";
import type { CompressionCacheEntry, ContentKind } from "../types/compression";
import { openProjectDb } from "../storage/db";
import { getOrCreateDeviceId } from "../core/device";

export interface StoreInput {
  toolName: string;
  contentKind: ContentKind;
  content: string;
  retentionHours: number;
  token?: string;
  now?: Date;
}

export class CompressionCacheRepo {
  constructor(private readonly db: DbDriver) {}

  static for(cwd: string): CompressionCacheRepo {
    return new CompressionCacheRepo(openProjectDb(cwd));
  }

  // Short, unambiguous token the model can paste into `mink retrieve`.
  static newToken(): string {
    return `mc-${randomUUID().slice(0, 8)}`;
  }

  // Store an original and return its retrieval token.
  store(input: StoreInput, deviceId: string = getOrCreateDeviceId()): string {
    const token = input.token ?? CompressionCacheRepo.newToken();
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const expiresAt = new Date(
      now.getTime() + Math.max(0, input.retentionHours) * 3_600_000
    ).toISOString();
    this.db.prepare(`
      INSERT OR REPLACE INTO compression_cache
        (token, created_at, expires_at, tool_name, content_kind,
         content, size_bytes, device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      token, createdAt, expiresAt, input.toolName, input.contentKind,
      input.content, Buffer.byteLength(input.content, "utf-8"), deviceId
    );
    return token;
  }

  // Return the stored original, or null if the token is unknown or expired.
  // An expired row is deleted on the way out (lazy eviction).
  get(token: string, now: Date = new Date()): CompressionCacheEntry | null {
    const row = this.db
      .prepare("SELECT * FROM compression_cache WHERE token = ?")
      .get(token) as Record<string, unknown> | undefined;
    if (!row) return null;
    const expiresAt = String(row.expires_at);
    if (expiresAt <= now.toISOString()) {
      try {
        this.db.prepare("DELETE FROM compression_cache WHERE token = ?").run(token);
      } catch {
        // best effort — a failed eviction still reports a miss below
      }
      return null;
    }
    return {
      token: String(row.token),
      createdAt: String(row.created_at),
      expiresAt,
      toolName: String(row.tool_name),
      contentKind: String(row.content_kind) as ContentKind,
      content: String(row.content),
      sizeBytes: Number(row.size_bytes),
    };
  }

  // Delete every row whose TTL has elapsed. Returns the count removed.
  evictExpired(now: Date = new Date()): number {
    const r = this.db
      .prepare("DELETE FROM compression_cache WHERE expires_at <= ?")
      .run(now.toISOString());
    return Number(r.changes);
  }

  count(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM compression_cache")
      .get() as { n: number };
    return Number(row.n);
  }
}
