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
- **Detect token waste** and surface patterns of inefficiency
- **Run background tasks** on a schedule to keep state fresh
- **Visualize everything** in a real-time web dashboard
- **Evaluate UI designs** with automated multi-viewport screenshots
- **Advise on frameworks** with a decision tree and migration guides
- **Build a cross-project wiki** that accumulates knowledge across all your projects

## How It Works

Mink registers as a set of [Claude Code hooks](https://docs.anthropic.com/en/docs/claude-code/hooks) that fire on key lifecycle events. Each hook is a lightweight CLI call that reads and updates JSON state files stored in `~/.mink/`.

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

## Features

### Core State Management
- **Session Lifecycle** — Tracks session start/stop, token counts, and file operations
- **File Index** — Scans and indexes project files with descriptions and metadata
- **Learning Memory** — Four-section knowledge store: preferences, learnings, do-not-repeat, and decision log
- **Token Ledger** — Persistent usage history with per-session breakdowns and savings calculations

### Intelligent Hooks
- **Read Intelligence** — Tracks file reads, warns on redundant re-reads, estimates token cost
- **Write Enforcement** — Enforces learned rules on writes, surfaces past bugs for relevant files

### Knowledge & Analytics
- **Bug Memory** — Tracks bugs, fixes, root causes, and tags for searchable history
- **Action Log** — Human-readable chronological log of all session activity
- **Waste Detection** — Identifies patterns of token waste (repeated reads, large file scans, etc.)

### Automation
- **Background Scheduler** — Daemon process with cron-based task scheduling, retry logic with exponential backoff, and a dead letter queue for failed tasks
- **Built-in Tasks** — File index rescan, action log consolidation, waste detection, learning memory reflection, and project suggestions — all on configurable schedules

### Interfaces
- **CLI** — 20+ commands covering lifecycle hooks, state management, scheduling, configuration, backup/restore, and more
- **Real-time Dashboard** — Web UI with 10 panels, SSE live updates, light/dark themes, virtual scrolling, and interactive charts

### Advanced
- **Design Evaluation** — Automated multi-viewport screenshot capture with server and route detection (uses Puppeteer)
- **Framework Advisor** — Decision tree, framework catalog, comparison matrix, and migration prompts for UI framework selection

## Current Status

Specs 1–14 are fully implemented and tested. Remaining specs (wiki, test plan) are designed and documented in `specs/`.

| Domain | Specs | Status |
|--------|-------|--------|
| Core | Session Lifecycle, File Index, Learning Memory, Token Ledger | Implemented |
| Hooks | Read Intelligence, Write Enforcement | Implemented |
| Knowledge | Bug Memory, Action Log | Implemented |
| Analytics | Waste Detection | Implemented |
| Automation | Background Scheduler | Implemented |
| Interfaces | CLI Commands, Dashboard | Implemented |
| Advanced | Design Evaluation, Framework Advisor | Implemented |
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
├── config.json                        # Global user configuration
├── projects/
│   └── my-project-a3f2b1/
│       ├── session.json               # Ephemeral session state
│       ├── file-index.json            # File descriptions and metadata
│       ├── learning-memory.md         # Accumulated project knowledge (4 sections)
│       ├── token-ledger.json          # Persistent usage history
│       ├── action-log.md              # Human-readable action history
│       ├── bug-memory.json            # Past bugs, fixes, and root causes
│       ├── scheduler.json             # Scheduler manifest and task state
│       ├── daemon.pid                 # Background daemon PID
│       ├── backups/                   # State backups for restore
│       └── screenshots/              # Design evaluation captures
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
| `PreToolUse` (Read) | `mink pre-read` | Check file index, warn on repeat reads |
| `PostToolUse` (Read) | `mink post-read` | Track read, estimate tokens |
| `PreToolUse` (Write/Edit) | `mink pre-write` | Enforce learned rules, surface past bugs |
| `PostToolUse` (Write/Edit) | `mink post-write` | Log write, update file index |

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
│   ├── cli.ts                # Entry point, command routing (20+ commands)
│   ├── commands/             # CLI command implementations
│   │   ├── init.ts           # mink init — runtime detection, hook wiring
│   │   ├── session-start.ts  # Hook: create fresh session state
│   │   ├── session-stop.ts   # Hook: finalize session, emit reminders
│   │   ├── pre-read.ts       # Hook: file read intelligence
│   │   ├── post-read.ts      # Hook: post-read tracking
│   │   ├── pre-write.ts      # Hook: write enforcement
│   │   ├── post-write.ts     # Hook: post-write tracking
│   │   ├── status.ts         # Project health display
│   │   ├── scan.ts           # Force full file index rescan
│   │   ├── config.ts         # Global configuration management
│   │   ├── cron.ts           # Scheduled task management
│   │   ├── daemon.ts         # Background daemon control
│   │   ├── dashboard.ts      # Real-time web dashboard
│   │   ├── designqc.ts       # Design evaluation screenshots
│   │   ├── framework-advisor.ts # Framework advisor CLI
│   │   ├── detect-waste.ts   # Token waste analysis
│   │   ├── bug-search.ts     # Bug log search
│   │   ├── reflect.ts        # Learning memory reflection
│   │   ├── update.ts         # Cross-project update
│   │   └── restore.ts        # State restoration from backup
│   ├── core/                 # Core library modules
│   │   ├── session.ts        # Session state CRUD, summary, savings
│   │   ├── paths.ts          # ~/.mink path resolution
│   │   ├── project-id.ts     # Slug + hash project ID generation
│   │   ├── fs-utils.ts       # Atomic JSON write, safe read
│   │   ├── index-store.ts    # File index management
│   │   ├── scanner.ts        # Project file scanner
│   │   ├── learning-memory.ts # Learning memory operations
│   │   ├── token-ledger.ts   # Token usage tracking
│   │   ├── action-log.ts     # Action log management
│   │   ├── bug-memory.ts     # Bug memory operations
│   │   ├── waste-detection.ts # Waste pattern detection
│   │   ├── pattern-engine.ts # Learned pattern matching
│   │   ├── scheduler.ts      # Cron-based task scheduler
│   │   ├── daemon.ts         # Daemon process management
│   │   ├── cron-parser.ts    # Cron expression parsing
│   │   ├── task-registry.ts  # Built-in task definitions
│   │   ├── dashboard-server.ts # Dashboard HTTP server
│   │   ├── dashboard-api.ts  # Dashboard REST API + SSE
│   │   ├── design-eval/      # Screenshot capture, route/server detection
│   │   ├── framework-advisor/ # Catalog, decision tree, migration prompts
│   │   └── ...               # Global config, backup, reflection, etc.
│   ├── dashboard/            # Embedded dashboard UI (HTML/CSS/JS generation)
│   │   ├── get-dashboard-html.ts  # Main HTML assembly
│   │   ├── panel-*.ts        # 10 panel implementations
│   │   ├── css-*.ts          # Base styles and themes
│   │   └── js-*.ts           # Charts, SSE, virtual scroll, search
│   └── types/                # TypeScript interfaces
├── tests/
│   ├── unit/                 # 35+ unit test files
│   └── integration/          # 15+ integration test files
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

# Start the dashboard
bun src/cli.ts dashboard --port 3333

# Start the background daemon
bun src/cli.ts daemon start

# Check project status
bun src/cli.ts status

# Run a waste detection scan
bun src/cli.ts detect-waste
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
| 02 | [File Index](./specs/02-file-index.md) | Core | Implemented |
| 03 | [Learning Memory](./specs/03-learning-memory.md) | Core | Implemented |
| 04 | [Token Ledger](./specs/04-token-ledger.md) | Core | Implemented |
| 05 | [Read Intelligence](./specs/05-read-intelligence.md) | Hooks | Implemented |
| 06 | [Write Enforcement](./specs/06-write-enforcement.md) | Hooks | Implemented |
| 07 | [Bug Memory](./specs/07-bug-memory.md) | Knowledge | Implemented |
| 08 | [Action Log](./specs/08-action-log.md) | Knowledge | Implemented |
| 09 | [Waste Detection](./specs/09-waste-detection.md) | Analytics | Implemented |
| 10 | [Background Scheduler](./specs/10-background-scheduler.md) | Automation | Implemented |
| 11 | [CLI Interface](./specs/11-cli-interface.md) | Interface | Implemented |
| 12 | [Dashboard](./specs/12-dashboard.md) | Interface | Implemented |
| 13 | [Design Evaluation](./specs/13-design-evaluation.md) | Advanced | Implemented |
| 14 | [Framework Advisor](./specs/14-framework-advisor.md) | Advanced | Implemented |
| 15 | [Cross-Project Wiki](./specs/15-cross-project-wiki.md) | Wiki | Designed |
| 16 | [Test Plan](./specs/16-test-plan.md) | Quality | Designed |

## License

MIT
