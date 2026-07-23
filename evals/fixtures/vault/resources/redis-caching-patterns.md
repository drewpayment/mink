---
created: "2026-02-08T09:00:00.000Z"
updated: "2026-02-08T09:00:00.000Z"
tags: [redis, caching, resources]
category: resources
---

# Redis Caching Patterns

The default pattern across our services is cache-aside: read from cache,
on a miss read from the source of truth and populate the cache, write
through Postgres on writes and let the cache entry expire or be
invalidated explicitly.

Avoid write-through caching unless the write path can tolerate the extra
latency — most of our services can't.

Consumed by [[projects/orion-api/architecture|Orion API Architecture]].
