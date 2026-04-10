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
