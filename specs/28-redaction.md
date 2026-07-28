# 28 — Secret / PII Redaction

## Overview

Mink persists content that can contain secrets or personal data — captured
notes, recorded bugs, tool output — and it can synchronise that state to a git
remote. This capability masks high-confidence secret and PII shapes before
content is written, at every persistence boundary, so nothing sensitive lands on
disk or in a synced remote regardless of which code path produced it.

The redactor is deliberately high-precision: it matches distinctive secret
shapes rather than guessing from entropy, so it does not mangle legitimate prose
or code, and it explicitly avoids masking bare long hex/base64 runs that would
swallow commit hashes and content digests. It is deterministic, so it never
perturbs a cache prefix or a measurement.

The pass is on by default, honors an allowlist of known-safe values, and can be
disabled by configuration.

## Capabilities

### Detection

- Masks high-confidence secret shapes — private-key blocks (including a truncated
  block with no footer), cloud provider keys and OAuth tokens, service tokens,
  JWTs, bearer tokens, and secret-named assignments — and personal data such as
  email addresses.
- Masks only the sensitive value, preserving surrounding context where the shape
  allows (e.g. a secret-named assignment keeps its key).
- Does not mask shapes that produce frequent false positives (bare long
  hex/base64 runs such as commit hashes).

### Boundaries

- Redaction is applied at the persistence boundaries that store free text —
  recorded bugs and captured notes — so every caller (hooks, CLI, and the pull
  tools) is covered, not just one entry point.
- Applying redaction to already-redacted text is idempotent.
- For captured notes, redaction happens before any title is turned into a
  filename, so a filename cannot leak a secret.

### Configuration

- Redaction is on by default and can be disabled by configuration; when disabled,
  content is stored unchanged.
- An allowlist of exact values is never masked, so a known-safe value (for
  example a public example key or a shared team address) can be exempted.

## Acceptance Criteria

```
GIVEN content containing a high-confidence secret
WHEN it is stored at a persistence boundary
THEN the persisted content has the secret masked

GIVEN content containing a personal email address
WHEN it is stored
THEN the email is masked

GIVEN a secret-named assignment
WHEN it is redacted
THEN the value is masked and the key remains legible

GIVEN a 40-character commit-hash-like hex string
WHEN it is redacted
THEN it is left intact (no false-positive masking)

GIVEN a value present in the allowlist
WHEN redaction runs
THEN that value is left intact

GIVEN redaction is disabled by configuration
WHEN content is stored
THEN it is stored unchanged

GIVEN a captured note whose title contains a secret
WHEN the note is written
THEN neither the file contents nor the derived filename contains the secret

GIVEN already-redacted content
WHEN it passes through redaction again
THEN it is unchanged
```

## Edge Cases

- Truncated private-key block (no end footer) — masked to the next blank line or
  end of text.
- Provider-specific and assignment rules overlapping on one value — the value is
  masked once by the first matching rule.
- Empty or non-text content — returned unchanged.
- Allowlist entries — matched by exact value only.

## Prompt-Cache Stability

- Redaction is deterministic: identical input yields identical output, so it does
  not perturb a cached prefix or a measured savings figure.

## Test Requirements

- Unit: each secret/PII shape is masked; the assignment rule keeps its key; a
  commit-hash-like hex string is not masked; an allowlisted value is preserved;
  the config-aware wrapper redacts when enabled, passes through when disabled, and
  honors the allowlist.
- Integration: a bug recorded through the store and a note written through the
  writer both have secrets masked on disk, regardless of caller.
