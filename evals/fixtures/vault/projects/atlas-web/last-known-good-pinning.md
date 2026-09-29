---
created: "2026-04-12T15:00:00.000Z"
updated: "2026-05-30T15:00:00.000Z"
tags: [atlas-web, cdn, operations]
category: projects
source_project: atlas-web
---

# Last-Known-Good Build Pinning

Atlas Web is served from a CDN alias named `live` that points at an
immutable build hash. If a deploy misbehaves, repoint the alias at the
previous hash with `atlas alias set live <hash>` — it takes effect in under
a minute and needs no rebuild.

The last five build hashes are listed in the deploy channel topic.

See [[projects/atlas-web/overview|Atlas Web Overview]].
