# 21 — Multi-Agent Adapter

## Overview

Mink runs alongside an AI coding assistant by intercepting that assistant's
lifecycle and tool events. Until now Mink has assumed a single host assistant
with one event mechanism. This spec generalizes that assumption: Mink must be
able to attach to **more than one host assistant**, so a user can run whichever
assistant they prefer — or several across different projects — and get the same
token-efficiency and wiki behavior from a single, shared `~/.mink/` state.

The design rests on a clean separation that already exists in the codebase but
has not been named:

- A **canonical hook contract** — a small, agent-neutral set of lifecycle
  events (`session-start`, `session-stop`, `pre-read`, `post-read`,
  `pre-write`, `post-write`) consumed by Mink's existing commands. These
  commands read a normalized payload, write advisory text to a feedback
  channel, persist to `~/.mink/`, and never block or crash. They are the
  canonical engine and are unchanged by this spec.

- A **host adapter** — a thin, per-assistant layer that (1) registers Mink with
  the host's own extension/hook system, (2) translates the host's native
  lifecycle and tool events into the canonical hook contract, and (3) routes the
  advisory feedback Mink emits back into the host's model context. Each
  supported host has exactly one adapter. All adapters target the same canonical
  commands, so feature logic is never forked per host.

A user with two different assistants installed must be able to wire both to the
same project and see one unified history, one file index, one token ledger, and
one wiki. The concrete host mechanisms differ (one host uses a JSON hook
configuration with subprocess commands; another uses a code extension that
subscribes to events in-process), but neither difference reaches Mink's core.

Concrete host details live in the Appendix; the body of this spec is
host-neutral.

## Capabilities

### Canonical Hook Contract

Mink defines six lifecycle events. Every host adapter maps the host's native
events onto exactly these:

1. **session-start** — a new interactive session has begun. Initializes
   ephemeral session state (spec 01).
2. **session-stop** — the assistant has finished responding, or the session is
   ending. Finalizes session state, may fire more than once, and is idempotent
   (spec 01).
3. **pre-read** — the assistant is about to read a file. Surfaces file-index and
   repeated-read intelligence (spec 05).
4. **post-read** — the assistant has read a file. Records the read and its token
   cost (spec 05).
5. **pre-write** — the assistant is about to create or modify a file. Enforces
   learned rules and surfaces known bugs (spec 06).
6. **post-write** — the assistant has created or modified a file. Records the
   write (spec 06).

Each event carries a **normalized payload** independent of host wording:

- The operation kind (read, create, edit).
- The target file path.
- For writes: the content being written (full content for a create, the new
  text for an edit).
- For reads: the content that was returned, when the host makes it available.

An adapter's job is to fill this payload from whatever shape the host provides
and hand it to the matching canonical command.

### Adapter Responsibilities

Every host adapter must:

1. **Map events.** Translate each of the host's native lifecycle and tool
   events into the matching canonical event, and only those. Host events with no
   Mink meaning are ignored.
2. **Normalize tool identity.** Hosts name their read/create/edit tools
   differently and use different argument field names. The adapter resolves the
   host's tool name and arguments to the canonical operation kind and payload
   fields. Only read, create, and edit operations are relevant; all other host
   tools are ignored.
3. **Route advisory feedback.** Mink commands emit human-readable advisories
   (index hits, repeated-read warnings, learned-rule violations, known bugs).
   The adapter must deliver this feedback into the host's model context so the
   assistant sees it, matching the behavior of the original host where such
   feedback is fed back automatically. Delivering the same feedback to the human
   operator as well is permitted but secondary.
4. **Stay advisory.** The adapter must never block, cancel, or alter a host
   operation on Mink's behalf. Mink is observational and advisory only.
5. **Stay invisible on failure.** If a canonical command errors, times out, or
   the adapter itself fails, the host operation must proceed unaffected. No host
   event may be delayed beyond a short bound or fail because of Mink.
6. **Preserve ordering.** For a single operation, the pre event must be
   delivered before the operation and the post event after it, so that
   repeated-read detection (which runs before the read is recorded) behaves
   correctly.

### Registration & Installation

For each supported host, Mink provides an installer that:

1. **Wires Mink into the host.** Adds the adapter to the host's own
   extension/hook configuration so Mink runs automatically for that host. The
   wiring must be **idempotent** — re-running replaces Mink's prior entries
   rather than duplicating them — and must leave any unrelated host
   configuration untouched.
