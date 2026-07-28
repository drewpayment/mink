// Vector store for semantic retrieval (spec 25). One row per (kind, ref, model)
// holding an L2-normalized embedding as a little-endian Float32 BLOB, plus a
// content hash so stale rows (source text changed, or a different model) can be
// detected and re-embedded.
//
// Search is exact brute-force cosine over the candidate set for a (kind, model)
// pair. At Mink's per-project scale (hundreds to low-thousands of rows) this is
// well under the hook budget and avoids a native ANN/sqlite-vec dependency; a
// vector index is a future optimization behind this same interface.

import { createHash } from "crypto";
import type { DbDriver } from "../storage/driver";
import { openProjectDb, openProjectDbForDir } from "../storage/db";
import { getOrCreateDeviceId } from "../core/device";
import { cosine, deserializeVector, serializeVector } from "../core/embeddings/vector";

export type EmbeddingKind = "bug" | "learning" | "note";

export interface EmbeddingInput {
  kind: EmbeddingKind;
  refId: string;
  model: string;
  contentHash: string;
  vector: Float32Array;
  now?: Date;
}

export interface EmbeddingHit {
  refId: string;
  score: number;
}

/** Stable content hash used to detect when a row needs re-embedding. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export class EmbeddingRepo {
  constructor(private readonly db: DbDriver) {}

  static for(cwd: string): EmbeddingRepo {
    return new EmbeddingRepo(openProjectDb(cwd));
  }

  /** Open another project's store by its on-disk dir; null if it has no DB. */
  static forDir(projDir: string): EmbeddingRepo | null {
    const db = openProjectDbForDir(projDir);
    return db ? new EmbeddingRepo(db) : null;
  }

  upsert(input: EmbeddingInput, deviceId: string = getOrCreateDeviceId()): void {
    const now = (input.now ?? new Date()).toISOString();
    const bytes = serializeVector(input.vector);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO embeddings
           (kind, ref_id, model, dim, vector, content_hash, created_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.kind,
        input.refId,
        input.model,
        input.vector.length,
        bytes,
        input.contentHash,
        now,
        deviceId
      );
  }

  /** True when an up-to-date vector already exists for this ref + model + text. */
  hasFresh(kind: EmbeddingKind, refId: string, model: string, contentHash: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM embeddings WHERE kind = ? AND ref_id = ? AND model = ? AND content_hash = ?"
      )
      .get(kind, refId, model, contentHash);
    return row !== undefined;
  }

  /**
   * Brute-force cosine search over all vectors for a (kind, model) pair.
   * Returns the top-k refs with score ≥ minScore, highest first.
   */
  search(
    kind: EmbeddingKind,
    model: string,
    queryVector: Float32Array,
    k: number,
    minScore = 0
  ): EmbeddingHit[] {
    const rows = this.db
      .prepare("SELECT ref_id, vector FROM embeddings WHERE kind = ? AND model = ?")
      .all(kind, model) as Array<{ ref_id: string; vector: Uint8Array }>;

    const hits: EmbeddingHit[] = [];
    for (const row of rows) {
      const vec = deserializeVector(toUint8(row.vector));
      const score = cosine(queryVector, vec);
      if (score >= minScore) hits.push({ refId: String(row.ref_id), score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  countForModel(kind: EmbeddingKind, model: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS c FROM embeddings WHERE kind = ? AND model = ?")
      .get(kind, model) as { c: number } | undefined;
    return row ? Number(row.c) : 0;
  }

  deleteForRef(kind: EmbeddingKind, refId: string): void {
    this.db.prepare("DELETE FROM embeddings WHERE kind = ? AND ref_id = ?").run(kind, refId);
  }
}

// SQLite drivers hand back BLOBs as Uint8Array or Buffer depending on runtime;
// normalize to a Uint8Array view before decoding.
function toUint8(v: Uint8Array | ArrayBuffer | { buffer: ArrayBuffer }): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return new Uint8Array((v as { buffer: ArrayBuffer }).buffer);
}
