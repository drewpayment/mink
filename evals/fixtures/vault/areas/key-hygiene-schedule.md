---
created: "2026-03-03T09:00:00.000Z"
updated: "2026-06-20T09:00:00.000Z"
tags: [security, schedule]
category: areas
---

# Key Hygiene Schedule

Service API keys are re-issued every 90 days. The outgoing key stays valid
for a 48-hour overlap so consumers can switch without downtime, then it is
revoked. The calendar reminder lands on the first Monday of the quarter.

Human passwords are handled by the identity provider, not this schedule.

Related: [[areas/sec-checklist|Security Checklist]].
