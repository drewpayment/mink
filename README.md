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
- **Capture notes from anywhere** with an AI-powered Claude Code skill that categorizes, tags, and links notes automatically

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
- **CLI** — 25+ commands covering lifecycle hooks, state management, notes/wiki, scheduling, configuration, backup/restore, and more
- **Real-time Dashboard** — Web UI with 10 panels, SSE live updates, light/dark themes, virtual scrolling, and interactive charts

### Notes & Wiki
- **Wiki Vault** — Obsidian-compatible markdown vault that accumulates knowledge across all projects
- **Note Capture** — `mink note` CLI captures notes from any directory into the vault
- **Claude Code Skill** — `/mink:note` skill uses Claude as the AI brain for intelligent categorization, tagging, and wikilink insertion
- **Daily Notes** — `mink note --daily` creates or appends to daily journal entries
- **Vault Index** — Token-efficient file index for the vault, with search and tag aggregation
- **Git Backup** — Auto-commit and push vault changes on session end
- **Templates** — 6 built-in templates (quick-capture, daily, meeting, project, area, person)

### Advanced
- **Design Evaluation** — Automated multi-viewport screenshot capture with server and route detection (uses Puppeteer)
- **Framework Advisor** — Decision tree, framework catalog, comparison matrix, and migration prompts for UI framework selection

## Current Status

Specs 1–15 are fully implemented and tested. The test plan spec (16) is designed and documented in `specs/`.

