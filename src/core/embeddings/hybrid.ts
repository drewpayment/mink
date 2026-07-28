// Rank fusion for hybrid retrieval (spec 25). Reciprocal Rank Fusion (RRF)
// combines several ranked lists into one without needing the underlying scores
// to be comparable — ideal for fusing FTS5 bm25 ranks with cosine-similarity
// ranks, which live on different scales. Pure and deterministic.
//
// RRF score for an item = Σ over lists 1 / (k + rank), where rank is 0-based
// within a list. k dampens the weight of low ranks; 60 is the value from the
// original Cormack et al. paper and a robust default.

export interface FusedRef {
  refId: string;
  score: number;
}

export function reciprocalRankFusion(lists: string[][], k = 60): FusedRef[] {
  const scores = new Map<string, number>();
  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const refId = list[rank];
      scores.set(refId, (scores.get(refId) ?? 0) + 1 / (k + rank + 1));
    }
  }
  return [...scores.entries()]
    .map(([refId, score]) => ({ refId, score }))
    // Stable tie-break by refId so fused order is deterministic.
    .sort((a, b) => b.score - a.score || (a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0));
}
