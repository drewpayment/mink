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

### Real-Time Updates

- The dashboard maintains a persistent connection to the daemon.
- When any state file in the state directory changes, the daemon broadcasts the change.
- The dashboard updates the affected panel without full page reload.
- Connection loss should be indicated visually with automatic reconnection attempts.

### Theme Support

- Light and dark theme support.
- Theme preference persisted locally in the browser.
- Respects system theme preference as default.

### Data Fetching

The dashboard must be able to fetch:

- Daemon health and project metadata.
- All state files (file index, learning memory, action log, token ledger, bug log, etc.).
- Design evaluation reports and captured images.
- It must support triggering actions: manual task runs, dead letter retries, forced rescans.

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
```

## Edge Cases

- Daemon is not running when dashboard is opened — show clear "daemon offline" state with instructions.
- State files are missing or corrupted — show "data unavailable" per panel, not a full crash.
- Very large action log (1000+ entries) — virtualized scrolling or pagination to prevent browser performance issues.
- Very large file index (500 entries) — search/filter must remain responsive.
- Multiple browser tabs open — all receive the same live updates.

## Test Requirements

- Unit: Each panel renders correctly with sample data.
- Unit: Theme toggle updates all visual elements.
- Unit: Search/filter logic for file index and bug log panels.
- Integration: Live update from daemon → panel refresh without page reload.
- Integration: Task trigger from dashboard → daemon executes → status updates.
- Edge: Daemon offline state displays correctly and recovers on reconnection.
- Edge: Empty state (no sessions, no bugs, no suggestions) renders informative empty states.
- Performance: Dashboard loads within 2 seconds with a 500-entry file index and 100-session ledger.
