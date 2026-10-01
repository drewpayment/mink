# 25 — Recall Relevance Reranking

## Overview

Wiki recall (spec 15, `mink recall`) ranks notes with lexical full-text scoring. Lexical scoring is
fast, free, and local, but it answers the wrong question. It measures how many of the query's words
a note contains, not whether the note actually answers the query. This causes three recurring
failures:

1. **Vocabulary mismatch.** A note that answers the question in different words ("token bucket"
   for a query about "throttling") is never returned, because every query word must appear in the
   note.
2. **Topical false positives.** A note that merely mentions the query's words (a meeting log that
   lists "rate limiting" as an agenda item) outranks the note that holds the answer.
3. **No real "not found".** An empty result means "no word overlap", and a non-empty result says
   nothing about relevance. The assistant can't tell "nothing in the vault answers this" from
   "these are weak matches", so it either gives up too early or cites a note that doesn't answer
   the question.

This spec adds an optional **relevance reranking** stage to recall. It has two parts:

- A widened lexical pass gathers a larger, more forgiving candidate pool.
- An external **relevance judge** scores each candidate against the query and returns a
  calibrated probability that the candidate answers it.

Results are reordered by that probability, and candidates below a relevance threshold are dropped.
An empty reranked result therefore means "nothing relevant", not "no word overlap".

Reranking is **opt-in**, because it sends note content to a third-party service. It is
**non-blocking**: any failure returns the plain lexical result. It is **scoped to explicit
retrieval** and never runs inside lifecycle hooks. The same judge can later support write-time
decisions, such as duplicate detection, tag selection and link-target suggestion. Those are
covered here as a secondary, advisory capability.

## Capabilities

### Candidate Generation (Widened Recall)

- In reranking mode, the lexical pass matches notes containing **any** meaningful query term,
  rather than requiring all of them. It returns a larger candidate pool (configurable, default 40).
- The pool may be expanded with **one-hop graph neighbours** of the strongest lexical hits, meaning
  notes they link to or that link to them. Neighbours enter the pool without a lexical score and
  are capped so they can't crowd out lexical candidates.
- Query terms that carry no signal, such as common function words, are ignored when widening. A
  query made up only of such words falls back to the strict, all-terms behaviour.
- Structured filters (project, tag, category, updated-since) are always applied during candidate
  generation, in the local store. The judge is never asked to enforce a filter, compare dates or
  count.
- The widened pass can be used **without** a judge (a local-only "wide" mode), so its effect can be
  measured separately from the judge's.

### Relevance Judging

- Each query–candidate pair is judged independently. The judge returns a probability between 0 and
  1 that the candidate contains information answering the query.
- The judge sees a **bounded candidate representation**: title, vault-relative path, tags, and a
  body excerpt of at most a configurable number of tokens, chosen around the lexical match when one
  exists and from the start of the body otherwise. Full note bodies are never sent.
- Candidate content is clearly delimited as untrusted data in the judging request. Instructions
  embedded in a note must not be able to change how other candidates are judged.
- The judging question is fixed, versioned wording. Changing the wording is a versioned change, the
  same as changing the judge model, because probabilities from different wordings aren't
  comparable.
- The judge model is **configurable** and is pinned to a concrete version wherever the provider
  route allows it. Some routes only expose a floating "latest" alias. On those routes the version
  can drift without notice, so the configured model name is recorded with every judgment, and the
  threshold is re-checked against the retrieval evaluation periodically.
- Judgments run concurrently, up to a configurable limit, and must respect the provider's
  rate-limit signals by backing off within the time budget.

### Ranking and Abstention

- Judged candidates are ordered by relevance probability, highest first. Ties are broken by lexical
  score, then by recency.
- Candidates below a configurable **minimum relevance** threshold are dropped. When no candidate
  clears it, recall returns an empty result and marks it as **judged-empty**, which is different
  from the **lexical-empty** case where no candidates were found at all.
- The requested result limit is applied **after** reranking. The pool is always larger than the
  limit.
- The default threshold is calibrated per judge model against the retrieval evaluation
  (see Test Requirements). It is not carried over from another scoring system.

### Output Contract

- Every existing recall result field (path, title, snippet, score, tags, category, updated) keeps
  its meaning and position. Consumers that ignore new fields must keep working unchanged.
