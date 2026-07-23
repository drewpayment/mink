---
created: "2026-01-10T09:00:00.000Z"
updated: "2026-04-18T09:00:00.000Z"
tags: [security, standards]
category: areas
aliases: [Security Checklist, Sec Checklist]
---

# Security Checklist

Checklist to run through before merging a PR that touches auth, payments,
or PII:

- [ ] No secrets or tokens committed, even in test fixtures.
- [ ] New endpoints have authz checks, not just authn.
- [ ] Inputs are validated server-side, not just in the client.
- [ ] Logging doesn't capture raw PII.
- [ ] Dependency changes were scanned for known CVEs.

Referenced by [[projects/orion-api/auth-flow|Orion API Auth Flow]].