| Domain | Specs | Status |
|--------|-------|--------|
| Core | Session Lifecycle, File Index, Learning Memory, Token Ledger | Implemented |
| Hooks | Read Intelligence, Write Enforcement | Implemented |
| Knowledge | Bug Memory, Action Log | Implemented |
| Analytics | Waste Detection | Implemented |
| Automation | Background Scheduler | Implemented |
| Interfaces | CLI Commands, Dashboard | Implemented |
| Advanced | Design Evaluation, Framework Advisor | Implemented |
| Wiki | Cross-Project Wiki & Notes | Implemented |
| Quality | Test Plan | Designed |

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18+ or [Bun](https://bun.sh/) (recommended for faster hook execution)
- [Claude Code](https://claude.ai/code)

### Install

```bash
# With Bun (recommended)
bun add -g @drewpayment/mink

# With npm
npm install -g @drewpayment/mink
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

## Notes & Wiki

Mink includes a notes and wiki system that builds a portable, Obsidian-compatible knowledge base across all your projects. Notes can be captured from any directory and are automatically organized into a structured vault.

### Set up the vault

```bash
# Create a new vault (default: ~/.mink/wiki/)
mink wiki init

# Or point to an existing Obsidian vault / notes directory
mink wiki init ~/dev/notes
```

This creates the vault structure, seeds templates, and builds a file index. If you point to an existing directory, Mink scans and indexes all markdown files without modifying them.

### Capture notes

The `mink note` command captures notes from any directory into your vault:

```bash
# Quick capture — lands in inbox/
mink note "API rate limiting needs investigation"

# Structured note with title and body
mink note --title "JWT Cookie Pattern" --body "Use httpOnly cookies for token storage..."

# Link to the current Mink project
mink note --project my-api "Retry logic needs exponential backoff"

# Daily journal
mink note --daily "Had a breakthrough on the caching layer"
mink note --daily                    # Create today's daily note (empty template)

# From a template
mink note --template meeting --title "Sprint Planning 2026-04-12"

# With explicit category and tags
mink note --category resources --tags "auth,security" --title "OAuth2 Flow Reference"

# Ingest an existing file into the vault
mink note --file ./scratch-notes.md --category resources
```

### Use the Claude Code skill

The `/mink:note` skill is the recommended way to capture notes. It uses Claude as the AI brain to automatically determine category, tags, title, and wikilinks.

```bash
# Install the skill globally
mink skill install
```

Then in any Claude Code session:

```
/mink:note I had a meeting with Sarah about the CMS migration timeline.
           She wants to target Q3 for the cutover.
```

Claude will analyze the content, check existing notes for related topics and people, and run `mink note` with the right flags — placing the note in the correct category with tags and `[[wikilinks]]` to related notes.

### Browse and search

```bash
# List recent notes
mink note list --recent 10

# Filter by category or tag
mink note list --category projects
mink note list --tag meeting

# Full-text search
mink note search "authentication"
```

### Vault structure

```
vault-root/
  _index.md              # Master index (auto-maintained)
  inbox/                  # Quick captures land here
  projects/               # Project-linked notes + Mink-generated wiki pages
    my-api/
      overview.md         # Auto-created on mink init
      sessions/           # Daily session summaries
      *.md                # Your project notes
  areas/                  # Ongoing responsibilities
    daily/                # Daily notes (areas/daily/2026-04-12.md)
  resources/              # Reference material
  archives/               # Completed/inactive
  templates/              # Note templates
  patterns/               # Cross-project patterns
```

### Obsidian compatibility

The vault is a standard markdown directory fully compatible with Obsidian:

- **Wikilinks** — `[[Note Title]]` syntax for internal links
- **YAML frontmatter** — `created`, `updated`, `tags`, `category` fields
- **Graph view** — Wikilinks render as connections in Obsidian's knowledge graph
- **Templates** — Compatible with Obsidian's Templater plugin (`{{variable}}` syntax)

Open the vault directory as an Obsidian vault and everything works out of the box.

### Git backup

Enable automatic git backup to sync your vault across machines:

```bash
# Enable git backup
mink config wiki.git-backup true

# Set the remote (default: origin)
mink config wiki.git-remote origin
```

When enabled, Mink auto-commits and pushes vault changes at the end of each session. Pushes are best-effort with a 10-second timeout — if the push fails, the local commit is preserved and will be included in the next push.

### Hook integration

When the wiki is enabled, Mink hooks automatically:

- **On session start** — Report inbox count if notes need categorization
- **On session end** — Write a session summary to `projects/{slug}/sessions/{date}.md`
- **On `mink init`** — Create a project overview page in the vault

### Configuration

```bash
# View all wiki/notes settings
mink config

# Set vault location
mink config wiki.path ~/my-notes

# Disable the wiki feature
mink config wiki.enabled false

# Set default category for CLI captures (default: inbox)
mink config notes.default-category inbox
```

| Setting | Default | Env Override | Description |
|---------|---------|-------------|-------------|
| `wiki.path` | `~/.mink/wiki/` | `MINK_WIKI_PATH` | Vault directory |
| `wiki.enabled` | `true` | `MINK_WIKI_ENABLED` | Toggle wiki feature |
| `wiki.sync-mode` | `immediate` | `MINK_WIKI_SYNC_MODE` | Update timing |
| `wiki.git-backup` | `false` | `MINK_WIKI_GIT_BACKUP` | Auto-commit and push |
| `wiki.git-remote` | `origin` | `MINK_WIKI_GIT_REMOTE` | Git remote for push |
| `notes.default-category` | `inbox` | `MINK_NOTES_DEFAULT_CATEGORY` | Default note category |

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
│   ├── cli.ts                # Entry point, command routing (25+ commands)
│   ├── commands/             # CLI command implementations
│   │   ├── init.ts           # mink init — runtime detection, hook wiring
│   │   ├── session-start.ts  # Hook: create fresh session state
│   │   ├── session-stop.ts   # Hook: finalize session, emit reminders
│   │   ├── pre-read.ts       # Hook: file read intelligence
│   │   ├── post-read.ts      # Hook: post-read tracking
│   │   ├── pre-write.ts      # Hook: write enforcement
│   │   ├── post-write.ts     # Hook: post-write tracking
│   │   ├── wiki.ts           # Wiki vault management (init, status, rebuild, organize)
│   │   ├── note.ts           # Note capture, list, and search
│   │   ├── skill.ts          # Claude Code skill installer
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
│   │   ├── vault.ts          # Wiki vault path resolution and structure
│   │   ├── vault-templates.ts # Note template management
│   │   ├── note-writer.ts    # Note creation, frontmatter, daily notes
│   │   ├── note-linker.ts    # Wikilink extraction, insertion, backlinks
│   │   ├── note-index.ts     # Vault file index with search
│   │   └── ...               # Global config, backup, reflection, etc.
│   ├── dashboard/            # Embedded dashboard UI (HTML/CSS/JS generation)
│   │   ├── get-dashboard-html.ts  # Main HTML assembly
│   │   ├── panel-*.ts        # 10 panel implementations
│   │   ├── css-*.ts          # Base styles and themes
│   │   └── js-*.ts           # Charts, SSE, virtual scroll, search
│   ├── skills/               # Claude Code skill files
│   │   └── mink-note.md      # /mink:note skill for intelligent note capture
│   └── types/                # TypeScript interfaces
├── tests/
│   ├── unit/                 # 40+ unit test files
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

# Set up the wiki vault and capture notes
bun src/cli.ts wiki init
bun src/cli.ts note "Testing the notes feature"
bun src/cli.ts note --daily "Today I worked on mink"
bun src/cli.ts note list --recent 5
bun src/cli.ts note search "testing"

# Install the Claude Code skill
bun src/cli.ts skill install
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
| 15 | [Cross-Project Wiki](./specs/15-cross-project-wiki.md) | Wiki | Implemented |
| 16 | [Test Plan](./specs/16-test-plan.md) | Quality | Designed |

## License

MIT
