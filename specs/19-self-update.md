# 19 — CLI Self-Update

## Overview

Mink is distributed as an executable CLI. To keep headless and remote
installations current without operator intervention, the CLI must be able to
upgrade itself in place. The feature provides both a manual command and a
scheduled task that consults user configuration before running. Updates always
follow the published `latest` distribution channel.

The feature is **off by default** — the user must explicitly enable
auto-upgrade for the scheduler to run it. The manual command is always
available regardless of configuration.

## Capabilities

### Manual upgrade command

The CLI exposes a single command that:

- Resolves the install location of the running CLI.
- Refuses to operate when running from a working source tree (dev mode guard).
- Queries the package registry for the latest published version on the stable
  channel and compares it to the running version.
- Reports whether an upgrade is available without taking any action when
  invoked in `--check` mode.
- Resolves the install command without running it when invoked in
  `--dry-run` mode.
- When neither flag is set, asks the user to confirm, then invokes the local
  package manager to install the new version globally.
- Honors `--force` to install the latest even when it is not strictly newer.
- Honors `--yes` / `-y` to skip the interactive confirmation, suitable for
  scripts.

### Scheduled upgrade

The background scheduler (spec 10) registers a `cli-self-update` task that:

- Runs on a configurable cron schedule.
- Reads the user's auto-update preference at execution time and skips silently
  when disabled.
- Calls the same upgrade core as the manual command, in non-interactive mode,
  capturing stdio so output is logged rather than printed to a terminal that
  may not exist.
- Reports transient errors (network failure, registry timeout, install
  command failure) so the scheduler can retry with exponential backoff.
- Reports non-transient errors (no package manager available, dev mode) such
  that they don't loop into the dead letter queue indefinitely.

### Configuration

The feature defines three configuration keys (see spec 18):

- `cli.auto-update` — boolean. When `true`, the scheduled task performs an
  upgrade if one is available. Default: `false`. Scope: shared.
- `cli.auto-update-schedule` — cron expression governing the scheduled task.
  Default: `0 4 * * *` (daily at 04:00 local). Scope: shared. Invalid
  expressions fall back to the default rather than crashing the scheduler.
- `cli.auto-update-package-manager` — `auto` | `npm` | `bun`. Default: `auto`.
  Scope: local, since the available runtime varies per machine.

A kill-switch environment variable, `MINK_DISABLE_AUTO_UPDATE=1`, suppresses
scheduled upgrades even when configuration enables them. The manual command
is unaffected.

### Logging

Each upgrade attempt — manual or scheduled — appends a structured JSON line to
`~/.mink/self-update.log` describing source, status, versions, and error
context. The log is rotated at a fixed line cap so it never grows unbounded.

## Acceptance Criteria

**Given** a fresh install with default configuration,
**When** the scheduler ticks past the configured schedule time,
**Then** no upgrade is attempted and no install is performed.

**Given** `cli.auto-update=true` and a newer version is published,
**When** the scheduled task fires,
**Then** the new version is installed globally without any prompts and the
result is appended to `~/.mink/self-update.log`.

**Given** the user runs `mink upgrade --check`,
**When** the CLI is current,
**Then** the command reports up-to-date and exits without invoking any
package manager.

**Given** the user runs `mink upgrade` from the working source tree,
**When** the dev-mode guard activates,
**Then** the command refuses with a clear message rather than mutating the
checkout.

**Given** the registry is unreachable,
**When** the scheduled task runs,
**Then** the task reports a transient error and the scheduler retries per the
configured retry policy. After max retries, the task moves to the dead-letter
queue and is visible via `mink cron dead-letter list`.

**Given** neither npm nor bun is on PATH,
**When** any upgrade is attempted,
**Then** the upgrade reports an error identifying the missing package manager
and does not retry indefinitely.

## Edge Cases

- The running process keeps file handles to the old `dist/cli.js`; replacing
  the global package mid-execution does not crash the running scheduler. The
  next tick uses the new bits.
- A user setting `cli.auto-update-schedule` to an invalid cron expression
  falls back silently to the default rather than disabling the task.
- A prerelease is never installed via auto-update, since only the `latest`
  dist-tag is followed. Users wanting prereleases can `mink upgrade --force`
  with an explicit version (future work).

## Test Requirements

- Unit tests for the semver comparator covering ordering, equality, prerelease
  handling, and tolerant input (leading `v`, missing components).
- Unit tests for config schedule resolution: default applies when config is
  unset; invalid config falls back to default.
- Manual verification flow: `mink upgrade --check`, `mink upgrade --dry-run`,
  and `mink upgrade` end-to-end against a sandboxed older install.
- Dev-mode guard: running `bun run src/cli.ts upgrade` from the repo refuses.
