# mink-agent retrieval eval

A small eval harness that measures whether `mink-agent` (the prompt in
`agents/mink-agent.md.tmpl`) actually finds things in the vault, instead of
vibes-checking it by hand. See
`docs/plans/2026-07-agent-retrieval-and-chat.md` (Phase 2) for the plan this
implements.

## What's here

- `fixtures/vault/` — a ~37-note fixture wiki, in the real PARA layout
  (`inbox/`, `projects/<slug>/`, `areas/`, `areas/daily/`, `resources/`,
  `archives/`, `patterns/`). It includes:
  - Several facts that exist **only in note bodies** (e.g. the rate-limiter
    algorithm in `projects/orion-api/architecture.md`, the Postgres pool
    formula in `resources/postgres-connection-pooling.md`) — these are
    invisible to a title-only search and only findable via a real full-text
    search over bodies.
  - An **ambiguous basename pair**: `projects/orion-api/overview.md` and
    `projects/atlas-web/overview.md` both exist, so a bare `[[overview]]`
    link is not deterministic — the fixture's own wikilinks use
    path-qualified links (`[[projects/orion-api/overview|...]]`) as the
    agent prompt now instructs. `graph-hop-overview-basename-disambiguation`
    exercises this directly: `archives/legacy-monolith-notes.md` links to
    both, and the question only gives enough context to pick one, so citing
    the wrong project's overview is a real failure, not a near-miss.
  - An **aliased note**: `areas/sec-checklist.md` has H1 `# Security
    Checklist` and `aliases: [Security Checklist, Sec Checklist]` in its
    frontmatter — title differs from the filename slug.
  - A graph of `[[wikilinks]]` connecting most notes, so backlink/related
    "one more hop" questions are answerable (e.g. the on-call escalation
    policy is only reachable by hopping from `areas/oncall-rotation.md` to
    `resources/oncall-escalation-matrix.md`).
  - One intentionally orphaned inbox note (`inbox/quick-thought-graphql-gateway.md`)
    — realistic vault noise, not referenced by any case.
