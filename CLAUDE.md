# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Mink — a hidden presence that moves alongside the developer. Two missions:

1. **Token Efficiency** — Reduce AI coding assistant token consumption via lifecycle hooks that maintain structured state files (file index, learning memory, bug memory, token ledger) and enforce learned rules.
2. **Cross-Project Wiki** — Incrementally build a user-owned markdown vault spanning all projects, compatible with Obsidian and any markdown reader, backupable to git.

## Specifications

All feature specs live in `specs/`. See `specs/README.md` for the full index. Specs are technology-agnostic — they describe what to build, not how.

Key domains:
- **Core** (specs 01-04): Session lifecycle, file index, learning memory, token ledger
- **Hooks** (specs 05-06): Read intelligence, write enforcement
- **Knowledge** (specs 07-08): Bug memory, action log
- **Analytics** (spec 09): Waste detection
- **Automation** (spec 10): Background scheduler with cron, retry, dead letter
- **Interfaces** (specs 11-12): CLI commands, real-time dashboard
- **Optional** (specs 13-14): Design evaluation (screenshots), framework advisor
- **Wiki** (spec 15): Cross-project wiki — unique to Mink
- **Quality** (spec 16): Test plan covering all gaps from reference implementation

## Git Workflow

- **Always commit and push work to a feature branch.** When work is ready to share, commit it, push the branch, and open a PR targeting `main` without waiting for further confirmation.
- **Never push directly to `main`.** Only human intervention pushes to `main`. Claude must never push to `main`, force-push to `main`, or merge a PR into `main`.
- Feature branches should be created for each spec or logical unit of work. Use the existing naming convention (`spec/...`, `feat/...`, `fix/...`, `docs/...`, `chore/...`).

## Release Process

Two release paths, both driven by `.github/workflows/release.yml`. npm publishes use OIDC trusted publishing with provenance — no PAT/token to manage.

### Production releases (latest dist-tag)

Fully automated via release-please:

1. Land conventional-commit work on `main` (via merged feature PRs).
2. release-please bot opens a `chore(main): release X.Y.Z` PR that bumps `package.json` and updates `CHANGELOG.md`.
3. **Human merges the release PR.** This is the only place `main` gets pushed to. Claude must never merge it.
4. The merge triggers the `publish-from-release-please` job, which builds, tests, builds the dashboard, and runs `npm publish` under the `latest` dist-tag.

Don't manually bump versions on `main` — release-please owns that file.

### Beta / pre-release publishes (any feature branch)

Manual workflow_dispatch from any branch. The pre-release version in `package.json` is the only thing controlling the dist-tag:

1. Bump `package.json` to a pre-release identifier (e.g., `0.12.0-beta.5`, `0.13.0-rc.1`, `0.14.0-alpha.2`).
2. Commit with `chore(release): X.Y.Z-<id>.N` and a body summarising what changed since the previous pre-release.
3. Push the feature branch.
4. Trigger the publish-prerelease job:
   ```
   gh workflow run release.yml --ref <branch>
   ```
   The job derives the dist-tag from the pre-release identifier (`-beta.N` → `beta`, `-rc.N` → `rc`, `-alpha.N` → `alpha`). To override, pass `-f dist_tag=<tag>`. It refuses to publish under `latest` from this path.
5. Confirm the run succeeded: `gh run list --workflow=release.yml --branch=<branch> --limit 1`.

Constraints baked into the workflow:
- The version in `package.json` MUST carry a pre-release identifier when triggered via workflow_dispatch — the job exits 1 otherwise.
- `dist_tag` of `latest` is rejected explicitly to protect production users.
- Tests run before publish; pre-existing local-only test failures (host daemon pollution, dashboard build artefacts) pass in CI because the workflow builds the dashboard first and runs on a clean runner.

Install a beta from npm:
```
npm i -g @drewpayment/mink@beta
```
