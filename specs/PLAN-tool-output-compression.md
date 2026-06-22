# Delivery Plan — Tool-Output Compression (Spec 21)

**Status:** Transient. Delete this file once spec 21 is fully delivered and tool-output compression
ships with measured savings in the ledger.

**Branch convention:** cut feature branches per phase from the integration work; target PRs at the
agreed integration branch, **never at `main`**. Each phase below is independently mergeable.

## Background

Spec 21 is the first capability that actively shrinks the live payload the assistant consumes. The
interception point is native to Claude Code: a `PostToolUse` hook may return
`hookSpecificOutput.updatedToolOutput` to replace a tool's result before the assistant sees it
(verified against the Claude Code hooks reference). No HTTP proxy, no SDK wrapper, and — per the
approved direction — **no ML dependencies**. Compression is deterministic and reversible.

The work is sequenced by leverage and risk: build the measurement instrument first so every
subsequent change is provably a win, then ship the marquee inline-compression capability, then raise
compression ratios with structural compressors.

| Phase | Theme | Risk | Why this order |
|------|-------|------|----------------|
| 1 | Measurement foundation | Low | Instruments everything; defends savings claims before changing payloads |
| 2 | Inline compression + reversible cache | Medium | The marquee capability; safe because originals are retrievable |
| 3 | Structural compressors | Low–Med | Raises ratios on code/JSON once the pipeline and safety net exist |

## Guardrails (apply to every phase)

- **No new ML/model dependencies.** Validate `package.json` gains no tokenizer-model, ONNX, or
  HuggingFace packages. A deterministic, local tokenizer library is acceptable; model inference is not.
- **Reversible or nothing.** Never show a compressed result unless the byte-exact original is stored
  and retrievable.
- **Conservative defaults.** High size threshold, meaningful minimum savings margin, holdout on so
  savings are measured from day one.
- **Non-blocking.** Every failure path falls back to the original output within the hook timeout.

---

## Phase 1 — Measurement foundation

Goal: replace the heuristic `index_hits × 200` savings story with **measured** original-vs-compressed
token deltas, and stand up the holdout mechanism — before any payload is altered.

- **Real tokenizer** — `src/core/token-estimate.ts`
  - Add a deterministic local token-count path; keep the existing char-ratio estimate
    (3.5 code / 4.0 prose / 3.75 mixed) as the fallback when the tokenizer is unavailable.
  - Expose a single `estimateTokens(text, opts)` surface so all call sites benefit without change.
- **Ledger: paired arms** — `src/repositories/token-ledger-repo.ts`, schema in `src/storage/schema.ts`
  - Add per-event records carrying `original_tokens`, `compressed_tokens`, and a `holdout` flag
    (new child table or columns alongside `ledger_reads`/`ledger_writes`).
  - Add a measured-savings aggregate (`sum(original − compressed)` over compressed arms) surfaced
    next to the existing estimate; keep the old figure for continuity.
- **Holdout selection** — small helper (e.g. `src/core/output-compression.ts` stub or
  `src/core/holdout.ts`): stable per-event selection so an event is never double-counted.
- **Config switches** — reuse `src/core/global-config.ts` (`resolveConfigValue` / `setConfigValue`
  and the `ConfigKey` set): add keys for size threshold, minimum savings margin, holdout fraction,
  and retention window. Mirror the configuration surface in spec 18 where relevant.

**Exit:** a session can record compressed/holdout arms and report a measured delta, with compression
itself still a no-op (threshold effectively infinite). No payloads changed yet.

## Phase 2 — Inline compression + reversible cache (marquee)

Goal: compress oversized tool outputs through `updatedToolOutput`, with a reversible cache and a
retrieve path.

- **Reversible cache** — `mink.db`
  - New table (schema in `src/storage/schema.ts`) keyed by a short retrieval token storing the
    original content, content hash, created-at, and size; eviction by the configured retention
    window. New repo mirroring `src/repositories/bug-memory-repo.ts`.
- **Compression engine** — `src/core/output-compression.ts`
  - Deterministic, content-type routed: search/match results, logs/command output, large file reads
    (reuse `src/core/description.ts` for structural summaries), structured data.
  - Each strategy returns `{ compressed, omittedNote }`; the engine attaches the retrieval token and
    discards any attempt that does not beat the minimum savings margin.
- **Hook wiring** — `src/commands/post-read.ts` plus new post-tool hooks
  - On eligible large outputs, store the original, build the compressed form, and return
    `hookSpecificOutput.updatedToolOutput` (extend the output types in `src/types/hook-input.ts` /
    the hook-output type).
  - Add post-tool hooks for the richest targets — command (Bash) and search (Grep) outputs — and
    MCP tool outputs where available, following the existing non-blocking / timeout hook contract.
  - Honour the Phase-1 holdout: selected events pass through uncompressed but are still recorded.
- **Retrieve path**
  - `mink retrieve <token>` CLI command returning the byte-exact original; optional MCP tool exposing
    the same. Embed a compact retrieval affordance in every compressed result so the assistant knows
    how to recover full content.

**Exit:** a large grep/log/read is delivered compressed; `mink retrieve <token>` returns the original
byte-for-byte; the ledger shows measured savings; a task needing the full content succeeds via retrieve.

## Phase 3 — Structural compressors

Goal: raise compression ratios on code and structured data with deterministic, structural techniques
(the non-ML half of Headroom's SmartCrusher / CodeCompressor).

- **JSON-crush** — factor repeated keys, sample large uniform arrays, preserve shape and counts.
- **AST signature extraction** — extend `src/core/description.ts` from one-line descriptions toward
  richer skeletons (signatures, exports, headings). Start with the languages Mink already handles for
  descriptions; expand opportunistically.
- Feed both the compression engine (Phase 2) and the file index, so richer skeletons improve
  index-hit substitutions too.

**Exit:** code and JSON outputs compress meaningfully better while remaining reversible and
deterministic.

## Cross-cutting

- Tests per spec 21's Test Requirements (unit per strategy + threshold + holdout + tokenizer;
  integration round-trip + paired-arm ledger; property byte-exactness + savings math; edge + perf).
- Update `specs/16-test-plan.md` coverage notes to include spec 21.
- Keep defaults conservative; let holdout-measured savings justify any later loosening.

## What this plan intentionally does not cover

- ML/model-based compression (kompress/ONNX/HuggingFace) — out of scope by design.
- An HTTP proxy or SDK-level wrapper — unnecessary given `updatedToolOutput`.
- Output-token steering / verbosity / effort routing — deprioritised; weakly supported by hooks.
- External memory stores (Neo4j/Qdrant) — Mink's SQLite + FTS already suffices.

## Validation before each phase merges

- No new ML/model dependency added to `package.json`.
- `bunx tsc --noEmit` clean at repo root; `bun test` green (excluding known pre-existing flakes).
- Phase 1: ledger reports a measured delta with compression disabled.
- Phase 2: manual smoke — trigger a large output, confirm the assistant receives the compressed form,
  `mink retrieve <token>` returns the byte-exact original, and retrieval-dependent tasks still succeed.
- Phase 3: measured ratios on code/JSON improve over Phase 2 with retrieval still byte-exact.
