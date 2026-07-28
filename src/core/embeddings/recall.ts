// Hybrid bug recall (spec 25). Fuses the existing FTS5 lexical search with
// cosine search over stored embeddings, so a bug is found by meaning even when
// the query shares few words with it (the cross-project-transfer premise). When
// embeddings are disabled or unavailable, recall is exactly today's FTS5 result
// — no regression.

import { join } from "node:path";
import { BugMemoryRepo } from "../../repositories/bug-memory-repo";
import { EmbeddingRepo, hashContent } from "../../repositories/embedding-repo";
import type { BugEntry, SimilarityMatch } from "../../types/bug-memory";
import { minkRoot } from "../paths";
import { projectIdFor } from "../project-id";
import { listRegisteredProjects } from "../project-registry";
import { resolveConfigValue } from "../global-config";
import {
  EmbeddingsUnavailableError,
  resolveEmbeddingProvider,
  type EmbeddingProvider,
} from "./provider";
import { reciprocalRankFusion } from "./hybrid";
import { l2normalize } from "./vector";

/** A recalled bug. `project` is set only for matches from another project. */
export interface BugRecallMatch extends SimilarityMatch {
  project?: string;
}

const normErr = (s: string): string => s.trim().toLowerCase();

// Cosine floor for a vector hit to count. Without it, brute-force search returns
// every bug (including orthogonal, score-0 ones), polluting the fused ranking.
const MIN_SIMILARITY = 0.25;

// Bound each embed() call so a large first-time backfill can't build one giant
// batch (memory spike / model batch limits).
const EMBED_BATCH_SIZE = 32;

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
    .map((e) => {
      const text = bugText(e);
      return { e, text, hash: hashContent(text) };
    })
    .filter((p) => !store.hasFresh("bug", p.e.id, provider.id, p.hash));

  if (pending.length === 0) return 0;

  let embedded = 0;
  // Embed in bounded chunks so a large backlog never builds one giant batch,
  // and progress is durable if a later chunk fails.
  for (let start = 0; start < pending.length; start += EMBED_BATCH_SIZE) {
    const chunk = pending.slice(start, start + EMBED_BATCH_SIZE);
    const vectors = await provider.embed(chunk.map((p) => p.text));
    for (let i = 0; i < chunk.length; i++) {
      const vec = vectors[i];
      if (!vec) continue; // provider returned fewer vectors than inputs — skip
      store.upsert({
        kind: "bug",
        refId: chunk[i].e.id,
        model: provider.id,
        contentHash: chunk[i].hash,
        vector: l2normalize(vec),
      });
      embedded++;
    }
  }
  return embedded;
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
): Promise<BugRecallMatch[]> {
  const repo = BugMemoryRepo.for(cwd);
  const fts = repo.searchBugs(query, opts.filePath ? { filePath: opts.filePath } : undefined);
  const k = opts.limit ?? 20;

  const provider = resolveEmbeddingProvider();
  if (!provider) return fts.slice(0, k);

  const crossEnabled = resolveConfigValue("embeddings.cross-project").value === "true";

  // Nothing to match: no local vectors and no cross-project search. Skip the
  // (expensive) query embedding entirely and return the FTS5 result.
  if (!crossEnabled && EmbeddingRepo.for(cwd).countForModel("bug", provider.id) === 0) {
    return fts.slice(0, k);
  }

  let queryVec: Float32Array | undefined;
  try {
    [queryVec] = await provider.embed([query]);
  } catch (err) {
    if (err instanceof EmbeddingsUnavailableError) return fts.slice(0, k); // graceful degrade
    throw err;
  }
  if (!queryVec) return fts.slice(0, k);
  const qv = l2normalize(queryVec);

  // ── Current project: fuse FTS5 + vector via RRF ──────────────────────────
  const vectorIds = EmbeddingRepo.for(cwd)
    .search("bug", provider.id, qv, k, MIN_SIMILARITY)
    .map((h) => h.refId);
  const ftsById = new Map(fts.map((m) => [m.entry.id, m]));
  const fused =
    vectorIds.length === 0
      ? fts.map((m, i) => ({ refId: m.entry.id, score: 1 / (60 + i + 1) }))
      : reciprocalRankFusion([fts.map((m) => m.entry.id), vectorIds]);

  const current: BugRecallMatch[] = [];
  for (const { refId, score } of fused) {
    const existing = ftsById.get(refId);
    if (existing) {
      const reasons = vectorIds.includes(refId)
        ? Array.from(new Set([...existing.matchReasons, "semantic"]))
        : existing.matchReasons;
      current.push({ entry: existing.entry, score, matchReasons: reasons });
    } else {
      const entry = repo.lookup(refId);
      if (entry) current.push({ entry, score, matchReasons: ["semantic"] });
    }
  }
  const currentTop = current.slice(0, k);

  // ── Other projects: vector recall, deduped against the current results ────
  if (!crossEnabled) {
    return currentTop;
  }

  const seen = new Set(currentTop.map((m) => normErr(m.entry.errorMessage)));
  const currentId = projectIdFor(cwd);
  const cross: BugRecallMatch[] = [];

  for (const reg of listRegisteredProjects()) {
    if (reg.id === currentId) continue;
    const projDir = join(minkRoot(), "projects", reg.id);
    const store = EmbeddingRepo.forDir(projDir);
    const bugs = BugMemoryRepo.forDir(projDir);
    if (!store || !bugs) continue;

    for (const hit of store.search("bug", provider.id, qv, k, MIN_SIMILARITY)) {
      const entry = bugs.lookup(hit.refId);
      if (!entry) continue;
      const key = normErr(entry.errorMessage);
      if (seen.has(key)) continue; // dedup across projects
      seen.add(key);
      cross.push({ entry, score: hit.score, matchReasons: ["semantic", "cross-project"], project: reg.id });
    }
  }

  cross.sort((a, b) => b.score - a.score);
  return [...currentTop, ...cross.slice(0, k)];
}
