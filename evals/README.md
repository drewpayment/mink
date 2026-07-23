# mink-agent retrieval eval

A small eval harness that measures whether `mink-agent` (the prompt in
`agents/mink-agent.md.tmpl`) actually finds things in the vault, instead of
vibes-checking it by hand. See
`docs/plans/2026-07-agent-retrieval-and-chat.md` (Phase 2) for the plan this
implements.

## What's here

- `fixtures/vault/` — a ~26-note fixture wiki, in the real PARA layout
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
    agent prompt now instructs.
  - An **aliased note**: `areas/sec-checklist.md` has H1 `# Security
    Checklist` and `aliases: [Security Checklist, Sec Checklist]` in its
    frontmatter — title differs from the filename slug.
  - A graph of `[[wikilinks]]` connecting most notes, so backlink/related
    "one more hop" questions are answerable (e.g. the on-call escalation
    policy is only reachable by hopping from `areas/oncall-rotation.md` to
    `resources/oncall-escalation-matrix.md`).
  - One intentionally orphaned inbox note (`inbox/quick-thought-graphql-gateway.md`)
    — realistic vault noise, not referenced by any case.
- `cases.json` — 15 question/answer cases: 4 `title-hit`, 6 `body-hit`, 3
  `graph-hop`, 2 `negative`. Each case has `expected_paths` (any-of) and
  `expected_substrings` (any-of); a case passes if the transcript contains
  **any** expected path or **any** expected substring. Negative cases'
  `expected_substrings` are "I didn't find this" admission phrases — a
  negative case should only pass if the agent admits it couldn't find an
  answer, not because it happened to mention an unrelated word.
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
  installed there before the run (or removes the file if nothing was).

## Running it

```bash
npm run eval:agent                              # full run, claude engine
npm run eval:agent -- --dry-run                  # no CLI calls, no tokens — sanity-checks fixtures/template
npm run eval:agent -- --case body-hit-rate-limiter-algorithm
npm run eval:agent -- --limit 3
npm run eval:agent -- --keep-tmp                 # leave the temp fixture instance on disk for inspection
npm run eval:agent -- --no-install               # skip (re)installing mink-agent; assumes it's already current
```

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
  agent definitions from; there's no per-invocation override. The runner
  backs up whatever's installed there before overwriting it and restores it
  (or removes the file if nothing existed) in a `finally` block, so a normal
  run — including one that crashes or is Ctrl-C'd mid-flight from a shell
  that still delivers signals to the finally block — leaves your real
  installed agent definition untouched. Pass `--no-install` to skip this
  entirely if you've already installed the definition you want tested via
  `mink agent`.

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
15/15 passing. Track that as the acceptance signal for "Phase 2 is done".

## Adding cases

Add an entry to `cases.json` with a unique `id`, a `category` (`title-hit`,
`body-hit`, `graph-hop`, or `negative`), the `question`, and `expected_paths`
/ `expected_substrings` (either can be empty, but at least one non-empty
list is required for anything but a negative case). If the fact you're
testing doesn't exist in the fixture vault yet, add a note for it under
`fixtures/vault/` in the matching PARA folder first.
