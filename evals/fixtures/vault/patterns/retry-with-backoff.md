---
created: "2026-02-15T09:00:00.000Z"
updated: "2026-02-15T09:00:00.000Z"
tags: [pattern, reliability]
category: areas
---

# Retry With Backoff Pattern

Cross-project pattern for retrying transient failures: start at 250ms,
double each attempt, cap at 8s, and add jitter of up to ±20% to avoid
thundering-herd retries.

Used in [[projects/orion-api/architecture|Orion API Architecture]] for
downstream calls and in Atlas Web's payment webhook retries.
