# Delivery Plan — Semantic Retrieval (Spec 25)

> **✅ Delivered for bug memory.** Formal spec: [`25-semantic-retrieval.md`](./25-semantic-retrieval.md).
> Architecture: [`../docs/semantic-retrieval.md`](../docs/semantic-retrieval.md). Implemented in three
> phases: provider + vector store, hybrid bug recall, cross-project recall + backfill + CLI.

**Status:** Transient. Delete once the *Deferred* items below (learnings/notes
embeddings, semantic wiki search) are shipped or ticketed elsewhere.

**Branch convention:** feature branches per phase; PRs target an integration
branch, **never `main`**. Each phase is independently mergeable.

## Background

Recall was lexical (FTS5). This adds a local neural embedding layer that augments
FTS5 without replacing it, so records are found by meaning — and, across
projects, deliver the transfer a cross-project tool exists for. Off by default;
disabled or unavailable ⇒ exactly the FTS5 result.

The embedding runtime is real and neural, but **not** a package.json dependency:
it is opt-in and user-installed, imported lazily, and absent-safe. This keeps the
base CLI lightweight and CI's frozen-lockfile install unaffected. See the
architecture doc §2 for the rationale.

| Phase | Theme | Risk | Why this order |
|------|-------|------|----------------|
| 1 | Provider + vector store + config | Med | The substrate; nothing recalls yet, so it is safe to land first |
| 2 | Hybrid bug recall | Med | Fuse vectors with FTS5 on one project; the first user-visible win |
| 3 | Cross-project recall + backfill + CLI | Med | The headline transfer, plus indexing and the opt-in surface |

## Guardrails (apply to every phase)

- **Additive, never a regression.** Disabled/unavailable ⇒ FTS5. Every provider
  call on the recall path is guarded and degrades on failure.
- **No new package.json dependency.** The model runtime is opt-in, lazily and
  non-literally imported, never bundled; CI (`--frozen-lockfile`) is unaffected.
- **Local-first.** Inference is local; model cached under `~/.mink/models`; no
  record text leaves the machine.
- **Deterministic.** Vector math and rank fusion are deterministic; recall order
  is stable for a fixed store and model.
- **Dual runtime.** Builds and passes under Node and Bun; `bunx tsc --noEmit`
  stays clean.

---

## Phase 1 — Provider + vector store + config

- `core/embeddings/vector.ts` — pure math: L2 normalize, cosine, little-endian
  Float32 ⇄ bytes codec for BLOB storage.
- `core/embeddings/provider.ts` — `EmbeddingProvider` interface; a neural adapter
  (`@huggingface/transformers`) imported through a non-literal specifier so it is
  neither bundled nor required to be installed; `resolveEmbeddingProvider()` and a
  test-injection seam; a missing dep/model ⇒ `EmbeddingsUnavailableError`.
- `repositories/embedding-repo.ts` — vector store keyed by `(kind, ref, model)`
  with a content hash; brute-force cosine `search`.
- schema: `embeddings` table (BLOB vectors), `schema_version` 4.
- config: `embeddings.enabled` (default false), `embeddings.model`,
  `embeddings.cross-project`.

**Exit:** vectors store and search by cosine; the feature resolves off by default.

## Phase 2 — Hybrid bug recall

- `core/embeddings/hybrid.ts` — Reciprocal Rank Fusion (pure).
- `core/embeddings/recall.ts` — `embedBugs()` (index/backfill a project's bugs)
  and `recallBugs()` (FTS5 ⊕ vectors via RRF), with graceful FTS5 fallback.
- Wire `mink_recall_bugs` to hybrid recall; `mink_log_bug` best-effort embeds the
  new bug (never fails the write).

**Exit:** a semantically related bug the lexical search misses is surfaced;
disabled/unavailable both fall back to FTS5.

## Phase 3 — Cross-project recall + backfill + CLI

- Cross-project recall in `recallBugs`: search other registered projects' stores
  (`EmbeddingRepo.forDir` / `BugMemoryRepo.forDir` via `openProjectDbForDir`), tag
  origin, dedup by error message, current project first. `mink_recall_bugs`
  renders a cross-project section.
- Scheduler `embedding-backfill` task (no-op when disabled).
- `mink embeddings status|enable|disable|backfill` + a library-installed probe.

**Exit:** another project's related bug surfaces when cross-project is enabled;
the CLI toggles and backfills.

## Cross-cutting

- Tests per the spec's Test Requirements: pure math + RRF + repo + provider unit
  tests; recall and cross-project integration with a deterministic injected
  provider (no model/network). Neural inference validated manually.
- Docs: architecture (`docs/semantic-retrieval.md`) + contract (`specs/25-*.md`).

## Validation before each phase merges

- No new package.json dependency; `bunx tsc --noEmit` clean; embeddings suite
  green under both runtimes.
- Phase 1: vectors round-trip through SQLite; feature off by default.
- Phase 2: semantic match surfaces a lexical miss; fallback paths hold.
- Phase 3: cross-project hit tagged with origin; CLI toggles; scheduler task set
  updated.

## Deferred (follow-ups, deliberately out of this delivery)

- **Learnings & notes embeddings + semantic wiki search** — the store already
  carries `learning`/`note` kinds; extend indexing and wire `mink_search_wiki` to
  hybrid recall.
- **Vector index** — swap brute-force cosine for `sqlite-vec`/ANN behind
  `EmbeddingRepo.search` if a store grows large.
- **Cross-project vector dedup** — dedup by embedding similarity rather than exact
  error-message match.
