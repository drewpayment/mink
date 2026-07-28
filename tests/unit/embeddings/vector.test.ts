import { describe, expect, test } from "bun:test";
import {
  cosine,
  deserializeVector,
  l2normalize,
  serializeVector,
} from "../../../src/core/embeddings/vector";

const f = (...xs: number[]) => Float32Array.from(xs);

describe("l2normalize", () => {
  test("produces a unit vector", () => {
    const n = l2normalize(f(3, 4)); // |(3,4)| = 5
    expect(n[0]).toBeCloseTo(0.6, 6);
    expect(n[1]).toBeCloseTo(0.8, 6);
    expect(Math.hypot(n[0], n[1])).toBeCloseTo(1, 6);
  });

  test("a zero vector normalizes to zero (no NaN)", () => {
    const n = l2normalize(f(0, 0, 0));
    expect([...n]).toEqual([0, 0, 0]);
  });
});

describe("cosine", () => {
  test("identical vectors → 1", () => {
    expect(cosine(f(1, 2, 3), f(1, 2, 3))).toBeCloseTo(1, 6);
  });
  test("orthogonal vectors → 0", () => {
    expect(cosine(f(1, 0), f(0, 1))).toBeCloseTo(0, 6);
  });
  test("opposite vectors → -1", () => {
    expect(cosine(f(1, 1), f(-1, -1))).toBeCloseTo(-1, 6);
  });
  test("magnitude-invariant", () => {
    expect(cosine(f(1, 2, 3), f(10, 20, 30))).toBeCloseTo(1, 6);
  });
  test("zero vector → 0 (no divide-by-zero)", () => {
    expect(cosine(f(0, 0), f(1, 1))).toBe(0);
  });
  test("dimension mismatch → 0 (defensive)", () => {
    expect(cosine(f(1, 2), f(1, 2, 3))).toBe(0);
  });
});

describe("serialize/deserialize", () => {
  test("round-trips Float32 values exactly", () => {
    const v = f(0, 1, -1, 0.5, -0.25, 3.14159, 1e-6);
    const back = deserializeVector(serializeVector(v));
    expect(back.length).toBe(v.length);
    for (let i = 0; i < v.length; i++) {
      // Float32 precision: exact after the round-trip (both are f32).
      expect(back[i]).toBe(v[i]);
    }
  });

  test("byte length is 4 per element", () => {
    expect(serializeVector(f(1, 2, 3)).byteLength).toBe(12);
  });

  test("empty vector round-trips", () => {
    expect(deserializeVector(serializeVector(f())).length).toBe(0);
  });
});
