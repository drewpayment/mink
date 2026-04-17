# Discord Knowledge Companion via Claude Code Channels

## Context

Mink has two missions: (1) background token efficiency via hooks during Claude Code sessions, and (2) a cross-project wiki vault. The hooks and wiki are working. What's missing is a **low-friction conversational entry point** for capturing, searching, and organizing knowledge outside of active coding sessions.

The user previously used Openclaw with a git-based notes repo on Discord — just send a message and the AI takes notes. Claude Code Channels (launched March 2026) is Anthropic's purpose-built replacement for this pattern: send a Discord/Telegram message into a running Claude Code session with full filesystem and CLI access.

This design wires Channels into Mink so the daemon manages a persistent Claude Code session with Discord, and a CLAUDE.md in the wiki vault makes Claude behave as a knowledge companion.

## Architecture

```
Discord Message
    ↓
Claude Code (--channels, cwd = wiki vault)
    ↓
Reads wiki CLAUDE.md → becomes knowledge companion
    ↓
Executes mink CLI commands (note, search, wiki status, etc.)
    ↓
Wiki Vault (markdown files, .mink-index.json)
    ↓
Responds in Discord
```

**Process management:**

```
mink daemon start
  ├── Scheduler process (existing, manages cron tasks)
  └── Channel process (new, Claude Code with --channels)

mink channel start/stop/status (independent lifecycle)
```

## Components

### 1. Channel CLI Commands

New file: `src/commands/channel.ts`
New CLI router case in `src/cli.ts`

**Commands:**

| Command | Description |
|---------|-------------|
| `mink channel setup discord` | Interactive setup — guides through Discord bot creation, saves token to config.local |
| `mink channel start [discord]` | Spawn Claude Code with `--channels` in the wiki vault directory |
| `mink channel stop` | Stop the channel session (SIGTERM → 5s → SIGKILL) |
| `mink channel status` | Show running state, uptime, platform, PID |
| `mink channel logs` | Tail `~/.mink/.channel.log` (last 50 lines) |

**Setup flow (`mink channel setup discord`):**
1. Print instructions for creating a Discord bot via Developer Portal
2. Prompt for bot token (or accept via `--token` flag)
3. Save token to `~/.mink/config.local` under `channel.discord.bot-token`
4. Set `channel.discord.enabled: true`
5. Set `channel.default-platform: discord`
6. Validate token format
7. Print next steps ("Run `mink channel start` to begin")

**Start flow (`mink channel start`):**
1. Resolve wiki vault path via `resolveVaultPath()`
2. Verify vault is initialized (`.mink-vault.json` exists)
3. Verify CLAUDE.md exists in vault root (create from template if missing)
4. Read platform from args or `channel.default-platform` config
5. Read bot token from `channel.discord.bot-token` in config.local
6. Check no existing channel process running (via PID file)
7. Spawn: `claude --channels --cwd <vault-path>` as detached child
   - stdout/stderr → `~/.mink/.channel.log`
   - Store PID in `~/.mink/.channel.pid` (JSON: `{ pid, platform, startedAt, vaultPath }`)
8. Print status message with pairing instructions

### 2. Config Additions

Scope: `local` (machine-specific, already supported by per-machine config feature)

| Key | Default | Scope | Description |
|-----|---------|-------|-------------|
| `channel.discord.bot-token` | `""` | local | Discord bot token |
| `channel.discord.enabled` | `false` | local | Auto-start with daemon |
| `channel.default-platform` | `discord` | shared | Default platform for `mink channel start` |

Added to `src/types/config.ts` config key definitions.

### 3. Daemon Integration

File: `src/core/daemon.ts` (extend existing)

**Changes:**
- `startDaemon()` — After starting the scheduler, also start the channel session if `channel.<platform>.enabled` is true
- `stopDaemon()` — Stop both scheduler and channel processes
- `isDaemonRunning()` — Check both PIDs
- Heartbeat loop (existing, every 30 min) — Also check channel PID liveness; restart if dead

**New PID/log files:**
- `~/.mink/.channel.pid` — Channel session PID (JSON)
- `~/.mink/.channel.log` — Channel session output log

**Process lifecycle follows existing pattern:** spawn detached → write PID → SIGTERM on stop → SIGKILL fallback → remove PID file.

### 4. Wiki CLAUDE.md (Companion Personality)

File: `<wiki-vault>/CLAUDE.md`

