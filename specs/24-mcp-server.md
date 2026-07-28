# 24 — MCP Server (Pull Surface)

## Overview

Mink surfaces its knowledge to an AI coding assistant in two ways. The lifecycle
hooks *push* context and compress oversized tool output as the assistant works.
This capability adds the complementary *pull* surface: a long-running server that
exposes Mink's per-project state as callable tools, so an assistant can request
exactly the context it needs, on demand, rather than only receiving whatever the
hooks decide to inject.

The pull surface is the largest real token lever Mink has: instead of paying to
inject context every turn, the assistant fetches a small, precise result at the
moment it needs it. It is also the first surface through which an assistant can
*write* back into Mink — capturing a note or logging a bug — closing the loop
between working and remembering.

The server speaks a standard, host-agnostic tool protocol over a local stream,
so a single implementation serves any compatible assistant with no per-host
code. It is off unless launched, adds no new runtime dependencies, and runs
identically under both supported runtimes.

## Capabilities

### Server Lifecycle

- A dedicated command starts the server as a long-lived process that
  communicates over a local stream using a standard request/response protocol.
- The process runs until its input stream closes or it receives a termination
  signal, at which point it flushes and safely closes all storage it opened.
- Unlike Mink's one-shot commands, a per-request failure never terminates the
  process; the server reports the error and continues serving.
- The protocol channel carries only protocol messages; all diagnostics are
  emitted on a separate channel so the protocol stream is never corrupted.

### Capability Negotiation

- On connection, the server reports its identity, its version, the set of
  capabilities it offers, and human-readable usage guidance.
- The server negotiates the protocol revision: when the client requests a
  revision the server supports, that revision is used; otherwise the server
  offers its most recent supported revision and the client decides whether to
  proceed.

### Tool Discovery and Invocation

- The server advertises a list of tools, each with a name, a display title, a
  description, a machine-readable description of its arguments, and advisory
  behavioural hints (for example, whether the tool only reads state).
- A client may invoke any advertised tool by name with arguments; the server
  validates the arguments, executes the tool, and returns a textual result.
- Malformed invocations (unknown tool, missing or mistyped argument) are
  reported as protocol-level invalid-parameter errors, distinct from a tool that
  executed and failed, which is reported as a tool result flagged as an error so
  the assistant can read the message and adapt.
- A tool that finds nothing to return (an unknown retrieval key, no matching
  records, a disabled subsystem) returns a normal, descriptive result — never an
  error — so the assistant is never stranded.

### Retrieval Tool

- A tool returns the byte-exact original of a previously compressed tool output
  given its retrieval key, honouring the reversibility guarantee of the
  compression capability.
- An unknown or expired key yields a graceful miss rather than an error.

### Read Tools

- A tool searches the project's bug memory for records relevant to a query,
  optionally biased toward a file, returning each match's cause, fix, and
  supporting detail.
- A tool searches the cross-project knowledge vault by keyword and returns
  matching entries with their location and category; when the vault is disabled
  or uninitialized it says so plainly.
- A tool returns a structural summary of a file — its declarations, signatures,
  or headings with detail elided — so the assistant can grasp the file's shape
  without consuming it in full; a missing file is a graceful miss.
- A tool returns the project's accumulated rules and learnings, optionally
  restricted to one section.

### Write Tools

- A tool captures a note into the cross-project vault, deriving a title when one
  is not supplied and validating the target category.
- A tool records a bug — its error, location, cause, and fix — into the
  project's bug memory; recording the same error in the same file again
  increments its occurrence count rather than creating a duplicate.
- Every write tool passes all supplied content through a secret-redaction pass
  before anything is persisted, because captured content may later be
  synchronised off the machine.

### Project Scoping

- Each tool operates on the project identified by the working directory the
  server was launched in, resolved through Mink's stable project identity.
- State that is intentionally cross-project (the knowledge vault) is served
  across all projects regardless of the launch directory.

## Acceptance Criteria

```
GIVEN a running server and a client that requests a supported protocol revision
WHEN the client initializes the connection
THEN the server returns its identity, version, offered capabilities, and the
     agreed protocol revision

GIVEN a client that requests an unsupported protocol revision
WHEN the client initializes the connection
THEN the server returns its most recent supported revision rather than failing

GIVEN an initialized connection
WHEN the client lists available tools
THEN it receives every offered tool with a name, description, and a
     machine-readable description of that tool's arguments

GIVEN a compressed tool output that was assigned a retrieval key
WHEN the client invokes the retrieval tool with that key
THEN it receives the original content byte-for-byte

GIVEN a retrieval key that is unknown or whose retention window has elapsed
WHEN the client invokes the retrieval tool with that key
THEN it receives a graceful miss, and no error disrupts the connection

GIVEN a project with recorded bugs
WHEN the client invokes the bug-recall tool with a relevant query
THEN it receives the matching records with their cause and fix

GIVEN a tool invocation that omits a required argument
WHEN the server processes it
THEN it returns an invalid-parameter error, distinct from a tool-execution error

GIVEN a tool that executes and fails
WHEN the server processes the invocation
THEN it returns a result flagged as an error carrying the failure message,
     and the server continues serving subsequent requests

GIVEN a write tool invoked with content that contains a secret
WHEN the tool persists that content
THEN the persisted content has the secret masked

GIVEN the same bug reported twice for the same error and file
WHEN the second report is recorded
THEN no duplicate is created and the occurrence count is incremented

GIVEN a request that cannot be parsed
WHEN the server receives it
THEN it returns a parse error without terminating the process

GIVEN the server is asked to stop
WHEN it shuts down
THEN it flushes and safely closes all storage it opened
```

## Edge Cases

- Input that is not valid protocol content — return a parse error; keep serving.
- A message that is a notification (expects no reply) — process it and send no
  response.
- A tool invocation for a name that is not advertised — invalid-parameter error.
- A retrieval key that is unknown or expired — graceful miss, not an error.
- A read tool whose backing subsystem is empty or disabled — normal descriptive
  result, not an error.
- A structural-summary request for a path that is a directory or does not
  exist — graceful miss.
- Content supplied to a write tool that contains a secret — masked before
  persistence; a false-positive-averse redactor leaves ordinary text intact.
- An oversized or unterminated request frame — bounded and rejected without
  exhausting memory.
- Concurrent state access while the long-lived process holds storage open —
  storage is flushed and safely closed on shutdown so other processes are not
  left with a torn store.

## Prompt-Cache Stability

- Tool descriptions and results are deterministic for the same inputs, so
  re-issuing an identical call does not perturb a cached context prefix.
- Retrieval returns stored originals verbatim; nothing volatile is interpolated
  into a tool result that would change on re-render.

## Test Requirements

- Unit: protocol framing — valid, malformed, and non-object messages; request vs
  notification; single-line serialization; identifier round-trip.
- Unit: method routing — capability negotiation (supported, unsupported, and
  absent revision), tool listing shape, tool invocation routing, the
  invalid-parameter vs tool-error distinction, unknown method and unknown tool,
  and identifier echo.
- Unit: transport — blank input, notifications, parse-error frames, multiple
  messages in one chunk, a message split across chunks, a trailing message with
  no delimiter.
- Unit: redaction — each high-confidence secret shape masked; ordinary text and
  short values untouched; deterministic output.
- Integration: each tool exercised end-to-end through the server against real
  state — byte-exact retrieval, bug recall, vault search, structural summary,
  merged rules, note capture with on-disk redaction, and bug persistence with
  occurrence increment.
- Edge: invalid-parameter paths for every tool; graceful-miss paths for
  retrieval, recall, and structural summary.
```
