# 17 — Companion Channels

## Overview

Companion channels let the developer interact with Mink from outside the terminal — from a phone, another computer, or any device where they can send a direct message. The first channel is Discord; the design accommodates additional channels (Slack, Telegram, SMS) later. A channel is a long-running background process, separate from the daemon, that listens for messages from the allowlisted user and turns them into Mink operations: capture a note, search the vault, summarize a project, check sync status.

Channels are off by default. When enabled, they give the developer a durable, asynchronous way to reach their wiki and session state without opening the CLI.

## Capabilities

### Channel Lifecycle

A channel must support:

1. **Start** — Launch the channel's background process. The process inherits the user's identity and credentials; it is bound to a single channel implementation (e.g. the Discord bot).
2. **Stop** — Cleanly shut down the process, closing any open connections.
3. **Restart** — Stop then start, preserving configuration.
4. **Status query** — Report whether the channel is running, its uptime, and recent message count.
5. **Detach** — Leave the process running but stop streaming its logs to the current session.

Only one instance of a given channel may run at a time per machine.

### Sender Allowlist

Each channel must enforce an allowlist of sender identities:

1. Messages from non-allowlisted senders must be silently ignored (no reply, no log of content beyond "unauthorized sender X").
2. The allowlist is stored in configuration and editable through both CLI and dashboard.
3. At least one allowlisted sender must exist before the channel can start.

### Message Handling

A channel must interpret a small set of verbs sent by DM:

1. **`note <text>`** — Capture `<text>` as a new note in the wiki. Claude classifies it (category, tags) and places it under the appropriate folder. Returns the resulting path.
2. **`daily <text>`** — Append `<text>` to today's daily journal entry.
3. **`search <query>`** — Search the vault and return the top 3–5 matching note paths with one-line excerpts.
4. **`summarize <project>`** — Return a short summary of the named project's recent session activity.
5. **`status`** — Return a one-line health line (daemon state, open session, last capture time).

Unknown verbs must return a help message listing the available verbs.

### Session Logs

The channel process must emit a line-oriented log of its activity:

1. Each line records timestamp, event type, and a short human-readable description.
2. Message bodies from allowlisted users may be logged; bodies from unauthorized senders must not.
3. The log must be tail-able — both from the CLI and streamed to the dashboard.
4. Log rotation is the responsibility of the channel process; the dashboard displays only the most recent lines.

### Configuration Keys

Channels share a common configuration namespace, with Discord-specific keys nested underneath:

- `channel.discord.enabled` — Start the Discord channel automatically when the daemon starts.
- `channel.discord.token` — Bot token. Must never be displayed in full in any UI or log.
- `channel.discord.allowlist` — List of allowed sender identities.
- `channel.skip-permissions` — Whether commands invoked by a channel require explicit confirmation. Off by default.

Bot tokens must be stored so that reads return a masked value by default and an explicit "reveal" action is required to see the full value.

### Credentials and Secrets

1. Tokens must never appear in the dashboard, logs, or command output by default.
2. Dashboard and CLI read paths must return a masked placeholder (e.g. `••••`).
3. A separate, explicit action may reveal or replace a token; that action must be rate-limited.
4. Tokens must not be committed to the wiki or the shared config file; they belong in the per-machine scope (see spec 18).

## Acceptance Criteria

```
GIVEN the Discord channel is not running AND an allowlist and token are configured
WHEN the user invokes "start channel"
THEN a background process is spawned
AND the channel reports status = running with uptime starting at 0
AND any subsequent start attempt reports "already running"

GIVEN the Discord channel is running
WHEN the user invokes "stop channel"
THEN the process exits cleanly
AND the channel reports status = stopped
AND session logs are preserved

GIVEN the Discord channel is running
WHEN an allowlisted user DMs "note use httpOnly cookies for JWT"
THEN a new note is created under the wiki
AND the channel replies with the note's path
AND the session log records the capture event

GIVEN the Discord channel is running
WHEN a non-allowlisted user DMs any text
THEN no note is created
AND no reply is sent
AND the session log records "unauthorized sender" without the message body

GIVEN the Discord channel is running
WHEN an allowlisted user DMs "search backoff"
THEN the channel replies with up to 5 matching note paths and excerpts
AND the session log records the search

GIVEN the channel is configured but the bot token is missing
WHEN the user attempts to start the channel
THEN the start fails with a clear error identifying the missing token
AND no process is spawned

GIVEN the dashboard is open and the channel is running
WHEN the channel processes a new message
THEN the session logs panel updates within 2 seconds without a page reload

GIVEN a bot token is stored in configuration
WHEN the dashboard or CLI reads the token value
THEN the returned value is masked by default
```

## Edge Cases

- Channel process crashes — auto-restart up to N times with backoff; after N, remain stopped and emit an error.
- Token rotated externally — next message attempt fails with an auth error; the channel must surface this clearly rather than spin silently.
- Discord rate limit hit — the channel must back off, never drop messages silently, and report the rate-limited state in status.
- Allowlist is emptied while the channel is running — the channel keeps running but rejects all messages until the allowlist is repopulated.
- Multiple channels configured simultaneously (future) — each has its own process, own logs, and own status.
- Dashboard requests a start action while the channel is already running — respond with "already running", not an error.
- User removes the channel-specific module from disk — status reports "unavailable" rather than erroring on start.

## Test Requirements

### Unit Tests

- Message parsing — each verb resolves to the expected operation; unknown verbs return help text.
- Allowlist enforcement — only allowlisted senders produce operations.
- Token masking — read paths return a masked value, not the raw token.
- Configuration resolution — channel settings pick up from shared and per-machine scopes (see spec 18).

### Integration Tests

- Full lifecycle: start → send message → observe note creation → stop.
- Unauthorized sender: send message → no side effects, log line emitted.
- Restart preserves configuration and allowlist.
- Dashboard status + logs update live via SSE when the channel processes a message.
- Token missing → start fails with a clear error.
- Process crashes → auto-restart up to the configured limit.

### Edge Cases

- Channel runs for 24 hours without memory growth beyond a small, bounded buffer.
- Rate-limited replies queue cleanly rather than drop.
- Removing the channel module while the process is running produces a clean error on next status query.
