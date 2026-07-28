# 26 — Context Pack

## Overview

Mink already reduces waste reactively — warning on redundant reads, compressing
oversized tool output. This capability front-loads the right context instead:
it assembles a single, compact prefix for a project — the project's learned
rules, its most relevant recorded bugs, and a skeleton of its file index — that
an assistant can load once at the start of a session and reuse across turns,
rather than rediscovering the project by reading files.

The pack is built to be **prompt-cache friendly**. Its stable, high-signal
content is ordered deterministically at the top; every volatile field (a
timestamp, aggregate counts) lives below a footer marker. For unchanged project
state, the content above the marker is byte-identical from one build to the next,
so a client that caches the prefix gets a cache hit rather than a perturbed
prefix.

The pack is bounded by a configurable token budget, so it is predictable in size
and never crowds out the working context.

## Capabilities

### Assembly

- The pack contains, in a fixed order: a project header, the project's learned
  rules (grouped by their sections), the most relevant recorded bugs, and a
  file-index skeleton (each file with its one-line description).
- Sections and their entries are emitted in a deterministic order, independent of
  storage or insertion order.
- Recorded bugs are ranked deterministically — most-recurring first, then
  most-recent, with a stable final tie-break — so the same state always yields
  the same ranking.

### Budget

- The pack is bounded by a token budget, configurable and overridable per
  invocation.
- Higher-signal, smaller content (rules, then bugs) is included ahead of the
  larger file skeleton; when the budget is reached, the lowest-priority content
  is truncated and the omission is noted.

### Cache Stability

- Volatile fields appear only below a footer marker; the content above the marker
  is byte-identical across builds for unchanged project state.
- The pack interpolates nothing volatile into its stable region, so re-rendering
  it does not perturb a cached prefix.

### Surfaces

- The pack is available as a command that prints it, and as a pull tool an
  assistant can call to obtain it on demand.

## Acceptance Criteria

```
GIVEN a project with learned rules, recorded bugs, and an indexed file set
WHEN the context pack is built
THEN it contains the rules, the top-ranked bugs, and the file skeleton, each in
     a deterministic order

GIVEN unchanged project state
WHEN the pack is built twice at different times
THEN the content above the volatile marker is byte-identical on both builds

GIVEN a token budget smaller than the full content
WHEN the pack is built
THEN lower-priority content is truncated, the omission is noted, and the pack
     stays within the budget

GIVEN two recorded bugs with different occurrence counts
WHEN the pack is built
THEN the more-recurring bug is listed before the less-recurring one

GIVEN a project with no rules, bugs, or indexed files
WHEN the pack is built
THEN it still produces a valid header and footer without error
```

## Edge Cases

- Empty project — header + footer only; no error.
- Budget smaller than a single section — the header is always kept; other
  sections truncate.
- Very large file index — truncated to the budget with a noted remainder count.
- Missing or empty learned rules / bug memory — those sections are omitted.

## Prompt-Cache Stability

- The stable region carries no timestamps or per-device counters; those live
  under the footer marker, so an identical project state yields an identical
  cache prefix.

## Test Requirements

- Unit: the pack includes rules, bugs, and files; deterministic bug ranking; the
  stable prefix is byte-identical across builds at different times; volatile
  fields appear only below the marker; the budget truncates the file section; an
  empty project produces a valid pack.
