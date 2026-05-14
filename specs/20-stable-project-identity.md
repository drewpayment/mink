# 20 — Stable Project Identity

## Overview

Mink keeps a separate slice of state for each project the user works in — session history, file index, token ledger, learning memory, bug memory, action log, daily notes. Today, the identity that keys that state is derived from the project directory's absolute path on disk. That works for a single machine, but it falls apart the moment the same repository is checked out at a different path on a second machine: the two checkouts look like two unrelated projects, the dashboard shows duplicate entries, and none of the per-project history follows the user from one machine to the other.

This spec replaces the path-derived identity with a stable identity that emerges from artifacts the repository already carries with it. When the project is a git checkout with a configured remote, the identity is derived from the normalized remote URL combined with the subpath inside the repository. When the user wants to pin a specific identity by hand, an override file inside the repository takes precedence. When no usable signal exists — a brand-new directory with no remote, a non-versioned folder — the resolver falls back to the existing path-derived identity so non-git workflows are not disturbed. The change is rolled out behind a configuration flag, and the on-disk migration from the old identity layout to the new one runs through the same sync-version mechanism Mink already uses for prior storage-shape changes.

## Capabilities

### Identity Resolver

Project identity must be resolved through a deterministic priority order:

1. **Explicit override** — If the project directory contains an override file declaring a chosen identifier and that identifier passes validation, use it verbatim and stop.
2. **Git-derived identity** — If the working directory lies inside a git repository with a configured remote, derive the identity from the normalized remote URL combined with the subpath from the repository root.
3. **Path-derived fallback** — Otherwise, fall back to a hash of the canonical absolute path. This preserves today's behavior for non-git directories or git directories that have not yet configured a remote.

The resolver must never error out. Each tier falls through cleanly to the next if its precondition is not met or its input is malformed.

### Override File

A small file inside the project's repository allows the user to pin a chosen identifier so that two checkouts of forked repos, or a renamed repo whose new remote should still resolve to the old identity, can be unified by hand.

The override file's purpose is to declare an identifier and nothing else. It is not a general project configuration file.

Validation rules:

- The declared identifier must be non-empty.
- The identifier must consist only of characters that are safe as a directory name on all supported filesystems.
- The identifier must not exceed a documented length cap.
- A malformed override (invalid file format, missing identifier field, identifier outside the allowed character set or length) is rejected with a clear error and the resolver falls through to the next tier.

The override file is intended to be committed to the repository so that both machines share the same pin without further coordination.

### Git-Derived Identity

When the resolver derives identity from git, it must produce the same identifier on every machine that has cloned the same logical repository, regardless of which protocol or which absolute path that machine used.

Two ingredients combine to form the identity:

- **Normalized remote URL** — The configured remote URL, reduced to a canonical string. The normalization rules must collapse all of the following forms for the same logical repo to a single canonical string:
  - Secure-shell style and HTTPS style of the same remote.
  - Remotes with or without embedded credentials.
  - Remotes with or without a trailing slash.
  - Remotes with or without a `.git` suffix.
  - Remotes whose host and owner segments differ only in letter casing.
- **Repository-root-relative subpath** — The path from the repository root down to the working directory at the moment of resolution. Determined by asking git, not by guessing from the absolute path. The repository root produces an empty subpath; a one-level-deep subdirectory produces a one-segment subpath. The subpath is normalized to forward-slash form with no trailing slash before it participates in the identity.

The two ingredients are combined into a short identifier that contains a human-readable slug followed by a short stable hash. The slug is derived from the deepest meaningful name segment so the identifier remains scannable in a directory listing. The hash ensures the identifier is collision-resistant across the entire space of possible (remote, subpath) pairs.

Identifier format must be safe as a directory name on macOS, Linux, and Windows. Total length must be bounded.

### Monorepo Disambiguation

