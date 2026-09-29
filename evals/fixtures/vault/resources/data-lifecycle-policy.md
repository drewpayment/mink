---
created: "2026-02-20T09:00:00.000Z"
updated: "2026-06-12T09:00:00.000Z"
tags: [policy, data, resources]
category: resources
---

# Data Lifecycle Policy

Request records are kept 30 days in hot storage and then dropped. Audit
records are kept for 1 year in cold storage, then deleted. Retention for
Orion API logs follows the request-record rule: 30 days.

Exceptions require sign-off from the platform team.
