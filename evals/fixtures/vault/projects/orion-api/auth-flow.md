---
created: "2026-02-18T08:45:00.000Z"
updated: "2026-04-02T09:10:00.000Z"
tags: [orion-api, auth, security]
category: projects
source_project: orion-api
---

# Orion API Auth Flow

Orion API uses short-lived access tokens plus a refresh token. The refresh
token is rotated on every use and expires after 14 days of inactivity.

Related: [[projects/orion-api/overview|Orion API Overview]],
[[areas/sec-checklist|Security Checklist]].
