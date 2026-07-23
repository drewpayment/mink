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
- `cases.json` — 16 question/answer cases: 4 `title-hit`, 6 `body-hit`, 4
  `graph-hop`, 2 `negative`. Grading is **not** simple any-of-substring-or-path:
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
16/16 passing. Track that as the acceptance signal for "Phase 2 is done".

## Adding cases

Add an entry to `cases.json` with a unique `id`, a `category` (`title-hit`,
`body-hit`, `graph-hop`, or `negative`), the `question`, and `expected_paths`
/ `expected_substrings` (either can be empty, but at least one non-empty
list is required for anything but a negative case). If the fact you're
testing doesn't exist in the fixture vault yet, add a note for it under
`fixtures/vault/` in the matching PARA folder first.