This file shapes Claude's behavior when running as the Discord knowledge companion. It is not code — it's a personality/instruction file that Claude reads on startup.

**Key sections:**

- **Identity**: "You are Mink, a personal knowledge companion."
- **Capabilities**: List of available `mink` CLI commands with examples
- **Conversational style**: Brief, mobile-friendly responses. Confirm what was captured. Suggest related notes.
- **Proactive capture**: When user's message sounds like a note, capture it. Ask for clarification only when genuinely ambiguous.
- **Search and retrieval**: How to answer "what did I write about X?" using `mink note search` and `mink note list`
- **Daily notes**: "Add to my daily" pattern appends to today's daily note
- **Meeting notes**: Detect meeting descriptions, use the meeting template
- **Organization**: Help categorize inbox notes, suggest tags from existing vocabulary
- **Cross-project awareness**: How project-specific notes work, wikilink conventions
- **Vault context**: Run `mink wiki status` and `mink note list --recent 5` at conversation start for context

**Template generation:** `mink channel start` creates this file from a built-in template if it doesn't exist. Users can edit it freely to customize the companion's behavior.

Template source: `src/core/channel-templates.ts`

### 5. Channel Process Management

New file: `src/core/channel-process.ts`

Extracted utilities for managing the channel Claude Code session:

```typescript
startChannelProcess(vaultPath: string, platform: string): Promise<number>  // returns PID
stopChannelProcess(): Promise<void>
isChannelRunning(): boolean
getChannelStatus(): ChannelStatus | null
```

**ChannelStatus type** (in `src/types/channel.ts`):

```typescript
interface ChannelStatus {
  pid: number;
  platform: "discord" | "telegram";
  startedAt: string;
  vaultPath: string;
  uptime: number; // seconds
}
```

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `src/commands/channel.ts` | Create | Channel CLI command handler |
| `src/core/channel-process.ts` | Create | Channel process lifecycle management |
| `src/core/channel-templates.ts` | Create | Wiki CLAUDE.md template |
| `src/types/channel.ts` | Create | ChannelStatus type |
| `src/types/config.ts` | Edit | Add channel config keys |
| `src/core/global-config.ts` | Edit | Add channel config defaults + metadata |
| `src/core/daemon.ts` | Edit | Integrate channel process into daemon lifecycle |
| `src/cli.ts` | Edit | Add `channel` case to CLI router |
| `<wiki-vault>/CLAUDE.md` | Create (on first start) | Companion personality file |

## User Workflow

### One-time setup:
```bash
# 1. Create a Discord bot at https://discord.com/developers/applications
# 2. Configure Mink with the bot token
mink channel setup discord

# 3. Start the channel
mink channel start

# 4. Pair in Discord: send any message to your bot, enter pairing code in Claude Code
```

### Daily use:
```bash
# Start with daemon (auto-starts channel if enabled)
mink daemon start

# Or start channel independently
mink channel start
```

### From Discord:
- "Save a note — the deploy pipeline is broken because of the new ARM runners"
- "What did I write about the auth migration?"
- "Show my notes from this week"
- "Add to my daily: finished the config refactor, PR is up"
- "Meeting with Sarah about Q3 roadmap — discussed prioritizing the mobile SDK, timeline is 6 weeks"

## Verification

1. **Setup flow**: Run `mink channel setup discord`, verify token is saved to `config.local`, verify config reads back correctly
2. **Start/stop**: Run `mink channel start`, verify PID file created, Claude Code process running, `mink channel status` reports correctly. Run `mink channel stop`, verify process terminated, PID file removed.
3. **Daemon integration**: Run `mink daemon start` with `channel.discord.enabled: true`, verify both scheduler and channel processes running. `mink daemon stop` kills both.
4. **Discord round-trip**: Send a note via Discord, verify it appears in the wiki vault with correct metadata. Search for it via Discord, verify results returned.
5. **Auto-restart**: Kill the channel process manually, verify daemon heartbeat restarts it within 30 minutes.
6. **CLAUDE.md**: Verify the companion personality file is created on first start. Edit it, restart channel, verify changed behavior.
7. **Edge cases**: Start channel with no vault initialized (should error with helpful message). Start channel with no bot token configured (should error). Start when already running (should warn, not double-spawn).

## Dependencies

- Claude Code v2.1.80+ (Channels support)
- Bun runtime (Channels plugins require Bun)
- Discord bot token (user creates via Developer Portal)
- Mink wiki vault must be initialized (`mink wiki init`)