- `cases.json` — 28 question/answer cases: 4 `title-hit`, 6 `body-hit`, 4
  `graph-hop`, 6 `negative`, 4 `vocab-mismatch`, 3 `topical-false-positive`, 1
  `adversarial`. Every case also carries `queries` (1-2 keyword queries), used
  only by the retrieval-level eval below; `vocab-mismatch` and
  `topical-false-positive` cases grade like any other non-negative case in the
  agent runner (path citation required), and `adversarial` does too (its
  `adversarial_paths` field is retrieval-eval only). Grading is **not** simple any-of-substring-or-path:
  - **Non-negative cases require a path match to pass.** `expected_paths` is
    any-of (a case can accept multiple valid targets, e.g. the monolith
    successors case accepts either the archive note or either replacement
    project's overview); `expected_substrings` is checked and shown in the
    scorecard but is supplementary, never sufficient on its own. This is
    deliberate: `claude -p` responses routinely echo nouns from the question
    itself, so a case whose expected substring is also in the question text
    (e.g. asking about a "design system doc" and checking for the words
    "design system" in the response) doesn't actually prove the note was
    retrieved and cited — only a path citation does.
  - **Negative cases have no `expected_paths`** (there's nothing correct to
    cite) and pass only on an admission substring — an "I didn't find this"
    phrase. A negative case should only pass if the agent admits it couldn't
    find an answer, not because it happened to mention an unrelated word.
- `engines.ts` — engine adapters. Each adapter is one function:
  `(question, ctx) => { ok, output, error? }`. Only `claude` is implemented
  (`claude -p --agent mink-agent "<question>"`), matching how `mink agent` /
  the future `mink chat` ride Claude Code's own auth. `copilot` and `pi` are
  stubbed — slot in a real adapter for each here when Phase 3 lands, no
  runner changes needed.
- `runner.ts` — orchestrates a run: builds an isolated temp copy of the
  fixture vault, installs the **current repo's** `agents/mink-agent.md.tmpl`
  (rendered against that fixture, not your real vault) to
  `~/.claude/agents/mink-agent.md`, runs each case through the chosen
  engine, grades it, prints a scorecard, then restores whatever was
  installed there before the run (or removes the file if nothing was). See
  "Ctrl-C and crash safety" below for exactly how that restore is made
  durable.
- `tsconfig.json` — a standalone strict config so `evals/*.ts` is covered by
  `npm run typecheck` (the main `tsconfig.json` excludes `evals/`, same as
  `tests/`).

## Running it

```bash
npm run eval:agent                              # full run, claude engine
npm run eval:agent -- --dry-run                  # no CLI calls, no tokens — sanity-checks fixtures/template
npm run eval:agent -- --case body-hit-rate-limiter-algorithm
npm run eval:agent -- --limit 3
npm run eval:agent -- --keep-tmp                 # leave the temp fixture instance on disk for inspection
npm run eval:agent -- --no-install               # skip (re)installing mink-agent; assumes it's already current
npm run eval:agent -- --rerank                   # run with recall reranking on (see below)
```

### Recall mode (`--rerank`)

Every run pins the recall mode explicitly and prints it in the scorecard header, so runs are
comparable. By default the child env sets `MINK_RECALL_RERANK=off` (and strips any judge key), so
your global mink config or env cannot silently change a baseline. With `--rerank` the child gets
`MINK_RECALL_RERANK=jev`, and `MINK_RECALL_RERANK_BASE_URL` / `MINK_RECALL_RERANK_MODEL` plus the
key (`MINK_RECALL_RERANK_API_KEY` or `JEV_API_KEY`) pass through from your environment; the run
exits immediately if no key is set. Reranking sends fixture note excerpts to the judge and spends
judge tokens on top of the agent's. Compare the two scorecards, watching the negative cases.

Requires the `claude` CLI on `PATH` and **spends real tokens** — one `claude
-p` call per case. It is a separate script (`eval:agent`), not part of
`npm test` / `bun test`, and is not run in CI. `bun test`'s default file
discovery only picks up `*.test.ts`, and nothing under `evals/` matches that
pattern, so this harness cannot get swept into the normal test run by
accident.

## Isolation

- The fixture vault is copied into a fresh `mkdtemp` directory per run; the
  real `~/.mink` is never read or written.
- `MINK_ROOT_OVERRIDE` and `MINK_WIKI_PATH` are set for the duration of each
  engine call so any `mink` invocations the agent makes inside its Bash
  tool resolve against the fixture, not your real install.
- The one piece of real, shared state this touches is
  `~/.claude/agents/mink-agent.md` — that's simply where Claude Code loads
  agent definitions from; there's no per-invocation override. Pass
  `--no-install` to skip touching it entirely if you've already installed
  the definition you want tested via `mink agent`.

### Ctrl-C and crash safety

A full run is 15+ sequential `claude -p` calls, so interrupting a run
partway through is the *expected* case, not an edge case — and a hard kill
(closing the terminal, `kill -9`, the machine sleeping) is a real
possibility, not just Ctrl-C. The runner is built assuming interruption can
happen at any point:

1. **Before** the fixture-rendered definition is written over
   `~/.claude/agents/mink-agent.md`, whatever was there (or the fact that
   nothing was) is written to an **on-disk** sibling file,
   `~/.claude/agents/mink-agent.md.eval-backup` — not just held in memory.
   A backup that only exists in the runner process's memory cannot survive
   a hard kill of that process.
2. `SIGINT` and `SIGTERM` handlers restore from that backup, clean up the
   temp fixture directory, and exit(130) — so a normal Ctrl-C mid-run
   leaves your real installed agent definition untouched.
3. If the process is killed hard enough to skip even the signal handlers
   (`SIGKILL`, terminal closed without delivering the signal, machine
   sleep), the backup file survives on disk. **The next time you run the
   harness at all** (including `--dry-run`), it checks for a leftover
   `.eval-backup` file first, before anything else, and restores it —
   printing what it did. You are never more than one more invocation of
   `npm run eval:agent` away from recovering a definition stranded by a
   truly hard kill; if you need it back immediately without re-running the
   harness, the backup file is plain text (a JSON marker with the original
   content inline) and can be applied by hand.
4. Restore is idempotent — normal completion, a signal handler, and the
   next-run recovery check can never double-apply or corrupt state, because
   the backup file is deleted as the last step of a successful restore and
   every restore path is a no-op once it's gone.

## Why it can't fully pass yet

This harness was built in parallel with the Phase 1 retrieval engine
(`mink recall`, `mink wiki backlinks`, `mink wiki related`, `mink wiki
doctor`) on a different branch. Until that branch merges, none of those
commands exist in a plain `mink` install, so:

- `title-hit` and some `body-hit`/`graph-hop` cases may still pass today,
  because the agent's playbook falls back to `rg` for exact strings and can
  often still stumble onto title matches via `mink note list` /
  `mink wiki status`.
- Body-only facts that require real ranked full-text search, and
  backlink/related graph hops, are expected to fail until `mink recall` /
  `mink wiki backlinks` / `mink wiki related` exist on `PATH`.
- `mink wiki doctor` is referenced in the prompt for vault-health questions
  but none of the current cases exercise it directly.

Once the Phase 1 branch merges and a build with `mink recall` etc. is on
`PATH`, re-run `npm run eval:agent` — the scorecard should show close to
all cases passing. Track that as the acceptance signal for "Phase 2 is done".

## Adding cases

Add an entry to `cases.json` with a unique `id`, a `category` (`title-hit`,
`body-hit`, `graph-hop`, `negative`, `vocab-mismatch`, `topical-false-positive`, or `adversarial`), the `question`, optional `queries`, and `expected_paths`
/ `expected_substrings` (either can be empty, but at least one non-empty
list is required for anything but a negative case). If the fact you're
testing doesn't exist in the fixture vault yet, add a note for it under
`fixtures/vault/` in the matching PARA folder first.

## Retrieval-level eval

`evals/retrieval.ts` scores the retrieval layer alone — `mink recall` ranking —
with no agent, network, Claude, or API key. It answers "did the right note
come back, and at what rank?" so retrieval changes (wide candidate mode,
external reranking) can be measured before an agent ever sees them.

