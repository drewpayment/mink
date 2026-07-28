# Delivery Plan — MCP Server (Spec 24)

> **✅ Delivered.** Formal spec: [`24-mcp-server.md`](./24-mcp-server.md). Architecture:
> [`../docs/mcp-server.md`](../docs/mcp-server.md). Implemented as `mink mcp` in three phases (all
> seven tools), hand-rolled JSON-RPC 2.0 over stdio, zero new runtime dependencies, dual Node/Bun.

**Status:** Transient. Delete this file once spec 24 is considered stable and the follow-ups in
*Deferred* below are either shipped or ticketed elsewhere.

**Branch convention:** cut feature branches per phase; target PRs at an integration branch,
**never at `main`**. Each phase below is independently mergeable.

## Background

Mink surfaces knowledge to an assistant two ways. The lifecycle hooks *push* context and compress
oversized tool output as the assistant works. This capability adds the complementary *pull* surface:
a long-running server that exposes each project's Mink state as callable tools, so the assistant can
request exactly the context it needs on demand — and, for the first time, write back.

The pull surface is the single biggest real token lever: fetch the right ~300 tokens when needed
rather than paying to inject context every turn. It was cheap to reach because Mink already parses
`mcp__*` tool outputs in the Pi adapter (`src/core/agent-pi.ts:176`) and already has a retrieval
store + command (`src/commands/retrieve.ts`, `src/repositories/compression-cache-repo.ts`). This flips
the relationship: Mink becomes a server, not just a consumer.

The work is sequenced by leverage and risk: stand up the transport with the safest tool first, then
the read tools, then the write tools (which carry the added responsibility of persistence).

| Phase | Theme | Risk | Why this order |
|------|-------|------|----------------|
| 1 | Transport + `mink_retrieve` | Low | Proves the protocol end-to-end on a read-only, already-reversible capability |
| 2 | Read tools | Low–Med | Pure pull; no persistence, no new safety surface |
| 3 | Write tools | Med | First mutating surface; requires redaction before persistence |

## Guardrails (apply to every phase)

- **No new runtime dependencies.** JSON-RPC 2.0 and the MCP method subset are hand-rolled; the
  bundle must gain nothing. Verified against `package.json`.
- **Dual runtime.** Builds and passes under both Node and Bun; `bunx tsc --noEmit` stays clean.
- **Non-blocking, never crash the caller.** Per-request failures become JSON-RPC errors or `isError`
  results; the long-lived process never `process.exit`s on a request.
- **Reversible / honest.** `mink_retrieve` returns byte-exact originals; a miss is a graceful
  message, never data loss.
- **Safe to sync.** Any write tool redacts secrets before content touches disk.
- **stdout is the protocol channel.** All diagnostics go to stderr.

---

## Phase 1 — Transport + `mink_retrieve`

Goal: a `mink mcp` command that speaks JSON-RPC 2.0 over newline-delimited stdio, with the first tool
recovering compressed originals.

- New `mink mcp` command — register a `case "mcp"` in `src/cli.ts` and add `src/commands/mcp.ts`
  (long-lived entry; SIGINT/SIGTERM checkpoint the WAL before exit).
- Layered server under `src/core/mcp/`: `jsonrpc.ts` (pure framing + builders), `tool-types.ts`
  (tool contract, arg validation, the `ToolInputError`→`-32602` vs `McpToolError`→`isError` split),
  `protocol.ts` (deterministic method router: initialize, ping, tools/list, tools/call,
  notifications), `server.ts` (newline-framed stdio transport, sequential processing, injectable
  streams, 16 MiB frame guard), and `tools/` (the registry).
- First tool `mink_retrieve(token)` wraps `CompressionCacheRepo.for(cwd).get(token)`, closing the
  spec-22 compression loop as a proper pull tool; unknown/expired token is a graceful miss.
- Project scoping: resolve state against the launch `cwd` via the stable identity resolver
  (`src/core/project-id.ts`).
- Protocol version negotiation: `2025-06-18` and `2024-11-05`.

**Exit:** an MCP client completes the handshake, lists tools, and retrieves a byte-exact original;
stdout carries only protocol frames.

## Phase 2 — Read tools

Goal: pull tools so the assistant fetches precise context instead of reading whole files.

- `mink_recall_bugs(query, file?, limit?)` → `src/repositories/bug-memory-repo.ts` FTS5 search
  (semantic once spec 25 lands), formatted with cause, fix, occurrences, match reasons.
- `mink_search_wiki(query, limit?)` → `src/core/note-index.ts` vault search; gates cleanly when the
  wiki is disabled/uninitialized.
- `mink_file_skeleton(path)` → `src/core/code-skeleton.ts` / `description.ts` structural summary — a
  signature map instead of the whole file; missing file is a graceful miss.
- `mink_project_rules(section?)` → merged learning memory via `src/core/state-aggregator.ts`.

**Exit:** each read tool returns compact, cache-stable output end-to-end; all marked `readOnlyHint`.

## Phase 3 — Write tools

Goal: let the assistant capture back into Mink, safely.

- `mink_capture_note(body, title?, tags?, category?)` → `src/core/note-writer.ts` (same path as
  `mink note`); derives a title from the first line when omitted.
- `mink_log_bug(error, file, rootCause, fix, line?, tags?)` → bug memory repo; re-logging the same
  `(error, file)` bumps the occurrence count.
- **Redaction before persistence** — both tools pass every text field through `src/core/redact.ts`, a
  conservative, high-precision secret redactor (the seed of spec 28), because captured content may
  sync to a git remote.

**Exit:** a note is captured and indexed, a bug is logged and searchable, and a planted secret is
masked on disk.

## Cross-cutting

- Tests per the spec's Test Requirements: unit (framing, protocol matrix, transport, redactor) +
  integration (every tool through the full server against real state). 91 tests, all green.
- Docs: `docs/mcp-server.md` (architecture) and `specs/24-mcp-server.md` (contract).

## Validation before each phase merges

- No new dependency in `package.json`; `bunx tsc --noEmit` clean; `bun test` green for the MCP suite
  under both runtimes.
- Phase 1: live stdio smoke — initialize, tools/list, retrieve round-trip byte-exact, unknown method
  → `-32601`.
- Phase 2: each tool returns real state; graceful-miss and `INVALID_PARAMS` paths covered.
- Phase 3: on-disk redaction proof; occurrence-count bump on duplicate.

## Deferred (follow-ups, deliberately out of this delivery)

- **Avoided-read ledger arm** — recording a measured "read avoided" when a skeleton/recall replaces a
  full read. Belongs with spec 25's measurement work.
- **Full redaction (spec 28)** — broaden recall and apply the same pass at every persistence
  boundary; `src/core/redact.ts` is the seed.
- **Cross-project targeting** — an optional `project` argument resolving via the project registry
  (spec 20), documented as a forward extension.