- Each result gains an optional **relevance** field, present only when that result was judged.
- The machine-readable output gains a **retrieval summary**:
  - the ranker used (`lexical`, `wide`, or `judge`);
  - candidates considered and judged;
  - whether the result is lexical-empty or judged-empty;
  - the fallback reason, when reranking was requested but not applied;
  - the judge model version, when a judge was used.
- The human-readable output shows relevance next to each result and states the ranker used. When
  the result is judged-empty, it says so explicitly, including how many candidates were rejected.

### Enablement, Credentials, and Disclosure

- Reranking is **disabled by default**. Enabling it is an explicit configuration change.
- The judge credential is a **per-machine secret** (spec 18). It is never synced, and it is omitted
  or masked wherever configuration is listed or exported.
- The judge endpoint is configurable, so the provider can be reached directly or through a
  compatible gateway.
- When reranking is enabled, the user is told once, in plain language, that note titles, tags and
  excerpts from recall candidates will be sent to the configured judge service.
- Per invocation, reranking can be forced on (when configured) or off.

### Non-Blocking and Graceful Degradation

- Reranking has a total wall-clock **time budget** (configurable, default 3 seconds). If any
  judgment has not completed within the budget, recall returns the lexical ordering for the whole
  result set and reports the fallback reason. Judged and unjudged scores are never mixed in one
  ordering.
- If the credential is missing or rejected, the network is unavailable, the provider is rate
  limited past the budget, or a response is malformed, recall returns the lexical result with a
  fallback reason. It never exits non-zero because of the judge.
- An authentication failure produces one actionable warning per invocation. Transient failures
  produce no user-facing noise beyond the fallback reason in the retrieval summary.

### Judgment Cache

- Judgments are cached locally, keyed by the normalised query, note path, a hash of the note
  representation that was sent, and the judge model version plus question version.
- Editing a note, changing the judge model, or changing the question wording invalidates the
  affected entries automatically, because the key no longer matches.
- The cache is derived, regenerable state. It lives next to the search index, is never synced, is
  bounded in size and age, and is rebuilt from nothing if it is corrupted.
- A result served entirely from cache makes no network call and is still reported as ranker
  `judge`.

### Scope Boundaries

- The judge is invoked only by explicit retrieval: the recall command and the interfaces built on
  it (assistant persona, dashboard search).
- Lifecycle hooks (session start, pre/post tool) must never call the judge, directly or indirectly.
- Lexical-only recall stays fully functional with reranking disabled or unavailable, and remains the
  default.

### Usage Accounting

- Each reranked recall records input tokens, judgments made, cache hits, and latency locally. Usage
  can be summarised on demand (for example, by a status command), so the user can see what
  reranking costs.

### Write-Time Judgments (Secondary)

Once the judge is configured, the same capability can support note capture. These judgments are
**advisory**: they are surfaced as suggestions and never silently change what gets written.

- **Duplicate detection.** Before a new note is created, the closest existing notes are judged on
  whether they already cover the new content. Likely duplicates are reported with their paths.
- **Tag selection.** Suggested tags are chosen from the vault's existing tag vocabulary, including a
  "none of these" option, so tags don't multiply.
- **Link-target suggestion.** Plausible wikilink targets are ranked by relevance to the new note's
  content.

## Acceptance Criteria

```
GIVEN reranking is disabled
WHEN the user runs recall for any query
THEN results are produced by lexical ranking only
AND no network request is made
AND the output is identical to recall before this spec, apart from a "lexical" ranker in the summary
```

```
GIVEN reranking is enabled and the judge is reachable
AND the vault contains a note that answers the query using none of the query's exact words
     except one
WHEN the user runs recall for that query
THEN that note appears in the results
AND it is ranked above notes that contain more query words but do not answer the query
```

```
GIVEN reranking is enabled and the judge is reachable
AND no note in the vault answers the query, but several notes share words with it
WHEN the user runs recall for that query
THEN the result set is empty
AND the retrieval summary marks the result as judged-empty
AND reports how many candidates were judged
```

```
GIVEN reranking is enabled
AND the judge does not respond within the time budget
WHEN the user runs recall
THEN results are returned in lexical order within the budget plus a small margin
AND the retrieval summary reports ranker "lexical" and a timeout fallback reason
AND the command exits successfully
```