```bash
bun run eval:retrieval                          # markdown scorecard
bun run eval:retrieval -- --json                # machine-readable
bun run eval:retrieval -- --verbose             # + top-5 paths per query
bun run eval:retrieval -- --arms strict,wide    # pick arms (default: all registered)
bun run eval:retrieval -- --limit 10            # results requested per query
bun run eval:retrieval -- --arms judge --min-relevance 0.6   # judge threshold (see below)
```

It copies `fixtures/vault/` into a temp dir, points `MINK_ROOT_OVERRIDE` /
`MINK_WIKI_PATH` at it (the real `~/.mink` is never touched), runs
`reindexVault()`, and removes the temp dir on exit, including on error. It is a
scoreboard, not a gate: exit 0 even when cases miss, non-zero only for harness
errors. Pure metric logic lives in `retrieval-lib.ts` (unit-tested in
`tests/unit/eval-retrieval-lib.test.ts`).

### Arms

An arm is `{ name, available(), run(query, limit) }`. Registered today:

- `strict` — `recall(query, { limit })`, i.e. AND-joined BM25 with substring fallback.
- `wide` — `recallCandidates()`: any-term (OR) FTS over non-stopword tokens plus
  one-hop graph neighbours of the top lexical hits. `run()` returns the **full pool**
  (lexical hits first, then graph neighbours), not truncated to `--limit`, so pool recall
  and pool size can be measured. hit@k and MRR use the pool's order.
- `judge` — the `wide` pool reranked by the configured relevance judge
  (`recall.rerank-*`, spec 25). It calls a live service and costs money, so it is **opt-in**:
  it runs only when a key is set (`MINK_RECALL_RERANK_API_KEY` or `JEV_API_KEY`) **and**
  `judge` is named explicitly in `--arms`. A default run always skips it, even with a key in
  your environment. Results are the reranked list truncated to `--limit` after the
  `--min-relevance` threshold; an empty list is an abstention.

### What is run

Each case is run once per query variant: the natural-language `question`, plus
each keyword string in `queries`.

### Metrics

- **hit@1/3/10** — share of non-negative cases whose first expected path
  (any-of `expected_paths`) is in the top k.
- **hit@pool** — share of non-negative cases whose expected path appears *anywhere* in what
  the arm returned. For `strict` this equals hit@limit; for `wide` it measures pool recall.
- **pool** — mean number of results returned per query (the pool-size cost of a wide arm).
- **MRR** — mean reciprocal rank of the first expected path; 0 if absent within the limit.
- **abstain** — over `negative` cases: share where the arm returned nothing
  (for strict, an empty result list is an abstention).
- **adv-pass** — over `adversarial` cases: the `adversarial_paths` note is not rank 1
  (its rank is in the per-case table).
