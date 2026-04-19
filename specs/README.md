# Mink — Feature Specifications

Mink is a hidden presence that moves alongside the developer. It has two missions:

1. **Token Efficiency** — Reduce token consumption for AI coding assistants by intercepting tool lifecycle events, maintaining structured state files, and enforcing learned rules. Hooks collect metadata, surface context before actions, prevent waste, and track usage over time.

2. **Cross-Project Wiki** — Every piece of knowledge Mink ingests is incrementally written to a user-owned wiki (markdown vault) that spans all projects. The wiki is portable — usable as an Obsidian vault, browsable in any markdown reader, and backupable to git.

## Specification Index

| # | Spec | Domain |
|---|------|--------|
| 01 | [Session Lifecycle](./01-session-lifecycle.md) | Core |
| 02 | [File Index](./02-file-index.md) | Core |
| 03 | [Learning Memory](./03-learning-memory.md) | Core |
| 04 | [Token Ledger](./04-token-ledger.md) | Core |
| 05 | [Read Intelligence](./05-read-intelligence.md) | Hooks |
| 06 | [Write Enforcement](./06-write-enforcement.md) | Hooks |
| 07 | [Bug Memory](./07-bug-memory.md) | Knowledge |
| 08 | [Action Log](./08-action-log.md) | Knowledge |
| 09 | [Waste Detection](./09-waste-detection.md) | Analytics |
| 10 | [Background Scheduler](./10-background-scheduler.md) | Automation |
| 11 | [CLI Interface](./11-cli-interface.md) | Interface |
| 12 | [Dashboard](./12-dashboard.md) | Interface |
| 13 | [Design Evaluation](./13-design-evaluation.md) | Optional |
| 14 | [Framework Advisor](./14-framework-advisor.md) | Optional |
| 15 | [Cross-Project Wiki](./15-cross-project-wiki.md) | Wiki |
| 16 | [Test Plan](./16-test-plan.md) | Quality |
| 17 | [Companion Channels](./17-companion-channels.md) | Wiki |
| 18 | [Configuration Surface](./18-configuration-surface.md) | Core |

## Active Delivery Plans

Transient, implementation-oriented plans — delete once delivered.

- [PLAN.md](./PLAN.md) — Wiring PR #39's preview panels (wiki, capture, sync, discord, daemon, config) to real backends.

## Conventions

- Specs describe **what** the system must do, not **how** to implement it.
- No technology names appear in acceptance criteria.
- Each spec follows: Overview, Capabilities, Acceptance Criteria, Edge Cases, Test Requirements.
- Acceptance criteria use Given/When/Then format where behavior is testable.
