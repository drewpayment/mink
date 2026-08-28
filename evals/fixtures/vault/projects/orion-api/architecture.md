---
created: "2026-02-10T10:30:00.000Z"
updated: "2026-05-22T11:00:00.000Z"
tags: [orion-api, architecture, backend]
category: projects
source_project: orion-api
---

# Orion API Architecture

Orion API is a stateless service behind an internal gateway. Postgres is the
system of record; Redis is used for caching and rate limiting.

The rate limiter uses a sliding-window algorithm backed by Redis, with a
60-second window and a 120-request burst allowance per API key. This
replaced a fixed-window counter that under-throttled bursty clients.

For the general caching approach (not just rate limiting), see
[[resources/redis-caching-patterns|Redis Caching Patterns]].

Postgres connection pooling follows the guidance in
[[resources/postgres-connection-pooling|Postgres Connection Pooling Guide]].