- **p50/p95 ms** — nearest-rank latency percentiles per query.
- **judge tok** — judge input tokens, summed over the arm's queries; `-` for arms with no judge.
- **fallbacks** — queries where the judge arm wanted to rerank but fell back to the wide order
  (timeout, network, auth, rate limit, ...). Always check it: a non-zero count means part of
  the judge row is really `wide` output.

Three scopes are reported (summary and per category):

- `question` — the natural-language question variant.
- `queries-avg` — per-variant average: every keyword query counts once.
- `queries-best` — best-of-queries per case: an agent that retries with a
  better query gets credit for the best rank. For negatives, abstained means
  every variant abstained (an agent running all of them sees the union of
  their results); for adversarial, the case passes only if every
  variant keeps the bad note off rank 1 (worst case, since it is a safety check).

`vocab-mismatch` and `topical-false-positive` cases are expected to fail under
strict BM25; they are deliberately not rigged.

### Strict vs wide (28 cases, limit 10)

Per scope, overall (hit@1 / hit@3 / hit@10 / hit@pool / MRR / abstain / mean pool size):

| arm / scope | n | hit@1 | hit@3 | hit@10 | hit@pool | MRR | abstain | pool |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| strict / question | 22 | 0% | 0% | 0% | 0% | 0.000 | 100% (n=6) | 0.1 |
| wide / question | 22 | 64% | 91% | 100% | 100% | 0.768 | 17% (n=6) | 18.8 |
| strict / queries-avg | 42 | 45% | 48% | 48% | 48% | 0.464 | 92% (n=12) | 0.9 |
| wide / queries-avg | 42 | 69% | 86% | 93% | 98% | 0.789 | 17% (n=12) | 14.0 |
| strict / queries-best | 22 | 64% | 64% | 64% | 64% | 0.636 | 83% (n=6) | 1.0 |
| wide / queries-best | 22 | 86% | 95% | 100% | 100% | 0.920 | 17% (n=6) | 14.0 |

Hard categories, hit@pool (hit@10 in parentheses; strict is 0% everywhere):

| category | scope | wide hit@pool (hit@10) |
| --- | --- | --- |
| vocab-mismatch | question | 100% (100%) |
| vocab-mismatch | queries-avg | 88% (75%) |
| vocab-mismatch | queries-best | 100% (100%) |
| topical-false-positive | question | 100% (100%) |
| topical-false-positive | queries-avg | 100% (83%) |
| topical-false-positive | queries-best | 100% (100%) |

Reading it: strict returns almost nothing for a natural-language question because it
AND-joins every token, stopwords included. Wide drops stopwords and ORs the rest, so
the right note is in the pool for every question. The cost is pool size (14-19 results
per query instead of about 1), so the right note is often present but not first: hit@1
is 64% on questions while hit@pool is 100%. That gap is what the Phase 2 judge is meant
to close. The `adversarial` note still ranks first for some variants, and `wide` rarely
abstains (0-17% on negatives).

**Wide abstention is expected to be poor.** For `wide`, as for `strict`, abstention means
an empty result, and an any-term query almost always finds something. Deciding that
"nothing here answers this" is the judge's job (Phase 2), not candidate generation's.
Treat the wide arm's abstain column as a baseline the judge should beat, not a regression.

### Judge arm

```bash
JEV_API_KEY=... MINK_RECALL_RERANK_BASE_URL=https://ai-gateway.vercel.sh/typesafe \
  bun run eval:retrieval --arms strict,wide,judge
```

- Key: `MINK_RECALL_RERANK_API_KEY` or `JEV_API_KEY`. Base URL: `MINK_RECALL_RERANK_BASE_URL`
  (default `https://api.typesafe.ai`; use the gateway URL above with a Vercel AI Gateway key).
  Other `MINK_RECALL_RERANK_*` variables (model, pool size, timeout, concurrency) apply too.
- Config comes from the environment only: the eval runs under a temp `MINK_ROOT_OVERRIDE`, so
  your real `~/.mink` config is never read.
- Cost: about 25k input tokens per query (about 40 candidates, roughly 600 tokens each), so
  roughly $0.001 per query at $0.042 per million tokens. The full case set runs one query per
  question plus one per keyword variant, so budget for a few hundred judge calls per query
  count, and read the `judge tok` column for the actual total.
- `--min-relevance <p>` overrides the threshold (default 0.7) for one-off runs. For calibration use `--sweep` (below).