The subpath ingredient is critical for monorepos. Two sibling services under one shared remote must resolve to two distinct identifiers, because they are two distinct projects to Mink — they have their own conventions, their own session history, their own notes. Two checkouts of the *same* service inside the monorepo at different absolute paths on different machines still unify, because both produce the same subpath.

### Path-Derived Fallback

When no override exists and the directory either is not inside a git repository or is inside one with no configured remote, the resolver falls back to the legacy behavior: a slug derived from the directory's leaf name combined with a short hash of the canonical absolute path.

The path-derived tier exists so that:

- Non-git workflows continue to function exactly as before.
- A brand-new project that has not yet configured a remote is not blocked from using Mink while the user sets things up.
- The transition from path-derived to git-derived for any one project can happen lazily — the moment a remote is configured, the next resolution picks it up.

When the resolver lands on the path-derived tier inside a git repo that is missing a remote, it must emit a one-time warning explaining that the project will not unify across machines until a remote is configured or the override file is added. The warning must not repeat on every command.

### Per-Device Path Map

Today the project record stores a single working-copy path field — the path on the machine that initialized the project. After the change, that singular field becomes a device-keyed map: each machine that touches the project records its own local working-copy path under its own device identifier. No device's entry overwrites another's.

The map is consumed when the dashboard or other surface needs to know where on the local disk to find the project's files. The map is also a useful diagnostic for the user, showing at a glance which machines have ever touched the project.

When older records are read for the first time after the change, the singular path field must be upgraded in memory to a single-entry map keyed by the device that owned it. Subsequent writes persist the map.

### Alias List

Every project record carries a list of prior identifiers it was previously known by. The list grows in two situations:

- The migration that moves a project from the old path-derived identifier to the new git-derived identifier records the prior identifier as an alias.
- A subsequent identity change — for example, the remote URL is rewritten because the repository is renamed or transferred between owners — also records the prior identifier as an alias.

Aliases are honored by every part of Mink that resolves an identifier to a project: dashboard routing, note source-project references, wiki link resolution, and command-line lookups. A historical reference using an old identifier must still resolve to the same project after the rename.

Aliases are never garbage-collected. Their storage cost is negligible and the user-facing benefit — links and bookmarks that survive across years of remote-URL churn — is large.

### Cross-Device Convergence

Two machines that flip the identity flag on and run their first session-start independently must converge. Both derive the same target identifier from the same git remote, so both pick the same directory name for the project's state. When their state next synchronizes, the sync layer's existing merge handling unions the per-device path map and the alias list without conflict.

If one machine has already migrated and pushed its state while a second machine still holds the old directory, the next sync pass must reconcile by folding the old directory's contents into the new one — never the other way around, never silently dropping files.

### Migration

The migration from the old identity layout to the new one is triggered eagerly on the next session-start hook after the identity flag is set to its new value. The migration reuses the same pattern Mink already uses for sync-layout changes: a single version marker, a coordination lock so two processes do not migrate concurrently, an idempotent pass that can be re-run if interrupted, and a resumable design that picks up where it left off if killed mid-flight.

For each existing project directory whose identity changes:

- Compute the new identifier from the working-copy path recorded on the project.
- Rename the project directory from the old identifier to the new one, preferring a history-preserving rename where the directory is tracked by version control.
- Record the old identifier on the project's alias list.
- Lift the singular working-copy path field into the device-keyed map, keyed by the device that owned the record.

Projects whose identity does not change (for example, projects with no git remote) are left alone.

If the migration is interrupted between the directory rename and the metadata write, the resolver can still recompute the same target identifier from the working-copy path, so the next run completes the metadata update without redoing the rename. If the migration is interrupted in the middle of processing the project list, the next run picks up the unprocessed projects.

### Configuration

A single new configuration key controls the rollout:

- **`projects.identity`** — Values: `path-derived` (default during rollout) or `git-remote`. When set to `path-derived`, the legacy behavior runs unchanged: the resolver returns the path-derived identifier, the override file is not consulted, and no migration runs. When set to `git-remote`, the full resolver chain is active and the migration runs on the next session-start.

