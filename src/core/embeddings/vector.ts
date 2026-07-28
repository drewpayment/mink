// Pure vector math for semantic retrieval (spec 25).
//
// Dependency-free and deterministic: normalization, cosine similarity, and a
// portable little-endian Float32 <-> bytes codec for storing vectors as SQLite
// BLOBs. No model, no I/O — exhaustively unit-testable in isolation.

/** L2-normalize a vector. A zero vector is returned as a fresh zero copy. */
export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const norm = Math.sqrt(sum);
  const out = new Float32Array(v.length);
  if (norm === 0) return out;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/**
 * Cosine similarity in [-1, 1]. Returns 0 when either vector is zero or the
 * lengths differ (defensive: a dimension mismatch is treated as "no signal"
 * rather than throwing on the recall path).
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Serialize a vector to little-endian Float32 bytes for BLOB storage. */
export function serializeVector(v: Float32Array): Uint8Array {
  const bytes = new Uint8Array(v.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < v.length; i++) view.setFloat32(i * 4, v[i], true);
  return bytes;
}

/** Deserialize little-endian Float32 bytes back into a vector. */
export function deserializeVector(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = Math.floor(bytes.byteLength / 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true);
  return out;
}
