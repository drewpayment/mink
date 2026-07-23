---
created: "2026-05-30T12:00:00.000Z"
updated: "2026-05-30T12:00:00.000Z"
tags: [atlas-web, release-notes]
category: projects
source_project: atlas-web
---

# Atlas Web 0.9 Release Notes

Highlights:

- This release migrated the state layer from Redux to Zustand, cutting the
  bundle's state-management code by about a third.
- Checkout now retries failed payment webhooks with backoff instead of
  failing the order immediately.
- Minor accessibility fixes to the cart drawer.

See [[projects/atlas-web/overview|Atlas Web Overview]].
