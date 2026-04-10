# Mink

A hidden presence that moves alongside the developer.

Mink is a lightweight companion for AI coding assistants like [Claude Code](https://claude.ai/code). It hooks into the assistant's lifecycle events to reduce token waste, enforce learned rules, and build a portable knowledge base across all your projects.

## Why Mink?

AI coding assistants consume tokens every time they read a file, write code, or reason about your project. Much of this is redundant: re-reading files already seen, repeating mistakes that were already corrected, and lacking context that was available in a previous session.

Mink intercepts these lifecycle events and maintains structured state so the assistant can work smarter:

- **Track what was already read** and warn before redundant re-reads
- **Remember past mistakes** and surface them before they're repeated
- **Enforce learned rules** extracted from corrections you've already given
- **Log every action** with token cost estimates so you can see where tokens go
- **Build a cross-project wiki** that accumulates knowledge across all your projects

## How It Works

Mink registers as a set of [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) that fire on session start, file reads, file writes, and session stop. Each hook is a lightweight CLI call that reads and updates JSON state files stored in `~/.mink/`.

```
Session Start           Read a File              Write a File            Session Stop
     |                       |                        |                       |
     v                       v                        v                       v
 Create fresh          Check file index          Check learning         Build summary
 session state         Track read count          memory rules           Calculate savings
 Log to action log     Warn on repeats           Surface past bugs      Append to ledger
                       Estimate tokens           Estimate tokens        Emit reminders
```

All state lives in `~/.mink/` -- nothing is stored in your project repository.

## Current Status

Mink is in early development. The session lifecycle (spec 01) is implemented. Remaining specs are designed and documented in `specs/`.

| Domain | Specs | Status |
|--------|-------|--------|
| Core | Session Lifecycle, File Index, Learning Memory, Token Ledger | Session Lifecycle implemented |
| Hooks | Read Intelligence, Write Enforcement | Designed |
| Knowledge | Bug Memory, Action Log | Designed |
| Analytics | Waste Detection | Designed |
| Automation | Background Scheduler | Designed |
| Interfaces | CLI Commands, Dashboard | Designed |
| Wiki | Cross-Project Wiki | Designed |
| Quality | Test Plan | Designed |

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/) (recommended for faster hook execution)
- [Claude Code](https://claude.ai/code)

### Install

```bash
# With Bun (recommended)
bun add -g mink

# With npm
npm install -g mink
```

### Initialize in a project

From your project root:

```bash
mink init
```

This will:

1. Detect your runtime (Bun if available, otherwise Node.js)
2. Create your project's state directory at `~/.mink/projects/<project-slug>/`
3. Register Mink's hooks in `.claude/settings.json`

```
[mink] initialized
  project:  my-project-a3f2b1
  state:    /Users/you/.mink/projects/my-project-a3f2b1
  runtime:  bun
  hooks:    /Users/you/dev/my-project/.claude/settings.json
```

That's it. Mink runs automatically in the background during your Claude Code sessions.

### Verify it's working

Start a new Claude Code session in your project. Mink will create a `session.json` in your project's state directory:

```bash
cat ~/.mink/projects/*/session.json
```

You should see a fresh session state with a unique ID, timestamp, and zeroed counters.

## Architecture

### State Directory

```
~/.mink/
├── config.json                        # Global config (future)
├── projects/
│   └── my-project-a3f2b1/
│       ├── session.json               # Ephemeral session state
│       ├── token-ledger.json          # Persistent usage history
│       ├── action-log.md              # Human-readable action history
│       ├── learning-memory.md         # Accumulated project knowledge
│       ├── bug-memory.json            # Past bugs and fixes
│       └── file-index.json            # File descriptions and metadata
```

### Project Identification

Each project gets a deterministic, human-readable identifier: the slugified directory name plus a 6-character hash of the absolute path. This means:

- `my-project` in `/Users/drew/dev/` becomes `my-project-a3f2b1`
- `my-project` in `/Users/drew/work/` gets a different hash, avoiding collisions
- Moving a project changes its ID (re-run `mink init`)

### Crash Safety

All JSON writes use atomic temp-file-then-rename. If the process dies mid-write, only the `.tmp` file is affected -- the original state file remains intact.

### Hook Integration

Mink hooks into Claude Code via `.claude/settings.json`:

| Claude Code Event | Mink Command | Purpose |
|-------------------|--------------|---------|
| `SessionStart` | `mink session-start` | Create fresh session state |
| `Stop` | `mink session-stop` | Finalize session, calculate savings |
| `PreToolUse` (Read) | `mink on-read` (future) | Track reads, warn on repeats |
| `PostToolUse` (Write) | `mink on-write` (future) | Enforce rules, log bugs |

## Development

### Setup

```bash
git clone git@github.com:drewpayment/mink.git
cd mink
bun install
```

### Run tests

```bash
# Run all tests
bun test

# Watch mode
bun test --watch

# Run a specific test file
bun test tests/unit/session.test.ts
```

### Project structure

```
mink/
├── src/
│   ├── cli.ts                # Entry point, command routing
│   ├── commands/
│   │   ├── init.ts           # mink init -- runtime detection, hook wiring
│   │   ├── session-start.ts  # Hook: create fresh session state
│   │   └── session-stop.ts   # Hook: finalize session, emit reminders
│   ├── core/
│   │   ├── session.ts        # Session state CRUD, summary, savings calc
│   │   ├── paths.ts          # ~/.mink path resolution
│   │   ├── project-id.ts     # Slug + hash project ID generation
│   │   └── fs-utils.ts       # Atomic JSON write, safe read
│   └── types/
│       └── session.ts        # TypeScript interfaces
├── tests/
│   ├── unit/                 # Unit tests per module
│   └── integration/          # Full lifecycle tests
├── specs/                    # Feature specifications (technology-agnostic)
└── docs/                     # Design docs and implementation plans
```

## Contributing

### Specs-first development

Mink follows a specs-first approach. All feature specifications live in `specs/` and describe **what** to build, not how. Each spec follows a consistent format: Overview, Capabilities, Acceptance Criteria (Given/When/Then), Edge Cases, and Test Requirements.

Before implementing a new feature:

1. Read the relevant spec in `specs/`
2. Check if a design doc exists in `docs/superpowers/specs/`
3. Check if an implementation plan exists in `docs/superpowers/plans/`

### Guidelines

- **TypeScript** with strict mode enabled
- **Bun** as runtime, test runner, and package manager
- **TDD** -- write failing tests first, then implement
- **Atomic commits** -- one logical change per commit
- **No state in project repos** -- all Mink state goes in `~/.mink/`
- **Crash-safe I/O** -- use `atomicWriteJson` from `src/core/fs-utils.ts` for all JSON writes
- **Graceful degradation** -- missing or corrupt state files should log warnings, not crash

### Running the full lifecycle locally

```bash
# Initialize mink for this repo
bun src/cli.ts init

# Simulate a session
bun src/cli.ts session-start
cat ~/.mink/projects/mink-*/session.json

bun src/cli.ts session-stop
cat ~/.mink/projects/mink-*/session.json
```

### Adding a new spec implementation

Each spec follows this workflow:

1. **Design** -- Brainstorm approaches, document decisions in `docs/superpowers/specs/`
2. **Plan** -- Break down into bite-sized tasks in `docs/superpowers/plans/`
3. **Implement** -- Follow the plan task by task using TDD
4. **Review** -- Verify spec compliance and code quality

## Specifications

| # | Spec | Domain | Status |
|---|------|--------|--------|
| 01 | [Session Lifecycle](./specs/01-session-lifecycle.md) | Core | Implemented |
| 02 | [File Index](./specs/02-file-index.md) | Core | Designed |
| 03 | [Learning Memory](./specs/03-learning-memory.md) | Core | Designed |
| 04 | [Token Ledger](./specs/04-token-ledger.md) | Core | Designed |
| 05 | [Read Intelligence](./specs/05-read-intelligence.md) | Hooks | Designed |
| 06 | [Write Enforcement](./specs/06-write-enforcement.md) | Hooks | Designed |
| 07 | [Bug Memory](./specs/07-bug-memory.md) | Knowledge | Designed |
| 08 | [Action Log](./specs/08-action-log.md) | Knowledge | Designed |
| 09 | [Waste Detection](./specs/09-waste-detection.md) | Analytics | Designed |
| 10 | [Background Scheduler](./specs/10-background-scheduler.md) | Automation | Designed |
| 11 | [CLI Interface](./specs/11-cli-interface.md) | Interface | Designed |
| 12 | [Dashboard](./specs/12-dashboard.md) | Interface | Designed |
| 13 | [Design Evaluation](./specs/13-design-evaluation.md) | Optional | Designed |
| 14 | [Framework Advisor](./specs/14-framework-advisor.md) | Optional | Designed |
| 15 | [Cross-Project Wiki](./specs/15-cross-project-wiki.md) | Wiki | Designed |
| 16 | [Test Plan](./specs/16-test-plan.md) | Quality | Designed |

## License

MIT
