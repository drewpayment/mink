---
created: "2026-01-08T09:00:00.000Z"
updated: "2026-02-14T09:00:00.000Z"
tags: [standards, code-review]
category: areas
---

# Code Review Standards

- Keep PRs under ~400 changed lines where practical; split otherwise.
- Every PR needs at least one approval from someone outside the author's
  immediate pod.
- Prefer small, reversible changes over big-bang rewrites.
- Style nits belong in the linter config, not in review comments.

See also [[resources/writing-style-guide|Writing Style Guide]] for docs and
commit-message conventions.