Setting the key follows the same precedence rules as every other Mink configuration value: environment variable beats local file beats shared file beats default.

The default value is `path-derived` during the initial release so that existing users see no change until they opt in. A future release may flip the default to `git-remote` once the opt-in version has proven out in the field.

### Init Behavior

When the user initializes Mink in a repository, the identifier printed by the init command must reflect the resolver's output for that directory:

- If the override file is present, the printed identifier is the overridden value.
- If the directory is inside a git repository with a remote, the printed identifier is the git-derived value.
- If the directory is inside a git repository with no remote yet, the printed identifier is the path-derived fallback, and the output includes a short note explaining how to stabilize the identity by configuring a remote or adding an override file.
- If the directory is not a git repository at all, the printed identifier is the path-derived value with no note.

When a remote is added to a previously remote-less repository, the next session-start must detect the change, offer to migrate that single project's directory to the new git-derived identifier, and record the previous path-derived identifier as an alias.

### Dashboard Compatibility

The dashboard surfaces project state by identifier — in URLs, in routing, in cached project lookups. After the migration:

- Routing must resolve both the new primary identifier and every aliased prior identifier to the same project.
- Bookmarks and links that reference an old identifier must continue to work.
- Any in-memory or worker-process cache that the dashboard keeps of project identifiers must invalidate on identifier change so it never serves a stale directory pointer.

### Forward and Backward Compatibility

A user who upgrades to the new version, migrates, and then downgrades to the previous version must not lose data. The old version must:

- Continue to read state out of the renamed directories without crashing.
- Preserve the alias list and per-device path map fields on write rather than dropping them silently.

A user whose two machines run different Mink versions during the rollout window must not see data corruption. The newer version writes the new fields; the older version ignores them; the existing sync merge drivers tolerate the schema difference.

## Acceptance Criteria

