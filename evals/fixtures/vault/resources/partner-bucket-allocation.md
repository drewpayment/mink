---
created: "2026-05-28T10:00:00.000Z"
updated: "2026-06-02T10:00:00.000Z"
tags: [partners, gateway, resources]
category: resources
---

# Partner Bucket Allocation

External partners calling the public gateway each get a token bucket:
capacity 200, refilled at 20 tokens per second. Every request spends one
token, and when a partner's bucket is empty the gateway answers 429 with a
`Retry-After` header instead of forwarding the call.

Buckets are keyed by partner ID, not by IP, so a partner behind a shared
NAT can't starve its neighbours. Sizing exceptions go through the platform
team.

Related: [[projects/orion-api/overview|Orion API]].
