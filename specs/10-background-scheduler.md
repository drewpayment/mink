# 10 — Background Scheduler

## Overview

The background scheduler runs maintenance tasks on configurable cron schedules. It operates as a long-running background process (daemon) that executes tasks like file index rescans, action log consolidation, waste detection, and AI-assisted reflections. It includes retry logic, dead letter handling, and health monitoring.

## Capabilities

### Built-in Tasks

The scheduler must support these default tasks:

1. **File Index Rescan** — Full project scan to update the file index. Default schedule: every 6 hours.
2. **Action Log Consolidation** — Compress old sessions in the action log. Default schedule: daily at 2:00 AM.
3. **Waste Detection** — Analyze token usage for waste patterns. Default schedule: weekly (Mondays).
4. **Learning Memory Reflection** — AI-assisted review and pruning of the learning memory. Default schedule: weekly (Sundays at 3:00 AM). Requires AI assistant CLI access.
5. **Project Suggestions** — AI-assisted analysis generating improvement suggestions. Default schedule: weekly (Mondays at 4:00 AM). Requires AI assistant CLI access.

### Task Execution

Each task must define:

- Unique identifier.
- Human-readable name and description.
- Cron schedule expression.
- Action type and parameters.
- Retry policy: maximum attempts (default: 3), backoff strategy (exponential), base delay.
- Failure handling: dead letter on exhausted retries, alert threshold for consecutive failures.
- Enabled/disabled flag.

### Retry and Dead Letter

- Failed tasks retry with exponential backoff (base delay × 2^attempt).
- After maximum retry attempts are exhausted, the task is moved to a dead letter queue.
- Dead-lettered tasks can be manually retried via CLI.
- The dead letter queue tracks: task ID, failure timestamps, error messages, attempt count.

### Health Monitoring

- The daemon emits a heartbeat at a configurable interval (default: 30 minutes).
- Health status includes: uptime, last heartbeat, active tasks, dead letter count.
- The dashboard (if enabled) displays daemon health.

### AI-Assisted Tasks

- Tasks that require AI assistance invoke the AI CLI in non-interactive mode.
- The system must strip any API key environment variables to prevent credential conflicts (use subscription credentials only).
- AI tasks have their own timeout (longer than file-based tasks).

### Manual Trigger

- Any scheduled task can be triggered manually via CLI regardless of its schedule.
- Manual triggers bypass the schedule but still respect retry policies.

## Acceptance Criteria

```
GIVEN the scheduler is running with default configuration
WHEN 6 hours have elapsed since the last file index rescan
THEN the file index rescan task executes automatically
AND the file index is updated

GIVEN a task fails on execution
WHEN the retry policy allows retries (attempts < max)
THEN the task is retried after exponential backoff delay
AND the attempt counter increments

GIVEN a task has failed 3 times (max retries exhausted)
WHEN the third retry fails
THEN the task is moved to the dead letter queue
AND an alert is recorded

GIVEN a task is in the dead letter queue
WHEN the user manually retries it via CLI
THEN the task executes immediately
AND on success, it is removed from the dead letter queue

GIVEN the scheduler is running
WHEN 30 minutes have passed since the last heartbeat
THEN a new heartbeat is emitted with current status

GIVEN the user runs "mink cron run file-index-rescan"
WHEN the task is triggered manually
THEN it executes immediately regardless of schedule

GIVEN an AI-assisted task is configured
WHEN it executes
THEN it invokes the AI CLI in non-interactive mode
AND API key environment variables are stripped from the execution environment
```

## Edge Cases

- Daemon is not running when a manual trigger is requested — execute the task directly without the daemon.
- Two tasks are scheduled at the same time — execute sequentially, not concurrently (prevent resource conflicts).
- Daemon crashes and restarts — resume from cron manifest, do not re-execute tasks that already ran in their current period.
- AI CLI is not available — AI-assisted tasks fail with a clear error message, are retried, and eventually dead-lettered.
- System clock changes (DST, NTP sync) — cron engine handles gracefully without double-firing or skipping.

## Test Requirements

- Unit: Cron schedule parsing and next-run calculation.
- Unit: Exponential backoff delay calculation (base × 2^attempt).
- Unit: Dead letter queue operations — add, list, retry, remove.
- Unit: Heartbeat emission and health status structure.
- Integration: Task scheduled → fires at correct time → updates target state.
- Integration: Task fails → retries → dead-letters → manual retry succeeds.
- Edge: Concurrent task scheduling does not cause race conditions.
- Edge: Missing AI CLI produces clear error without crashing the daemon.