```
GIVEN reranking is enabled
AND the configured credential is rejected by the judge
WHEN the user runs recall
THEN lexical results are returned
AND exactly one actionable warning about the credential is shown
AND the command exits successfully
```

```
GIVEN a recall with a project, tag, category, or updated-since filter
WHEN reranking is applied
THEN every returned result satisfies the filter
AND no candidate that fails the filter is sent to the judge
```

```
GIVEN a query–note pair was judged previously
AND neither the note nor the judge version has changed
WHEN the same recall runs again
THEN the cached judgment is used and no request is made for that pair
```

```
GIVEN a query–note pair was judged previously
AND the note has since been edited
WHEN the same recall runs again
THEN that pair is judged again
```

```
GIVEN reranking is enabled
WHEN any lifecycle hook runs
THEN no judge request is made
```

```
GIVEN the judge credential is configured
WHEN the user lists or exports configuration without explicitly requesting secrets
THEN the credential value is not shown in full
```

```
GIVEN a candidate note whose body contains text instructing the judge to rate it relevant
WHEN it is judged alongside a genuinely relevant note
THEN the note's text is presented to the judge only as delimited candidate data
AND the retrieval evaluation includes such a case, which must not rank first
```

```
GIVEN the user requests a result limit of N
WHEN reranking is applied
THEN at most N results are returned
AND more than N candidates were eligible for judging, unless fewer existed
```

## Edge Cases

- **Empty vault or zero candidates.** Returns lexical-empty without calling the judge.
- **Query made up only of stopwords or punctuation.** No widening. Strict lexical behaviour, and the
  judge is not called if there are no candidates.
- **Very large notes.** Only the bounded excerpt is sent, and the excerpt stays within budget even
  when a single line is enormous.
- **Notes with no body** (title or frontmatter only). The title, tags and path alone are judged.
- **Every judgment fails except a few.** Treated as a fallback (lexical ordering). Partial rankings
  are never returned.
- **The judge returns a value outside 0–1, or no value.** That response is treated as malformed and
  triggers a fallback for the whole query.
- **Rate limited.** Back off within the budget. If the budget runs out, fall back.
- **The configured model is unknown to, or retired by, the provider.** Treated as a configuration
  error, with one actionable warning and a lexical fallback. Never silently substitute another
  model.
- **Cache database corrupted or schema-mismatched.** The cache is discarded and rebuilt, and the
  recall still completes.
- **Clock skew or an unusual `updated` value.** Irrelevant to judging, because dates are filtered
  locally (spec 15 normalisation applies).
- **Offline machine with reranking enabled.** Every recall falls back quickly, without waiting out
  the full budget, once a connection failure has been observed within the invocation.
- **Assistant calls recall many times in a loop.** The cache and bounded concurrency keep request
  volume within provider rate limits.

## Test Requirements

- **Unit:**
  - candidate widening, including any-term matching, stopword handling, neighbour caps, and filter
    application;
  - excerpt selection and truncation;
  - ranking, tie-breaking and threshold abstention;
  - budget and fallback state machine;
  - cache keying and invalidation;
  - secret masking.

  All of these use a **fake judge**, with no network access in unit tests.
- **Contract:**
  - the judge client's request and response mapping, against recorded fixtures;
  - handling of authentication failures, rate limits, overload, and validation errors.
- **Integration:** recall with a deterministic fake judge end to end through the command, covering:
  - JSON output shape, including the retrieval summary;
  - fallback reasons;
  - the guarantee that hooks never invoke the judge.
- **Retrieval evaluation.** A retrieval-level evaluation that doesn't use the assistant:
  - It runs recall directly against the fixture vault for a fixed case set and reports hit@1,
    hit@3, hit@10, mean reciprocal rank, and correct-abstention rate on negative cases.
  - It compares at least three arms: strict lexical, wide lexical, and wide plus judge.
  - The case set must include vocabulary-mismatch cases, topical-false-positive cases, negative
    cases, and one embedded-instruction case.
  - The judge arm runs only when a credential is supplied explicitly. It is never part of the
    default test suite.
- **Regression:** with reranking disabled, the existing recall tests and the existing assistant
  evaluation pass unchanged.
