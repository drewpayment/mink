# 25 — Semantic Retrieval

## Overview

Mink's recall of past knowledge has been lexical: a stored bug is found only when
a query shares words with it. This capability adds a meaning-based layer. Text is
converted to vectors, stored alongside the source records, and searched by
similarity, so a record is recalled even when it shares few words with the query.

The layer is strictly additive. It augments the existing keyword search rather
than replacing it, and the two are fused into a single ranking. It is off by
default, and whenever it is disabled or the embedding capability is unavailable,
recall falls back to exactly the existing keyword result — there is no
regression.

Its highest-value application spans projects: a record stored while working in
one project can surface, by meaning, while working in another — the transfer a
cross-project tool exists to provide.

Embedding runs locally; no record text leaves the machine. The embedding
capability is optional and, when present, its model is fetched on first use and
cached locally.

## Capabilities

### Feature Gating and Fallback

- Semantic retrieval is off unless explicitly enabled through configuration.
- The embedding capability is optional. When it is absent or fails to initialize,
  the system reports it as unavailable and recall falls back to the keyword path.
- A failure anywhere on the recall path (embedding, vector search, storage)
  degrades to the keyword result rather than surfacing an error.

### Vector Store

- Each embedded record is stored as a vector keyed by its kind, its record
  identifier, and the model that produced it, together with a content fingerprint
  so a later pass can tell whether the record has changed.
- Storing multiple models for the same record is permitted; a reader considers
  only vectors from the active model, so switching models never corrupts recall.
- The vector store is derived state: it can always be rebuilt from the source
  records.

### Indexing and Backfill

- When a record is created and the feature is enabled, the system may embed it;
  an embedding failure never prevents the record from being stored.
- A backfill embeds records that lack a current vector for the active model, and
  is idempotent: records already current are skipped.
- Backfill is available on demand and on a schedule; the scheduled pass is a
  no-op while the feature is disabled.

### Hybrid Ranking

- For a query, the system computes the keyword result and, when a query vector is
  available, a similarity result, and fuses the two into one ranking using a
  method that does not require the two score scales to be comparable.
- A record found by both paths is ranked at least as high as one found by only
  one.

### Cross-Project Recall

- When cross-project recall is enabled, a query also searches the vector stores
  of other known projects, and results carry the identity of their origin
  project.
- Results are de-duplicated across projects, and the working project's own
  matches are presented ahead of matches from other projects.
- Cross-project recall is off by default; when off, only the working project is
  searched.

### Management Surface

- An operator can turn the feature on or off, inspect its status (enabled state,
  active model, whether the embedding capability is present, and how many records
  are indexed), and trigger a backfill.

## Acceptance Criteria

```
GIVEN semantic retrieval is disabled
WHEN a query is issued
THEN the result is exactly the keyword-search result

GIVEN semantic retrieval is enabled but the embedding capability is unavailable
WHEN a query is issued
THEN recall falls back to the keyword result and no error is surfaced

GIVEN a stored record whose text shares few words with a query but is close in
      meaning, and its vector has been indexed
WHEN a query is issued with the feature enabled and available
THEN the record appears in the results, attributed to the semantic path

GIVEN a record found by both the keyword and the semantic path
WHEN results are ranked
THEN it is ranked at least as high as a record found by only one path

GIVEN a record has already been embedded for the active model and has not changed
WHEN a backfill runs
THEN the record is not re-embedded

GIVEN a record's text has changed since it was embedded
WHEN a backfill runs
THEN the record is re-embedded

GIVEN cross-project recall is enabled and another project has a record close in
      meaning to the query
WHEN a query is issued in the working project
THEN that record appears, attributed to its origin project, after the working
     project's own matches

GIVEN cross-project recall is disabled
WHEN a query is issued
THEN only the working project's records are searched

GIVEN a new record is created while the feature is enabled and embedding fails
WHEN the record is stored
THEN the record is stored successfully and remains findable by keyword
```

## Edge Cases

- Feature disabled — keyword-only recall; nothing embedded.
- Embedding capability absent or model unavailable — treated as unavailable;
  keyword fallback.
- Empty query vector or empty candidate set — keyword result stands.
- A record referenced by a vector no longer exists — the stale vector is ignored.
- A vector produced by a non-active model — ignored by the reader.
- Another project has no vector store yet — skipped during cross-project recall.
- The same record text appears in multiple projects — de-duplicated in results.
- Model switched — old-model vectors are inert; a backfill repopulates the active
  model.

## Prompt-Cache Stability

- Vector math and rank fusion are deterministic, so recall order is stable for a
  fixed store and model, and re-issuing an identical query does not perturb a
  cached context prefix.

## Test Requirements

- Unit: vector operations — normalization, similarity (including zero and
  dimension-mismatch), and a byte round-trip of the stored form.
- Unit: rank fusion — presence in multiple lists is boosted; empty input yields
  empty output; ordering is deterministic.
- Unit: vector store — similarity ranking, a minimum-score cutoff, filtering by
  kind and model, replacement on re-embed, freshness by content fingerprint, and
  deletion.
- Unit: feature resolution — disabled, enabled, and injected/forced states.
- Integration: hybrid recall against real records with a deterministic stand-in
  embedder — the semantic path surfaces a record the keyword path misses;
  disabled and unavailable states both fall back; backfill is idempotent.
- Integration: cross-project recall across two registered projects — a related
  record from another project surfaces when enabled and does not when disabled.
