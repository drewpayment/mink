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