```
GIVEN the user's repo contains a project override file declaring a chosen identifier
WHEN Mink resolves the project identity at session start
THEN the chosen identifier is used verbatim
AND the git remote and path-derived strategies are skipped

GIVEN the override file declares an identifier that contains characters outside the allowed alphabet
WHEN Mink reads the override
THEN the override is rejected with a clear validation error
AND the resolver falls through to the next strategy
AND the user is told what shape the identifier must take

GIVEN the working directory is inside a git repo with a single configured remote and the override file is absent
WHEN Mink resolves the project identity
THEN the identity is derived from the normalized remote URL combined with the subpath from the repo root
AND the same identity is produced no matter which absolute path the repo is checked out at

GIVEN the working directory is inside a git repo with no configured remote and no override file
WHEN Mink resolves the project identity
THEN the resolver falls back to the absolute-path hash
AND a one-time warning explains that the project will not unify across machines until a remote is configured or an override is added

GIVEN the working directory is not inside a git repo at all
WHEN Mink resolves the project identity
THEN the resolver falls back to the absolute-path hash
AND no warning is emitted because git-derived identity was never expected

GIVEN the same repo is reachable through an SSH-style remote on one machine and an HTTPS-style remote on another
WHEN Mink resolves the project identity on each machine
THEN both machines compute the same identifier
AND credentials, trailing slashes, dot-git suffixes, and host casing do not affect the result

GIVEN the same repo's remote uses uppercase or mixed-case host and owner segments
WHEN Mink normalizes the remote URL
THEN host and owner segments are lowercased before hashing
AND the repository segment retains its original case if the hosting provider treats repo names as case-sensitive, but the normalization rule is documented and consistent

GIVEN a monorepo contains two sibling services in different subdirectories
WHEN Mink resolves the identity from inside each subdirectory
THEN the two services receive distinct identifiers
AND project state, learning memory, and notes for each service stay isolated

GIVEN the user runs Mink from the root of a repo rather than a subdirectory
WHEN Mink resolves the identity
THEN the subpath component is empty
AND the resulting identifier is stable for that repo's root regardless of where the working copy lives on disk

GIVEN the identity feature flag is set to the legacy path-derived mode
WHEN any Mink command runs
THEN the absolute-path hash is used as before
AND no migration occurs
AND no override or remote is consulted

GIVEN the identity feature flag is flipped to the git-remote mode for the first time
WHEN the next session-start hook fires
THEN a migration pass runs once
AND every existing project directory is examined, its new identity computed, and its directory renamed when the identity changes
AND the previous identifier is recorded as an alias on the project so historical references still resolve

GIVEN a migration pass renames a project directory
WHEN any later lookup uses the old identifier
THEN the lookup transparently resolves to the renamed directory via the alias list
AND no data is lost from the rename

GIVEN two machines independently flip the identity flag on and run migration
WHEN their state later synchronizes
THEN both machines converge on the same directory name for the shared repo
AND each machine's local working-copy path is preserved on the project record under a per-device map
AND neither machine's working-copy path overwrites the other

GIVEN the migration runs on a project whose record previously stored a single working-copy path
WHEN the migration finishes
THEN the singular path is replaced with a per-device map keyed by the device that owned it
AND subsequent commands on either device update only their own entry in the map

GIVEN a user opens the dashboard immediately after a migration
WHEN the dashboard lists projects, surfaces notes for a project, or routes by project identifier
THEN every project is reachable under its new identifier
AND every historical link or bookmark using the old identifier still resolves

GIVEN a wiki note recorded a source project using the old identifier before migration
WHEN the note is viewed after migration
THEN the note still resolves to the same project page
AND backlinks from the project page back to the note are intact

GIVEN the git remote URL for a repo is changed after migration
WHEN Mink next resolves the identity
THEN a new identifier is computed
AND on first detection the previous identifier is added to the alias list automatically so prior state remains reachable
AND the user is informed that the remote changed and given a one-line command to confirm or override

GIVEN the user adds an override file pointing a moved repo back to its original identifier
WHEN Mink resolves the identity
THEN the override wins
AND the project resumes writing to the original directory without any further migration

GIVEN two devices simultaneously sync after migration and one device still has the old directory while the other has the new directory
WHEN the sync merge runs
THEN both directories are reconciled into the new one
AND no file from the old directory is silently dropped
AND the alias list and per-device path map are merged without conflict

GIVEN the override file on one device says one identifier and the override file on another device says a different identifier
WHEN the two devices sync
THEN the conflict is surfaced to the user with a clear explanation of both choices
AND Mink does not silently pick a winner

GIVEN a migration pass is interrupted before it finishes
WHEN the next session-start runs
THEN migration resumes from where it left off
AND no project is migrated twice
AND no project is left half-renamed

GIVEN migration is already in progress in one process
WHEN a second Mink process tries to run migration concurrently
THEN the second process detects the in-flight migration and waits or skips cleanly
AND no directory is corrupted by overlapping renames

GIVEN a user downgrades to an older Mink version after migration has run
WHEN the older version starts up
THEN it continues to function against the renamed directories
AND it ignores the alias list and per-device path map fields it does not understand rather than rewriting or erasing them

GIVEN the identity flag is on and a project's git remote is genuinely missing
WHEN the user adds a remote later
THEN the next session-start re-resolves the identity
AND offers to migrate that single project's directory to the new git-derived identifier
AND the previous path-derived identifier is recorded as an alias

GIVEN the user runs the init command in a fresh repo with the flag on
WHEN init completes
THEN the printed project identifier reflects the git-derived form
AND if the repo has no remote yet, the printed identifier is the path-derived fallback and a short note explains how to stabilize it
```

## Edge Cases

