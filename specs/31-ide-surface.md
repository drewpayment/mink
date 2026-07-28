# 31 — IDE Surface

## Overview

Mink's surfaces are the terminal, the dashboards, and the pull tools. This
capability meets developers inside their editor with a thin client that exposes
Mink's most useful actions from the command palette. It reimplements none of
Mink's logic: each action invokes the existing command-line surface and renders
the result, so the editor client stays a presentation layer over the same engine.

The first target is VS Code; a JetBrains port is a follow-up. Gutter decorations
that key bugs to the current file are a planned enhancement once a per-file bug
query exists.

## Capabilities

### Thin Client

- Editor commands map one-to-one to command-line invocations; the client builds
  the invocation, runs it in the active workspace, and shows the output.
- The action-to-invocation logic is isolated from the editor API so it can be
  tested without an editor host.
- Commands run with the active workspace folder as the working directory, so they
  resolve against that project's state.

### Commands

- Show the project context pack.
- Search the bug memory for a query.
- Recall tasks similar to the active file.
- Capture a note.

### Degradation

- With no workspace open, actions decline with a clear message rather than
  running against an unknown directory.
- When the command-line tool is missing, the failure is surfaced clearly instead
  of failing silently.

## Acceptance Criteria

```
GIVEN an editor action mapped to a command-line invocation
WHEN the action is triggered
THEN the correct argument vector is built for that action

GIVEN an action that requires input (a query, a note, a file)
WHEN the input is empty
THEN the invocation is not built and the user is told why

GIVEN the active file within a workspace
WHEN the "similar tasks" action runs
THEN the file is passed as a workspace-relative path

GIVEN a file outside the workspace root
WHEN a workspace-relative path is computed
THEN the original path is returned unchanged

GIVEN no workspace folder is open
WHEN an action is triggered
THEN it declines with a clear message
```

## Edge Cases

- Empty required input — the invocation is not built.
- Active file equal to the workspace root — relative path is empty.
- Command-line tool not found — a clear error, not a silent no-op.

## Test Requirements

- Unit: argument-vector construction for each action; empty-input guards;
  workspace-relative path computation (inside, trailing-slash root, outside,
  equal-to-root). The editor-API glue is exercised in an editor development host
  and is out of scope for headless tests.

## Out of Scope (follow-ups)

- Gutter decorations keying bugs to the current file (needs a per-file bug query).
- JetBrains port.
