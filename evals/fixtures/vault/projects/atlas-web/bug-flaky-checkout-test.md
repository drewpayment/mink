---
created: "2026-06-10T15:40:00.000Z"
updated: "2026-06-11T08:15:00.000Z"
tags: [atlas-web, bug, testing]
category: projects
source_project: atlas-web
---

# Flaky Checkout Test

`checkout.spec.ts` was failing intermittently in CI (about 1 in 12 runs).

Root cause: a race condition between the payment webhook mock and the
checkout confirmation poll — the poll sometimes fired before the mock
webhook had been delivered, so the UI was still showing a pending state
when the assertion ran.

Fix: the test now awaits a stable network-idle state before asserting on
the confirmation screen.

See [[projects/atlas-web/overview|Atlas Web Overview]].