2. **Installs guidance.** Writes a host-appropriate guidance artifact that tells
   the assistant Mink is active, that state lives under `~/.mink/` (never in the
   repository), and how to act on Mink prompts and the note-capture capability.
3. **Installs the note-capture capability.** Registers Mink's note-capture
   capability in the host's native mechanism so the user can ask the assistant
   to save a note to the wiki.
4. **Is portable.** Where the host configuration may be committed to a
   repository and shared across machines, the wiring must reference Mink in a
   machine-independent way rather than by absolute local path.

### Host Detection & Selection

1. On initialization, Mink **detects which supported hosts are present** on the
   machine and/or in the project.
2. The user can target **one host, several, or all** detected hosts in a single
   initialization. The default behavior favors the least surprising outcome:
   wire the host(s) actually detected, and when more than one is detected, make
   the choice explicit rather than guessing.
3. Wiring additional hosts later must be possible without disturbing hosts
   already wired.

### Shared State Across Hosts

1. All Mink state remains under `~/.mink/`, keyed by stable project identity
   (spec 20), regardless of which host produced an event.
2. Two different hosts attached to the same project share **one** session
   history, file index, learning memory, bug memory, token ledger, and wiki.
   Reads and writes from either host accumulate into the same state.
3. Configuration, sync, scheduler, dashboard, and wiki behavior (specs 10, 12,
   15, 18) are host-independent and require no per-host variation.

### Removal

1. For each supported host, Mink can **remove** its wiring — adapter
   registration, guidance artifact, and note-capture capability — from that
   host's configuration without touching unrelated entries.
2. Removal from one host must not affect any other wired host, and must not
   delete `~/.mink/` state.

## Acceptance Criteria

```
GIVEN a host that is not yet wired to Mink
WHEN Mink initialization targets that host
THEN the host's configuration references Mink's adapter
AND a guidance artifact for that host is present
AND the note-capture capability is registered for that host
AND no unrelated host configuration is modified

GIVEN a host already wired to Mink
WHEN Mink initialization targets that host again
THEN Mink's prior entries are replaced, not duplicated
AND the resulting configuration contains exactly one set of Mink entries

GIVEN two supported hosts are present on the machine
WHEN initialization is asked to target all detected hosts
THEN both hosts are wired to Mink
AND both reference the same canonical engine

GIVEN a wired host is about to perform a read operation
WHEN the adapter receives the host's native read event
THEN it is translated to a canonical pre-read with the target file path
AND the pre-read runs before the read occurs

GIVEN a wired host has completed a read operation
WHEN the adapter receives the host's native completion event
THEN it is translated to a canonical post-read carrying the returned content when available
AND the post-read runs after the read occurred

GIVEN a wired host is about to create or edit a file
WHEN the adapter receives the host's native write event
THEN it is translated to a canonical pre-write carrying the written content
AND any advisory produced is delivered into the host's model context

GIVEN a canonical command emits an advisory
WHEN the host operation continues
THEN the advisory text is visible to the assistant in that host
AND the host operation is neither blocked nor altered

GIVEN a canonical command errors or exceeds its time bound
WHEN the adapter is driving a host operation
THEN the host operation proceeds unaffected
AND no error is surfaced to the host that would interrupt it

GIVEN a host event that has no Mink meaning
WHEN the adapter receives it
THEN nothing is sent to any canonical command

GIVEN two different hosts are wired to the same project
WHEN one host reads a file and the other later writes a file
THEN both operations are recorded in the same session and project state
AND the file index, ledger, and history reflect both hosts

GIVEN a host wired to Mink
WHEN Mink wiring is removed for that host
THEN the host's configuration no longer references Mink
AND ~/.mink/ state is left intact
AND any other wired host is unaffected
```

## Edge Cases

- A host names its read/create/edit tools or argument fields differently from
  what the adapter expects — the adapter resolves them through an explicit,
  maintainable mapping; an unrecognized tool is treated as "not relevant" and
  ignored rather than misrouted.
- The host does not expose read output to the adapter — post-read still records
  the read and falls back to the file index for token estimation (spec 05).
- The host's "finished responding" event fires multiple times in one session —
  session-stop remains idempotent (spec 01); no duplicate ledger entries.
