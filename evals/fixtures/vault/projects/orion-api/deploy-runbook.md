---
created: "2026-02-05T13:00:00.000Z"
updated: "2026-05-01T13:00:00.000Z"
tags: [orion-api, runbook, deploy]
category: projects
source_project: orion-api
---

# Orion API Deploy Runbook

Standard deploy steps for Orion API:

1. Merge to `main`, wait for CI.
2. Tag a release; the pipeline builds and pushes the image.
3. Roll out to staging first, watch error rate + p99 latency for 10 minutes.
4. Promote to production via the gateway's canary flag, 10% → 50% → 100%.

Rollback: revert the canary flag to the previous image tag; no DB migration
should ever ship without a paired down-migration.

See [[projects/orion-api/architecture|Architecture]] for what the service
depends on.