- Remote URL forms that must normalize to the same canonical string: secure-shell style, HTTPS style, HTTPS with embedded credentials, scheme-prefixed secure-shell style, with or without trailing slash, with mixed host casing.
- Repository rename or ownership transfer at the hosting provider — the remote URL changes but it is still the same project in the user's mind. The resolver computes a new identifier; the prior identifier is auto-aliased on first detection so existing state is not orphaned.
- Fork-of-fork situations where two different users push to two different remotes for what they consider the same project — identifiers diverge intentionally; the override file is the documented escape hatch for users who want to unify them.
- Multiple configured remotes. The resolver picks the canonical primary remote if present, otherwise the first remote alphabetically; the choice is documented and the override remains available.
- Submodules: a directory inside a submodule resolves against the submodule's remote and its in-submodule subpath, not the outer repo's, so a vendored sub-repo does not masquerade as part of the parent.
- Detached head, no current branch, shallow clones, and worktrees — none of these affect the resolver because it only reads the remote URL and the path from the repo root.
- Bare repos and mirror clones — typically not where Mink runs, but the resolver must not crash; it falls back to path-derived.
- Working directory is a symlink into the repo — the resolver canonicalizes the path before asking git for the subpath so symlinked checkouts of the same repo unify.
- Working directory is exactly the repo root vs. a one-deep subdirectory whose name matches the repo — these must produce distinct identifiers (empty subpath vs. one-segment subpath).
- Override file is present but malformed — fail loudly, fall through to the next strategy, never silently treat it as absent.
- Override file declares an identifier that collides with an existing different project's directory — refuse to use the override and report the collision; the user has to resolve manually.
- Override file is checked into the repo and two devices each edit it to a different value — surfaces as a normal version-control merge conflict in the user's repo, not in Mink state.
- Pre-existing alias collision: the about-to-be-recorded old identifier is already listed as an alias on a different project — record the collision in the project record and surface it to the user; do not pick a winner.
- Migration interrupted between rename and metadata write — recoverable on next run because the resolver re-derives the identifier and the metadata write is idempotent. A lock file prevents two concurrent migration passes.
- Migration interrupted between metadata write and the synchronization commit — recoverable because the metadata format is forward-compatible and the next sync run will pick it up.
- User downgrades Mink after migration runs — older binary keeps reading the renamed directories; unknown fields on the project record are preserved untouched on write because the older code reads only the fields it knows about.
- Two devices running different Mink versions during the rollout window — the device on the new version writes alias and per-device-path fields, the older device ignores them, sync merge handling tolerates the schema difference.
- Dashboard has the project identifier cached in memory or in a worker process when migration runs — the dashboard must invalidate its routing cache (or pick up the change on next request) so it never serves a stale directory pointer.
- A note's source-project reference points to an identifier that no project currently advertises as primary or alias — degrade gracefully: show the raw identifier, do not crash, and offer a reassign affordance.
- Wiki notes that link to a project page by old identifier — link resolution checks the alias list, not just the primary identifier.
- Repos using non-standard hosting (self-hosted forges, alternative providers, file-protocol remotes) — normalization rules must accept arbitrary hosts; only the canonicalization rules (lowercase host, strip credentials, strip suffix) are universal.
- Repos whose remote URL is a relative path or a local-file URL — treat as no usable remote and fall back to path-derived with a warning.
- Repos where the repo-root-relative subpath has a trailing slash or contains Windows-style separators — normalize to forward slashes with no trailing slash before hashing.
- Per-device path map grows unbounded over years of use across many machines — bound the map by device identifier and rely on the existing device-registry cleanup to prune entries for retired devices.
- The same machine has the same repo checked out twice at two different absolute paths intentionally (additional worktrees) — identifiers collide by design; the per-device path map will see one entry overwrite the other. Document this; recommend the override file as the escape hatch.

## Test Requirements

### Unit Tests