- The host configuration file already contains unrelated entries — wiring and
  removal touch only Mink's entries and preserve the rest, byte-for-byte where
  possible.
- The same project is opened by two hosts at the same time — concurrent writes
  to `~/.mink/` state remain atomic; last writer wins, no half-written files
  (consistent with specs 01 and 18).
- A host is detected but its configuration location is read-only or absent —
  initialization reports the failure for that host and continues wiring any
  other targeted hosts.
- Mink is invoked from a working directory that differs from the project root
  the host reports — project identity resolution (spec 20) still maps the
  operation to the correct project state.
- A host references Mink by absolute path on one machine and the configuration
  is shared to another machine — portable wiring resolves Mink without the
  original absolute path; non-portable fallbacks are clearly scoped to local-only
  development.
- Removal is requested for a host that was never wired — the operation is a
  no-op and reports as such.

## Test Requirements

### Unit Tests

- Event mapping: each host's native lifecycle/tool events map to the correct
  canonical event, and only the six relevant operations are forwarded.
- Tool-identity normalization: host tool names and argument fields resolve to
  the correct operation kind and payload fields; unrecognized tools are dropped.
- Payload normalization: create vs edit produce the correct written-content
  field; read completion produces the returned-content field when available.
- Idempotent wiring: a second initialization over an already-wired host yields
  exactly one set of Mink entries.
- Selective removal: removing Mink leaves unrelated host configuration intact.
- Advisory routing: feedback emitted by a canonical command is placed where the
  host's model context will see it.

### Integration Tests

- Full lifecycle through one adapter: session-start → read → write →
  session-stop produces the same `~/.mink/` state as the originally supported
  host produces for the same operations.
- Two adapters, one project: reads from one host and writes from another
  accumulate into a single session history, file index, and ledger.
- Multi-host initialization: targeting all detected hosts wires each one and all
  point at the same canonical engine.
- Portability: wiring produced on one machine resolves Mink on a second machine
  without the first machine's absolute paths.
- Removal isolation: removing one host's wiring leaves another wired host fully
  functional and leaves state untouched.

### Edge Cases

- Host provides no read output — post-read falls back to the file index.
- Repeated session-stop events — exactly one ledger entry, updated not
  duplicated.
- Canonical command times out — host operation completes; no interruption.
- Unrelated host configuration preserved across wire and unwire.
- Concurrent operations from two hosts — atomic state, no corruption.

## Appendix: Supported Hosts

This appendix records the concrete mapping for each supported host. It is
informative; the normative requirements are host-neutral and live above.

### Host A — JSON hook configuration with subprocess commands

- **Mechanism.** A settings file declares hook events, each invoking a Mink
  subcommand. Mink receives the normalized payload on standard input and emits
  advisories on the error stream, which the host feeds back to the assistant.
- **Event map.** `SessionStart → session-start`; `Stop → session-stop`;
  `PreToolUse{Read} → pre-read`; `PostToolUse{Read} → post-read`;
  `PreToolUse{Edit,Write} → pre-write`; `PostToolUse{Edit,Write} → post-write`.
- **Tools.** `Read`, `Write` (create), `Edit` (modify); arguments include the
  file path, full content (create), and replacement text (edit).
- **Guidance artifact.** A project rule file describing Mink.
- **Note capture.** Registered as a host skill.
- This host is the existing, reference integration; this spec does not change it.

### Host B — in-process code extension subscribing to events

- **Mechanism.** A code extension auto-discovered from the host's extension
  directories subscribes to lifecycle and tool events in-process. The extension
  invokes the same Mink subcommands as Host A, supplying the normalized payload
  and routing Mink's advisory output back into the model context (for example by
  attaching it to the operation result the assistant observes). The extension
  never blocks an operation.
- **Event map.** `session_start → session-start`; `agent_end` (and
  `session_shutdown` for teardown) `→ session-stop`; `tool_call{read} →
  pre-read`; `tool_result{read} → post-read`; `tool_call{write,edit} →
  pre-write`; `tool_result{write,edit} → post-write`.
- **Tools.** `read`, `write` (create), `edit` (modify); argument and
  result-content field names are resolved through the adapter's mapping table
  and verified against the host's tool definitions.
- **Guidance artifact.** Because this host has no automatic project rules file,
  the guidance is delivered as a host capability (skill or prompt) carrying the
  same content as Host A's rule.
- **Note capture.** Registered as a host capability (skill).
```
