---
created: "2026-02-01T09:00:00.000Z"
updated: "2026-02-01T09:00:00.000Z"
tags: [postgres, database, resources]
category: resources
---

# Postgres Connection Pooling Guide

A reasonable starting pool size, absent measured contention, is:

```
((core_count * 2) + effective_spindle_count)
```

On SSD-backed instances `effective_spindle_count` is typically 1. Tune from
there based on observed connection wait times, not guesswork.

Used by [[projects/orion-api/architecture|Orion API Architecture]].