### Judge results

Live run on 2026-09-29, through the Vercel AI Gateway with `jev-latest` and the default settings
(min-relevance 0.5, pool 40, budget 3s, concurrency 8). 28 cases, limit 10.

| arm / scope | hit@1 | hit@3 | hit@10 | MRR | abstain | adv-pass | p50 ms | p95 ms | fallbacks |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| strict / question | 0% | 0% | 0% | 0.000 | 100% | 100% | 0 | 1 | 0 |
| wide / question | 64% | 91% | 100% | 0.768 | 17% | 0% | 0 | 0 | 0 |
| **judge / question** | **95%** | **100%** | **100%** | **0.977** | **83%** | **100%** | 840 | 1402 | 0 |
| strict / queries-best | 64% | 64% | 64% | 0.636 | 83% | 0% | 0 | 0 | 0 |
| wide / queries-best | 86% | 95% | 100% | 0.920 | 17% | 0% | 0 | 0 | 0 |
| **judge / queries-best** | **95%** | **95%** | **95%** | **0.955** | **83%** | **100%** | 650 | 1030 | 0 |

Tokens: 680,613 judge input tokens for the whole run (question plus every keyword variant), which
is about $0.03 at $0.042 per 1M.

Remaining misses:
- **Terse keyword queries lose context.** "europe slow page load" and "eu latency atlas web" come
  back judged-empty, while the full natural-language question finds the answer at rank 1. The
  judge works best with complete questions, so agents should pass the user's question through
  rather than keywords.
- **`graph-hop-overview-basename-disambiguation`** (question) ranks the right overview 2nd,
  behind the monolith note that links to it.
- **`negative-atlas-mobile-language`** returns the Atlas Web overview rather than abstaining.
- **`body-hit-atlas-state-library`** ("atlas web state library") is judged-empty.

This run used the old placeholder threshold 0.5. The calibrated default is now 0.7 (see Threshold sweep).

### Threshold sweep

```bash
JEV_API_KEY=... MINK_RECALL_RERANK_BASE_URL=https://ai-gateway.vercel.sh/typesafe \
  bun run eval:retrieval --sweep            # arms default to strict,wide,judge
bun run eval:retrieval --arms judge --sweep --json
```

`--sweep` needs the judge arm. It runs that arm **once** with `minRelevance = 0`, keeps each
result's judged `relevance`, then re-derives every ranked list offline for thresholds 0.1 to 0.9
(step 0.1) by dropping results below the threshold. hit@1, hit@3, MRR, abstention and adv-pass are
recomputed per scope for each threshold, so a full sweep costs one judge pass. `--min-relevance` is
rejected with `--sweep`.

The recommendation line is the highest threshold that maximises negative abstention (question
scope) without pushing positive hit@3 below its value at 0.1. Because the gateway floats
`jev-latest`, repeat the sweep when the model changes or scores shift unexpectedly.

Calibration run: 2026-09-30, `jev-latest` via the Vercel AI Gateway, fixture vault (28 cases).

| threshold | question hit@1 / hit@3 / abstain | queries-avg hit@1 / hit@3 / abstain | queries-best hit@1 / abstain |
| --- | --- | --- | --- |
| 0.1–0.4 | 95% / 100% / 83% | 95% / 98% / 83–92% | 100% / 83% |
| 0.5 (old default) | 95% / 100% / 83% | 90% / 93% / 92% | 95% / 83% |
| 0.6 | 95% / 100% / **100%** | 90% / 93% / 92% | 95% / 83% |
| **0.7 (default)** | **95% / 100% / 100%** | **90% / 93% / 100%** | **95% / 100%** |
| 0.8 | 95% / 100% / 100% | 86% / 88% / 100% | — |
| 0.9 | 86% / 91% / 100% | 69% / 69% / 100% | — |

The adversarial note never ranks first at any threshold.

Recommended `recall.rerank-min-relevance`: **0.7**. The sweep's automatic rule (question scope
only) picks 0.8, but 0.8 costs keyword-query hits (queries-avg hit@3 falls from 93% to 88%). 0.7 is
the highest threshold that is perfect on full questions without losing any keyword-query hit
relative to 0.5, and it is at least as good as 0.5 and 0.6 in every scope. Caveat: the fixture has
only 6 negative cases, so treat this as a sensible default rather than a precise optimum. Re-run
the sweep on model changes.
