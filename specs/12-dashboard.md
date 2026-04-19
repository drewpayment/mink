# 12 — Dashboard

## Overview

The dashboard is a real-time web interface for monitoring Mink's state across a project. It provides visual representations of token usage, file index status, learning memory contents, bug history, scheduled task status, and more. It receives live updates from the daemon via persistent connection.

## Capabilities

### Panels

The dashboard must provide the following views, each loadable independently (lazy-loaded):

1. **Overview** — Project name, description, daemon health status, summary statistics (total sessions, total tokens, estimated savings).

2. **Activity Timeline** — Chronological view of session history showing reads and writes over time. Supports scrolling through past sessions.

3. **Token Intelligence** — Charts showing:
   - Token usage over time (per session and cumulative).
   - Read vs. write token split.
   - Savings estimate vs. projected unassisted usage.
   - Lifetime totals as headline numbers.

4. **Scheduler Control** — List of all scheduled tasks showing: name, schedule, enabled/disabled, last run time, status. Action buttons to manually trigger tasks. Dead letter queue with retry buttons.

5. **Learning Memory Viewer** — Display of all four learning memory sections (User Preferences, Key Learnings, Do-Not-Repeat, Decision Log) in a readable format.

6. **Action Log Browser** — Scrollable, searchable view of the session action log with table formatting preserved.

7. **File Index Browser** — Searchable list of all indexed files with descriptions and token estimates. Filterable by directory.

8. **Bug Log** — Searchable view of all bug entries with: error message, root cause, fix, tags, occurrence count. Expandable detail view per entry.

9. **AI Insights** — Display of AI-generated project suggestions (if the suggestion task has run).

10. **Design Evaluation** — Gallery of captured design screenshots with metadata (viewport, route, timestamp).

11. **Waste Intelligence** — Surface patterns detected by the waste detector (re-reads, redundant writes, large-context loads). Each entry shows: pattern type, frequency, suggested remedy. Links to the offending files where applicable.

12. **Wiki Vault** — Browser for the user's cross-project wiki. Shows the directory tree with per-folder note counts, a filterable list of recent notes, a reader pane for the selected note's body, and the note's inbound backlinks. Read behavior is defined in spec 15.