- Resolver priority order: override beats git-derived; git-derived beats path-derived; missing override and missing remote falls through cleanly.
- Override validation: rejects malformed input, rejects identifiers with disallowed characters, rejects identifiers exceeding the documented length, accepts well-formed identifiers verbatim.
- Remote URL normalization across the matrix: secure-shell form, HTTPS form, HTTPS-with-credentials form, scheme-prefixed secure-shell form, with and without a suffix, with and without trailing slash, with mixed host casing — every form for the same logical repo produces the same canonical string.
- Subpath extraction: returns empty for repo root, returns forward-slash-joined segments for any depth, strips trailing slash, normalizes Windows separators.
- Identifier format: human-readable slug prefix derived from the deepest meaningful name segment, plus a short stable hash; total length bounded; safe for use as a directory name on all supported filesystems.
- Alias list manipulation: appending an alias is idempotent (no duplicates), aliases survive a round-trip through the project metadata reader and writer.
- Per-device path map: reading a project record with a singular path field upgrades it in memory to a single-entry map keyed by the current device; writing back persists the map.
- Path lookups via the resolver tolerate a project whose primary identifier no longer matches its directory name because it was renamed — the directory is found via the alias list.

### Integration Tests

- End-to-end resolution from a freshly cloned repo: remote present, no override, resolver returns the expected git-derived identifier; same expectation on a clone of the same repo at a different absolute path on the same machine.
- Monorepo with two sibling service directories: resolving from each subdirectory produces two distinct identifiers; running notes, learning memory writes, and dashboard listings against one does not bleed into the other.
- Migration on session-start: starting with a populated state directory from before the flag flip, flipping the flag on, and triggering the next session — every project directory is renamed when its identity changes, every metadata file gains an alias entry, every singular path field becomes a per-device map.
- Migration idempotency: running the migration twice in a row produces no further changes on the second run; killing the migration process mid-pass and re-running it completes the remaining projects without corrupting the ones that finished.
- Migration concurrency: starting two Mink processes that both attempt migration at the same moment — exactly one performs the work, the other waits or exits cleanly, no directory is touched by both.
- Convergence across two devices: device A migrates, device B migrates independently, both sync — final state has one directory per repo, alias list contains both prior identifiers when they differed, per-device path map contains both devices' working-copy paths.
- Wiki note continuity: a note created before migration with a source-project reference still resolves to the same project page after migration; backlinks from the project page list the note.
- Dashboard continuity: opening the dashboard with a URL or bookmark using the old identifier after migration routes to the new directory transparently.
- Remote rename: a project that started with one remote URL has its remote rewritten between sessions — next session adds the prior identifier as an alias and resolves to a new directory, no data loss, user warning emitted.
- Init in a brand-new repo with no remote configured: identifier printed is the path-derived fallback with a remediation note; adding a remote and re-running init offers to migrate that single project to the git-derived identifier.
- Feature-flag off: every test above also passes in legacy mode without invoking the resolver — no migrations run, no overrides are read, behavior matches today's path-derived implementation byte for byte.
- Forward and backward compatibility: a metadata file written by the new version is readable by the previous version without crashing; saving from the previous version preserves the alias list and per-device path map fields rather than dropping them.
- Sync merge: simulated three-way merge where one device pushed the new directory and the other still holds the old directory — the post-merge tree contains only the new directory and all files from both sides are present.

### Property Tests

- For any pair of remote URL forms that point at the same logical repository (drawn from the canonicalization rules in the spec), the resolver returns the same identifier.
- For any subpath inside any repo, the resolver returns the same identifier as long as the remote and subpath are unchanged, regardless of the absolute path prefix.
- For any project record, applying the migration twice produces the same on-disk state as applying it once.
- For any sequence of alias appends, the alias list never contains duplicates and never loses an entry that was once added.
- For any sequence of writes to the per-device path map from different device identifiers, no device ever overwrites another device's entry.
- For any identifier produced by the resolver, the identifier is a valid directory name on macOS, Linux, and Windows filesystems and does not exceed the documented length cap.
