# 11 — CLI Interface

## Overview

The CLI is the primary user-facing interface for Mink. It provides commands for initialization, status monitoring, manual operations, and system management. All commands operate on the current project directory (or a specified project) and interact with the state directory.

## Capabilities

### Commands

#### `mink init`

Initialize Mink in the current project directory.

- Detect the project root (look for version control directories, package manifests, or project config files).
- Create the state directory with all required files and subdirectories.
- Register lifecycle hooks with the AI assistant's settings.
- Run an initial full file index scan.
- Seed the learning memory with project name/description from project metadata.
- If upgrading an existing installation: preserve user-generated state (learning memory, action log, bug log, token ledger) while updating system templates and hook scripts.
- Create timestamped backup before any upgrade.

#### `mink status`

Display project health at a glance.

- State directory integrity (all required files present and parseable).
- File index: file count, last scan time, hit/miss ratio.
- Token ledger: lifetime totals, estimated savings.
- Learning memory: section counts, last updated.
- Bug log: entry count.
- Daemon status (running/stopped, uptime, port).

#### `mink scan [--check]`

Force a full file index rescan.

- Default mode: scan and update the file index.
- `--check` mode: compare filesystem vs. index, report differences, exit with failure status if stale. Suitable for CI pipelines. Does not modify the index.

#### `mink dashboard`

Open the web dashboard.

- Auto-start the daemon if not running.
- Open the dashboard URL in the default browser.

#### `mink daemon <start|stop|restart|logs>`

Manage the background daemon.

- `start` — Start as a persistent background process.
- `stop` — Stop the running daemon (find by port if needed).
- `restart` — Stop then start.
- `logs` — Display recent daemon log output (default: last 50 lines).

#### `mink cron <list|run|retry> [id]`

Manage scheduled tasks.

- `list` — Show all tasks with: schedule, enabled/disabled, last run time, status.
- `run <id>` — Manually trigger a task immediately.
- `retry <id>` — Retry a dead-lettered task.

#### `mink update [--dry-run] [--project <name>] [--list]`

Update Mink installation across registered projects.

- Default: update all registered projects to latest templates.
- `--dry-run` — Show what would change without making changes.
- `--project <name>` — Update only the specified project.
- `--list` — List all registered projects with their current version.
- Always creates timestamped backups before updating.

#### `mink restore [backup]`

Restore the state directory from a backup.

- No arguments: list available backups with timestamps.
- With argument: restore the specified backup, replacing current state.

#### `mink designqc [target]`

Capture design screenshots for evaluation (see spec 13).

- `--url <url>` — Capture a specific URL instead of auto-detecting routes.
- `--routes <paths...>` — Capture specific routes.
- `--quality <n>` — Image compression quality (0-100).
- `--desktop-only` — Skip mobile viewport captures.

#### `mink bug search <term>`

Search the bug log.

- Search across error messages, root causes, fixes, tags, and file paths.
- Display results sorted by relevance with similarity scores.

#### `mink config [key] [value]`

Manage global user settings stored in `~/.mink/config`.

- `mink config` — Display all current settings with their source (default, config file, or env var).
- `mink config <key>` — Display the value of a specific setting and its source.
- `mink config <key> <value>` — Set a value in `~/.mink/config`. Creates `~/.mink/` and the config file if they don't exist.
- `mink config --reset <key>` — Remove a setting, reverting to default.
- `mink config --reset-all` — Reset all settings to defaults (prompts for confirmation).

Supported settings:
- `wiki.path` — Wiki vault location (default: `~/.mink/wiki/`).
- `wiki.enabled` — Enable/disable the wiki feature (default: `true`).
- `wiki.sync-mode` — `immediate` or `batched` (default: `immediate`).
- `wiki.git-backup` — Enable/disable auto-commit and push (default: `false`).
- `wiki.git-remote` — Git remote name for push (default: `origin`).

### Runtime Requirements

- The CLI must verify that the runtime environment meets minimum version requirements before executing.
- Clear error messages for missing dependencies.

## Acceptance Criteria

```
GIVEN a project directory without Mink
WHEN "mink init" is run
THEN the state directory is created with all required files
AND lifecycle hooks are registered
AND the file index contains entries for project files
AND the learning memory is seeded with project metadata

GIVEN Mink is already initialized at an older version
WHEN "mink init" is run again
THEN user state files (learning memory, action log, bug log, ledger) are preserved
AND system templates and hooks are updated to the latest version
AND a timestamped backup is created before changes

GIVEN a healthy Mink installation
WHEN "mink status" is run
THEN output shows: file count, last scan time, lifetime tokens, savings estimate, daemon status

GIVEN a project with files added since last scan
WHEN "mink scan --check" is run
THEN the output lists files missing from the index
AND exits with failure status

GIVEN the daemon is not running
WHEN "mink dashboard" is run
THEN the daemon is auto-started
AND the dashboard URL is opened in the default browser

GIVEN a dead-lettered task "file-index-rescan"
WHEN "mink cron retry file-index-rescan" is run
THEN the task executes immediately
AND on success, it is removed from the dead letter queue

GIVEN no ~/.mink/ directory exists
WHEN "mink config wiki.path ~/notes/wiki" is run
THEN ~/.mink/ is created
AND ~/.mink/config is created with wiki.path = ~/notes/wiki

GIVEN wiki.path is set to "~/notes/wiki" in config
WHEN "mink config wiki.path" is run
THEN the output shows: wiki.path = ~/notes/wiki (source: config file)

GIVEN MINK_WIKI_PATH env var is set to "/tmp/wiki"
WHEN "mink config wiki.path" is run
THEN the output shows: wiki.path = /tmp/wiki (source: environment variable)
AND notes that config file value is overridden

GIVEN "mink config --reset wiki.path" is run
WHEN the command completes
THEN wiki.path is removed from ~/.mink/config
AND subsequent queries show the default value

GIVEN "mink config --reset-all" is run
WHEN the user confirms the prompt
THEN all settings are removed from ~/.mink/config
AND all subsequent queries show default values
```

## Edge Cases

- `mink init` in a directory that's not a project root — warn but allow (user may be intentional).
- `mink status` with corrupted state files — report which files are corrupted, suggest restore.
- `mink daemon stop` when daemon is already stopped — no-op with informational message.
- `mink restore` with no backups available — inform user, exit cleanly.
- `mink update --list` with no registered projects — inform user, suggest running init.
- `mink config` with corrupted `~/.mink/config` — warn user, display defaults, do not overwrite the corrupted file.
- `mink config --reset-all` cancelled by user — no changes made.
- `mink config <key>` with unknown key — list valid keys, exit with error.

## Test Requirements

- Integration: `mink init` in a sample project → all state files created correctly.
- Integration: `mink init` upgrade path → user state preserved, templates updated, backup created.
- Integration: `mink status` output includes all expected sections.
- Integration: `mink scan --check` detects added/removed files and exits with correct status.
- Integration: `mink cron list` displays all tasks with correct format.
- Integration: `mink bug search` returns relevant results from a populated bug log.
- Integration: `mink config wiki.path <path>` → creates ~/.mink/config, stores value, reads it back.
- Integration: `mink config` with no args → displays all settings with sources.
- Integration: `mink config --reset <key>` → value reverts to default on next read.
- Integration: Environment variable override takes priority over config file value.
- Edge: Each command handles missing/corrupted state files gracefully.
- Edge: `mink init` in non-project directory still creates valid state.
- Edge: `mink config` with corrupted config file → defaults displayed, no crash.
- Edge: `mink config` with unknown key → error with list of valid keys.