13. **Capture** — Form-based entry point to the wiki. Four modes: quick capture (free text, auto-categorized), structured capture (title, category, tags, body), daily append (adds to today's journal), and file ingest (pulls an external file into the vault). Write behavior is defined in spec 15.

14. **Sync Status** — Status of the git-backed sync of the shared configuration and wiki root. Shows remote URL, branch, ahead/behind counts, last pull/push timestamps, pending changes. Actions to pull, push, and disconnect. Behavior is defined in spec 15.

15. **Companion Channels** — Status and controls for external messenger channels (Discord first). Shows channel process status, uptime, recent message count, bot identity, sender allowlist, and a live log tail. Actions to start, stop, and restart. Behavior is defined in spec 17.

16. **Daemon Control** — Status of the background daemon, hook wiring overview, and controls to start, stop, and restart the process. Surfaces current daemon configuration (auto-restart, boot-on-login, verbose logging). Daemon lifecycle is defined in spec 11.

17. **Configuration Editor** — Grouped, filterable view of every resolved configuration key. Each entry shows key, value, source (default / shared / local / env), and type. Writes to either the shared or per-machine scope. Behavior is defined in spec 18.

### Real-Time Updates

- The dashboard maintains a persistent connection to the daemon.
- When any state file in the state directory changes, the daemon broadcasts the change.
- The dashboard updates the affected panel without full page reload.
- Connection loss should be indicated visually with automatic reconnection attempts.

In addition to file-system-change events, the daemon must broadcast explicit status events for surfaces that are not backed by a single state file:

- **Vault index change** — emitted on every note create, append, or ingest.
- **Sync status change** — emitted on pull, push, and disconnect completion.
- **Channel status change** — emitted when a companion channel starts, stops, or crashes.
- **Channel log line** — emitted when a channel processes a message or emits a significant event.
- **Configuration change** — emitted on every successful configuration write.
- **Daemon status change** — emitted on daemon start, stop, and heartbeat transitions.

Each event carries enough information for the client to refetch only the affected panel.

### Theme Support

- Light and dark theme support.
- Theme preference persisted locally in the browser.
- Respects system theme preference as default.

### Data Fetching

The dashboard must be able to fetch:

- Daemon health and project metadata.
- All state files (file index, learning memory, action log, token ledger, bug log, etc.).
- Design evaluation reports and captured images.
- Wiki vault listing, directory tree, tag frequencies, note body, and backlinks.
- Sync status, companion channel status and logs, and the resolved configuration list.
- It must support triggering actions in the following categories:
  - **Scheduler** — manual task run, dead letter retry, forced rescan.
  - **Daemon** — start, stop, restart.
  - **Wiki capture** — create note, append to today's daily, ingest an external file.
  - **Sync** — pull, push, disconnect.
  - **Channel** — start, stop, restart for a named channel.
  - **Configuration** — set a key in a given scope, reset one key, reset all in a scope, export, import.

All action endpoints return a structured result indicating success or failure with a human-readable message. No action may block the client for more than a short, bounded interval; long-running work is reported via the real-time update channel.

## Acceptance Criteria

```
GIVEN the dashboard is open and the daemon is running
WHEN a file is written in the project (triggering post-write hook)
THEN the file index browser updates to reflect the new/changed entry
AND the activity timeline shows the new write event
AND the token intelligence charts update

GIVEN the dashboard is open
WHEN the user clicks "Run" on the file-index-rescan task
THEN the task executes and the scheduler panel shows it as running
AND on completion, the status updates to show success/failure

GIVEN the dashboard is open
WHEN the user switches from light to dark theme
THEN the UI updates immediately
AND the preference is persisted across page reloads

GIVEN the daemon connection drops
WHEN the dashboard detects the disconnection
THEN a visual indicator shows the connection is lost
AND reconnection is attempted automatically
AND on reconnection, state is refreshed

GIVEN the bug log contains 20 entries
WHEN the user searches for "null" in the bug log panel
THEN only entries containing "null" in any searchable field are displayed

GIVEN the token ledger contains 15 sessions
WHEN the token intelligence panel loads
THEN charts display all 15 data points
AND headline numbers show correct lifetime totals

GIVEN the daemon is running
WHEN the user triggers "stop daemon" from the dashboard
THEN the daemon stops
AND the dashboard shell switches to the daemon-offline state within 2 seconds
AND the daemon panel reflects the stopped status

GIVEN the wiki vault panel is open
WHEN a capture action writes a new note
THEN the recent notes list gains the new entry without a page reload
AND the vault tree updates its per-folder count

GIVEN the configuration editor is open and a key resolves from the shared scope
WHEN the user writes a new value at the local scope
THEN the editor shows the value sourced from "local"
AND the shared value is preserved on disk

GIVEN the Discord channel is running and streaming logs to the dashboard
WHEN the channel processes a new message
THEN a new log line appears in the channel panel within 2 seconds

GIVEN sync is initialized and there are pending changes
WHEN the user triggers "push"
THEN the sync panel shows the push in progress
AND on completion, ahead-count returns to 0 and last-push timestamp updates
```

## Edge Cases

- Daemon is not running when dashboard is opened — show clear "daemon offline" state with instructions.
- State files are missing or corrupted — show "data unavailable" per panel, not a full crash.
- Very large action log (1000+ entries) — virtualized scrolling or pagination to prevent browser performance issues.
- Very large file index (500 entries) — search/filter must remain responsive.
- Multiple browser tabs open — all receive the same live updates.
- Wiki is disabled or the vault directory is absent — wiki and capture panels show a clear "wiki disabled" empty state, not an error.
- Sync is not initialized — sync panel shows an empty state with instructions to connect a remote.
- Companion channel module is not installed — the channel panel shows "unavailable" with a pointer to installation docs.
- Write action fails — the panel shows an inline error with the daemon's message; state reverts to the pre-action view.
- Secret value in the configuration editor — never shown in full unless an explicit reveal action is taken.

## Test Requirements

- Unit: Each panel renders correctly with sample data.
- Unit: Theme toggle updates all visual elements.
- Unit: Search/filter logic for file index and bug log panels.
- Integration: Live update from daemon → panel refresh without page reload.
- Integration: Task trigger from dashboard → daemon executes → status updates.
- Integration: Daemon start/stop action from dashboard → process starts/stops → panel reflects new state.
- Integration: Capture action from dashboard → note written to vault → wiki panel updates live.
- Integration: Sync pull/push action from dashboard → sync panel reflects new ahead/behind counts.
- Integration: Channel start/stop action from dashboard → channel process lifecycle observed → panel reflects status.
- Integration: Configuration set/reset action from dashboard → resolver returns new value → editor refreshes.
- Edge: Daemon offline state displays correctly and recovers on reconnection.
- Edge: Empty state (no sessions, no bugs, no suggestions) renders informative empty states.
- Edge: Wiki disabled, sync not initialized, channel unavailable — all render informative empty states without errors.
- Edge: Secret-typed configuration values are masked in every list-read path.
- Performance: Dashboard loads within 2 seconds with a 500-entry file index and 100-session ledger.
