---
created: "2026-03-11T16:20:00.000Z"
updated: "2026-03-12T09:05:00.000Z"
tags: [orion-api, incident, postmortem]
category: projects
source_project: orion-api
---

# Orion API Cache Outage — March 2026

On 2026-03-11, Orion API served elevated error rates for roughly 40 minutes.

Root cause: a stale DNS TTL of 3600 seconds on the Redis client pointed at a
Redis node that had already been decommissioned during the prior week's
infra migration. Clients kept dialing the dead IP until the TTL finally
expired and re-resolution picked up the new node.

Fix: dropped the client-side DNS TTL override and now rely on the
platform's short-TTL resolver. See [[projects/orion-api/architecture|Architecture]]
for the caching layer this affected.
