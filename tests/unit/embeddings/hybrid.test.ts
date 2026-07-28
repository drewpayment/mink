import { describe, expect, test } from "bun:test";
import { reciprocalRankFusion } from "../../../src/core/embeddings/hybrid";

describe("reciprocalRankFusion", () => {
  test("an item ranked in both lists beats items in only one", () => {
    const fused = reciprocalRankFusion([
      ["a", "b", "c"],
      ["b", "d", "e"],
    ]);
    // b appears in both → highest fused score.
    expect(fused[0].refId).toBe("b");
  });

  test("preserves within-list order when only one list has the items", () => {
    const fused = reciprocalRankFusion([["a", "b", "c"]]);
    expect(fused.map((f) => f.refId)).toEqual(["a", "b", "c"]);
  });

  test("returns the union of all refs", () => {
    const fused = reciprocalRankFusion([["a"], ["b"], ["c"]]);
    expect(new Set(fused.map((f) => f.refId))).toEqual(new Set(["a", "b", "c"]));
  });

  test("empty input → empty output", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  test("deterministic tie-break by refId", () => {
    // Same single-list rank for both → tie broken alphabetically.
    const fused = reciprocalRankFusion([["b"], ["a"]]);
    expect(fused.map((f) => f.refId)).toEqual(["a", "b"]);
  });

  test("smaller k sharpens the rank-1 advantage", () => {
    const withSmallK = reciprocalRankFusion([["a", "b"]], 1);
    // 1/(1+1)=0.5 vs 1/(1+2)=0.333
    expect(withSmallK[0].score).toBeGreaterThan(withSmallK[1].score);
  });
});
