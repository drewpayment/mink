# 21 — Tool-Output Compression

## Overview

Tool-output compression lets Mink substitute an oversized tool result with a compact, **reversible**
representation before the AI assistant consumes it. When a read, command, search, or other tool
returns a large payload, Mink may replace that payload with a smaller, content-aware summary while
storing the original verbatim. The assistant can retrieve the byte-exact original on demand, so
nothing is lost — compression is a token optimisation, never a deletion.

This is the first capability that actively shrinks the live payload the assistant sees, rather than
only surfacing advisory context. To keep efficiency claims honest, every compression event is
measured against the original, and a configurable fraction of eligible outputs is deliberately left
uncompressed as a control group so that real savings can be reported rather than estimated.

Compression is content-aware, deterministic, and conservative: small outputs are never touched, any
failure falls back to the original output, and the assistant is always told how to recover the full
content.

## Capabilities

### Eligibility and Thresholds

- Compression is considered only for tool outputs whose estimated size exceeds a configurable
  threshold. Outputs at or below the threshold pass through untouched.
- A compression attempt that does not reduce the output by a meaningful margin is discarded; the
  original output is used instead.
- Defaults are conservative: a high size threshold and a minimum savings margin, both adjustable
  through the configuration surface.
- Compression must never delay or block the tool. It operates within the assistant's hook timeout
  budget and yields the original output if it cannot finish in time.

### Content-Aware Compression

The system selects a compression strategy based on the detected shape of the output:

- **Search / match results:** remove duplicate matches, collapse runs of adjacent or repeated lines,
  cap the number of matches shown per file, and drop redundant surrounding context while preserving
  the count of what was omitted.
- **Logs / command output:** keep a leading and trailing window, de-noise repeated lines, and strip
  decorative noise (control sequences, repeated timestamps) that carries no answer-relevant signal.
- **Large file reads:** present a structural summary — the file's signatures, headings, or exported
  names — together with the slice most relevant to the surrounding work.
- **Structured data:** factor out repeated keys and sample large uniform collections, preserving the
  shape and the total element count.

Every compressed result states, compactly, how much was omitted and how to retrieve the original.

### Reversibility

- When Mink compresses an output, it stores the original keyed by a short retrieval token and embeds
  that token in the compressed result.
- The assistant can request the original by its retrieval token and receive it byte-for-byte.
- Stored originals are retained for a configurable window and may be evicted afterward; a retrieval
  request for an expired or unknown token returns a clear, graceful miss rather than an error.

### Measurement and Holdout

- For each compression event, the system records the original token count, the compressed token
  count, and the resulting savings.
- A configurable **holdout** fraction of otherwise-eligible outputs is randomly left uncompressed.
  Both the compressed arm and the holdout arm are recorded.
- Reported savings are derived from these measured records — the difference between original and
  compressed token counts — not from a fixed per-event estimate.

### Non-Blocking and Graceful Degradation

- Any error in detection, compression, measurement, or storage results in the original, unmodified
  output being passed through.
- Missing or corrupted state never crashes the tool flow; the event is skipped quietly.
- Compression is advisory to Mink's own pipeline: the assistant's tool always returns a usable
  result.

## Acceptance Criteria

```
GIVEN a tool output whose estimated size is above the compression threshold
WHEN the output is processed
THEN the assistant receives a compressed representation
AND the compressed representation includes a retrieval token and a note of what was omitted

GIVEN a tool output whose estimated size is at or below the compression threshold
WHEN the output is processed
THEN the assistant receives the original output unchanged
AND no original is stored for retrieval

GIVEN an output was compressed and assigned a retrieval token
WHEN the assistant requests the original by that token
THEN it receives the original content byte-for-byte

GIVEN an output was compressed and its retention window has elapsed
WHEN the assistant requests the original by its token
THEN it receives a clear miss indicating the original is no longer available
AND no error disrupts the assistant

GIVEN a holdout fraction is configured above zero
WHEN a large eligible output is selected into the holdout
THEN the assistant receives the original output uncompressed
AND the event is recorded as a holdout arm with its original token count

GIVEN a compression event that reduced an output from N to M tokens
WHEN savings are reported
THEN the reported savings for that event equals N minus M

GIVEN a compression attempt that fails or yields no meaningful reduction
WHEN the output is processed
THEN the assistant receives the original output
AND the flow completes successfully

GIVEN a task that requires content omitted from a compressed result
WHEN the assistant retrieves the original by its token and continues
THEN the task can be completed using the recovered content
```

## Edge Cases

- Output is already small — pass through untouched; do not store an original or emit a token.
- Output is binary or non-text — skip compression and retrieval; record nothing.
- Compression produces output no smaller than the original — discard the attempt, use the original.
- Retrieval token is unknown or expired — return a graceful miss, never an error.
- Partial or range reads — eligibility and compression still apply, but to the returned slice only.
- Original exceeds the storage cache's limits — skip storing it and therefore skip compression, so a
  retrievable original always exists whenever a compressed result is shown.
- Two outputs hash to identical content — may share a single stored original without correctness loss.
- Holdout selection must be stable for a given event so measurement is not double-counted.

## Prompt-Cache Stability

- Stored originals live in the structured state store and are never injected raw into model context.
- Any human- or agent-readable derived markdown (savings reports, compression digests) follows
  Mink's layout rule: stable structure and legends at the top, volatile aggregates (measured
  savings, last-compression timestamp, per-device counters) under a footer marker at the bottom.
- A compressed substitution placed into context should be self-contained and stable, so that
  re-rendering the same result does not perturb the cached prefix.

## Test Requirements

- Unit: each content-aware strategy (search results, logs, large file reads, structured data)
  produces a smaller, well-formed result that names what was omitted.
- Unit: threshold logic — below-threshold passes through, above-threshold compresses, no-gain
  attempts are discarded.
- Unit: holdout selection — a configured fraction is selected, selection is stable per event.
- Unit: token measurement accuracy on code, prose, mixed, and empty content.
- Integration: tool → compress → retrieve round-trip returns the byte-exact original.
- Integration: the ledger records paired compressed and holdout arms with correct token counts.
- Property: retrieval is always byte-exact for any stored original within its retention window.
- Property: reported per-event savings equals original tokens minus compressed tokens.
- Edge: expired/unknown retrieval token returns a graceful miss.
- Edge: binary, already-small, and no-gain outputs are passed through unchanged.
- Performance: compression and storage complete within the hook timeout budget on a large output.
