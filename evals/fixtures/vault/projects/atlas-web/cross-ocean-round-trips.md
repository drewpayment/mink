---
created: "2026-06-05T11:00:00.000Z"
updated: "2026-06-25T11:00:00.000Z"
tags: [atlas-web, performance, infrastructure]
category: projects
source_project: atlas-web
---

# Cross-Ocean Round Trips

Shoppers in Frankfurt and Paris see a 2.4s p95 first paint because every
API call travels to us-east-1 and back. Nothing is wrong with the code; the
distance is the cost.

Plan: stand up an edge cache in eu-central for catalog reads and leave
checkout writes in the primary region.

See [[projects/atlas-web/overview|Atlas Web Overview]].
