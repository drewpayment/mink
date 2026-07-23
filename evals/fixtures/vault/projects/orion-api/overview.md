---
created: "2026-02-03T09:12:00.000Z"
updated: "2026-06-15T14:02:00.000Z"
tags: [orion-api, backend, platform]
category: projects
source_project: orion-api
---

# Orion API

Orion API is the backend service that replaced the legacy monolith's order
and inventory endpoints. It's a Node.js service fronted by an internal
gateway, backed by Postgres and Redis.

Owned by the platform team. See [[projects/orion-api/architecture|Architecture]]
for internals and [[projects/orion-api/deploy-runbook|Deploy Runbook]] for
shipping changes.
