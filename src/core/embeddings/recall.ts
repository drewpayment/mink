// Hybrid bug recall (spec 25). Fuses the existing FTS5 lexical search with
// cosine search over stored embeddings, so a bug is found by meaning even when
// the query shares few words with it (the cross-project-transfer premise). When
// embeddings are disabled or unavailable, recall is exactly today's FTS5 result
// — no regression.

import { BugMemoryRepo } from "../../repositories/bug-memory-repo";
import { EmbeddingRepo, hashContent } from "../../repositories/embedding-repo";
import type { BugEntry, SimilarityMatch } from "../../types/bug-memory";
import {
  EmbeddingsUnavailableError,
  resolveEmbeddingProvider,
  type EmbeddingProvider,
} from "./provider";
import { reciprocalRankFusion } from "./hybrid";
import { l2normalize } from "./vector";

/** The text an embedding represents for a bug — error, cause, fix, and tags. */
export function bugText(b: BugEntry): string {
  return [b.errorMessage, b.rootCause, b.fixDescription, b.tags.join(" ")]
    .filter((s) => s && s.length > 0)
    .join("\n");
}

export interface RecallOptions {
  filePath?: string;
  limit?: number;
}

/**
 * Embed bugs that lack a current vector for the given provider's model.
 * Returns the number of bugs (re-)embedded. Best-effort at call sites: a thrown
 * EmbeddingsUnavailableError should be caught and ignored by writers.
 */
export async function embedBugs(
  cwd: string,
  provider: EmbeddingProvider,
  ids?: string[]
): Promise<number> {
  const repo = BugMemoryRepo.for(cwd);
  const store = EmbeddingRepo.for(cwd);

  const entries = ids
    ? ids.map((id) => repo.lookup(id)).filter((e): e is BugEntry => e !== null)
    : repo.listAll();

  const pending = entries
    .map((e) => ({ e, text: bugText(e), hash: "" }))
    .map((p) => ({ ...p, hash: hashContent(p.text) }))
    .filter((p) => !store.hasFresh("bug", p.e.id, provider.id, p.hash));

  if (pending.length === 0) return 0;

  const vectors = await provider.embed(pending.map((p) => p.text));
  for (let i = 0; i < pending.length; i++) {
    store.upsert({
      kind: "bug",
      refId: pending[i].e.id,
      model: provider.id,
      contentHash: pending[i].hash,
      vector: l2normalize(vectors[i]),
    });
  }
  return pending.length;
}

/**
 * Recall bugs relevant to a query. FTS5 always runs; when a provider is present
 * and produces a query vector, cosine hits are fused in via RRF. Any provider
 * failure falls back to the FTS5 result.
 */
export async function recallBugs(
  cwd: string,
  query: string,
  opts: RecallOptions = {}
): Promise<SimilarityMatch[]> {
  const repo = BugMemoryRepo.for(cwd);
  const fts = repo.searchBugs(query, opts.filePath ? { filePath: opts.filePath } : undefined);

  const provider = resolveEmbeddingProvider();
  if (!provider) return fts;

  const k = opts.limit ?? 20;
  let vectorIds: string[];
  try {
    const [queryVec] = await provider.embed([query]);
    if (!queryVec) return fts;
    const hits = EmbeddingRepo.for(cwd).search("bug", provider.id, l2normalize(queryVec), k);
    vectorIds = hits.map((h) => h.refId);
  } catch (err) {
    if (err instanceof EmbeddingsUnavailableError) return fts; // graceful degrade
    throw err;
  }

  if (vectorIds.length === 0) return fts;

  const ftsById = new Map(fts.map((m) => [m.entry.id, m]));
  const fused = reciprocalRankFusion([fts.map((m) => m.entry.id), vectorIds]);

  const results: SimilarityMatch[] = [];
  for (const { refId, score } of fused) {
    const inVector = vectorIds.includes(refId);
    const existing = ftsById.get(refId);
    if (existing) {
      const reasons = inVector
        ? Array.from(new Set([...existing.matchReasons, "semantic"]))
        : existing.matchReasons;
      results.push({ entry: existing.entry, score, matchReasons: reasons });
    } else {
      const entry = repo.lookup(refId);
      if (entry) results.push({ entry, score, matchReasons: ["semantic"] });
    }
  }
  return results;
}
