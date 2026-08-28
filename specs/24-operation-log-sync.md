# 24 — Operation-Log Sync

## Overview

Mink's per-project database is today both the hot-path read store for hooks *and* the artifact that travels between machines. That dual role is the root cause of a recurring class of cross-device bugs. The database is a single opaque binary file, so any concurrent activity on two devices — even writes to completely unrelated stores — collides as a whole-file conflict that a custom merge driver must resolve mid-sync, with a "keep the local side" fallback that silently discards the other device's data when anything goes wrong. Moving the file safely requires careful write-ahead-log choreography before every sync operation, and a single slip ships a torn or corrupted database to every other device. Worse, the database contains content that should never sync at all (a local reversible-compression cache) and derived structures whose on-disk bytes are non-deterministic (the full-text search index), so two devices with identical logical state still produce endlessly differing binary files.

The data model itself is not the problem. Every synced row already carries the identifier of the device that wrote it, and every store already has deterministic, order-independent merge rules: newest-modification-wins for the file index, oldest-created plus latest-seen plus maximum-count for bug memory, append-only device-isolated rows for the token ledger, per-device rows for counters. The state is convergent by construction; only the packaging fights the sync layer.

This spec changes what syncs. Each device appends its own state changes to an append-only **operation log** that only that device ever writes. The set of per-device logs (plus periodic per-device snapshots) becomes the synced source of truth. The per-project database becomes a purely local **materialized view**, rebuilt and incrementally updated by ingesting other devices' logs — using the same merge rules that exist today, applied at ingest time on the local machine instead of inside a sync-time merge driver. Because every synced file has exactly one writer, concurrent-edit conflicts on synced state become impossible by construction, on any transport that preserves per-file integrity. The database file itself never travels again, which removes the torn-write and corruption-propagation hazards entirely and deletes the binary merge driver — the single largest source of sync bugs.

A preliminary phase, valuable on its own, extracts the local-only stores (the compression cache and other machine-private data) out of the synced database so cache churn stops manufacturing phantom conflicts regardless of when the rest of this spec lands.

## Capabilities

### Local-Only Materialized View

The per-project database must become local, derived state:

- The database file, together with its write-ahead sidecars, must be excluded from sync and never transferred between devices.
- The database must be fully reconstructible from the synced snapshots and operation logs. Deleting it locally and re-deriving it must yield the same logical content (same rows in every synced store), byte-differences in derived structures notwithstanding.
- Derived structures (search indexes, aggregation caches) must be built locally and never synced.
- Hook-facing read latency must not regress: reads continue to hit the local database, never the logs.

### Per-Device Operation Log

Each device maintains, per project, an append-only log of the state changes it originates:

- A log file is written by exactly one device — the device whose identifier names it. No device ever writes to another device's log.
- Every entry records at minimum: a monotonically increasing per-device sequence number, the store it targets, the operation kind (upsert or delete), the row key, the row payload for upserts, the originating device identifier, and a timestamp.
- Entries are appended atomically, one complete entry per line, so a reader can always recover every fully written entry even if the final line is torn by an interrupted write.
- Deletions are recorded as explicit tombstone entries, so a row removed on one device is removed everywhere rather than resurrected by a union merge.
- Log writes must happen in the same code paths that write the local database today (the repositories), so the log and the view can never drift apart silently.
- Stores that are machine-private (see Local-Only Stores) never produce log entries.

### Snapshot and Compaction

Unbounded logs must not grow forever:

- Each device periodically writes a **snapshot** of its own contribution to project state — the full current result of its own operations — alongside its log, then truncates its own log to empty.
- A device only ever compacts its own snapshot and log, never another device's, so compaction requires no cross-device coordination.
- A snapshot plus the log entries appended after it must reproduce exactly the same state as the uncompacted log would have.
- Compaction runs at a natural quiet point (session end or scheduled maintenance), never concurrently with the device's own active writes.
- The compaction threshold (log size or entry count) must be configurable through the standard configuration surface.

### Ingest

Each device folds other devices' changes into its local view:

- At session start (and on demand), the device scans all sibling device directories for snapshots and log entries it has not yet applied.
- Per source device, a locally stored **cursor** records the last applied snapshot generation and log sequence number. Cursors are machine-private and never synced.
- Applying entries uses the per-store merge rules that exist today: newest-modification-wins keyed by path for the file index; oldest-created, latest-seen, maximum-occurrence for bug memory; insert-if-absent for device-isolated ledger rows; per-device rows for counters and lifetime aggregates.
- Ingest must be **idempotent**: applying the same snapshot or the same log entries twice produces the same state as applying them once.
- Ingest must be **order-independent across devices**: applying device A's entries before device B's yields the same final state as the reverse order. (Within a single device's log, entries apply in sequence order.)
- When a source device's snapshot generation advances past the cursor (the source compacted), the ingesting device applies the new snapshot and resets that cursor's sequence position, without re-applying operations already reflected in prior state.
- A malformed or unparseable entry is skipped with a logged warning; ingest continues. Ingest must never block a session from starting.

### Local-Only Stores

State that is meaningful only on the machine that produced it must live outside the synced state entirely:

- The reversible-compression cache moves to a separate machine-private database that is never synced and produces no log entries.
- Per-session read/write detail rows, which exist only to support local diagnostics, may likewise be designated machine-private.
- The set of synced stores versus machine-private stores must be explicitly declared in one place, so a future store cannot silently default into the wrong category.
- This extraction is independently shippable before the rest of this spec and must be delivered first.

### Migration

The transition is a sync-layout version bump, following the same mechanism as prior layout changes:

- On first session start after upgrade, each device exports its own current contribution to project state into its own snapshot, initializes an empty log, and marks the database file as excluded from sync.
- The binary database merge driver is removed from the sync configuration once the layout version advances.
- A device still on the previous layout version continues to function against the old layout until it upgrades; the migration coordination rules from prior version bumps (first-mover writes the version marker, others follow on next start) apply unchanged.
- The pre-migration synced database files remain in sync history for recovery but are no longer read or written by upgraded devices.

### Transport Independence

Correctness must not depend on the transport's merge capabilities:

- The synced layout must remain correct under any transport that syncs whole files without content merging — the current version-controlled remote flow, or a continuous file synchronizer, or a plain copied directory.
- No synced file may require multi-writer semantics, three-way merging, or transport-provided conflict resolution to stay correct.
- The existing transport-level merge drivers for the remaining shared text files (learning memory, wiki daily notes, device registry) are unaffected by this spec and continue to operate.

## Acceptance Criteria

### Single-Writer Logs

- **Given** two devices working in the same project concurrently, **when** both devices sync, **then** no synced state file has been written by more than one device and no conflict resolution is required for database-backed stores.
- **Given** a device appends an operation, **when** the append is interrupted partway (crash, power loss), **then** a subsequent reader recovers every prior complete entry and ignores the torn final line, and the writing device repairs the tail on its next append.

### View Reconstruction

- **Given** a project with synced snapshots and logs from several devices, **when** the local database is deleted and re-derived, **then** every synced store contains the same logical rows as before deletion.
- **Given** a database and logs that have drifted (the database was restored from an old backup), **when** ingest runs, **then** the view converges back to the state implied by the snapshots and logs.

### Ingest Semantics

- **Given** device A recorded an upsert and device B recorded a later upsert to the same file-index path, **when** any device ingests both, **then** the row reflects the newer modification, regardless of ingest order.
- **Given** a bug-memory row updated on two devices, **when** both logs are ingested anywhere, **then** the row carries the oldest creation time, the newest last-seen time, and the maximum occurrence count.
- **Given** device A deleted a row and device B did not touch it, **when** both logs are ingested, **then** the row is absent — the tombstone wins over mere absence of writes.
- **Given** the same log entries are ingested twice, **when** the second ingest completes, **then** the state is identical to after the first ingest.
- **Given** a log entry referencing an unknown store or an unparseable payload, **when** ingest encounters it, **then** the entry is skipped, a warning is recorded, and the remaining entries still apply.

### Compaction

- **Given** a device's log exceeds the configured threshold, **when** compaction runs at session end, **then** the device's snapshot reflects its full contribution, its log is empty, and its snapshot generation has advanced.
- **Given** a sibling device compacted, **when** another device next ingests, **then** it detects the new snapshot generation, applies it, resets its cursor, and does not duplicate previously applied state.
- **Given** two devices at arbitrary points in their own compaction cycles, **when** they sync, **then** no coordination is required and neither device's files are touched by the other.

### Local-Only Stores

- **Given** the compression cache receives heavy writes, **when** the project syncs, **then** no synced file has changed as a result of cache activity.
- **Given** a retrieval token minted before the extraction, **when** the user retrieves it after the extraction, **then** the original content is returned byte-exact (the cache migrates locally, not through sync).

### Migration

- **Given** a device upgrading to the new layout version, **when** its first session starts, **then** its own state is exported to its snapshot, the database file no longer syncs, and the binary merge driver is no longer registered.
- **Given** one upgraded device and one not-yet-upgraded device, **when** the older device syncs, **then** it continues to function without data loss until it upgrades, at which point it migrates the same way.

### Latency

- **Given** the new layout, **when** a read-path hook queries project state, **then** it reads only the local database and its latency budget is unchanged from the previous layout.

## Edge Cases

- **Device identifier collision** — Two machines that somehow share a device identifier would both write one log. The device registry already tracks identifiers; on detecting a foreign heartbeat under its own identifier, a device must regenerate its identifier and start a fresh log rather than corrupt the shared one.
- **Clock skew** — Merge rules that compare timestamps (file index, bug memory) tolerate skew the same way they do today: the comparison is on the recorded row timestamps, and per-device sequence numbers — not wall clocks — order entries within a log. Cross-device ordering never depends on clock agreement.
- **Retired device** — A device that never returns leaves a final snapshot and log that continue to ingest cleanly. A future pruning affordance may archive a device's directory after prolonged absence; ingest of an archived device's last state must remain possible.
- **Transport lag mid-compaction** — A transport may deliver a truncated-log write before the new snapshot (or vice versa). Ingest must treat "snapshot generation advanced but log looks stale" and "log truncated but snapshot not yet seen" as transient, applying what is consistent and retrying the remainder on the next ingest rather than erroring or double-applying.
- **Very large first snapshot** — A project with tens of thousands of indexed files produces a large snapshot. Snapshot format must be line-oriented like the log so partial transfer is detectable and ingest can stream rather than load the whole file into memory.
- **Legacy state files** — Projects that still carry pre-database state files (the old per-store text formats) continue to migrate through the existing paths first; this spec's migration operates on the database-backed layout only.
- **Sync disabled** — A device with sync turned off still writes its log and snapshot locally (cheap, bounded by compaction). Enabling sync later ships history without a special export step.

## Test Requirements

- Unit tests for log append/recover: atomic entry framing, torn-tail recovery, sequence monotonicity, tombstone round-trip.
- Unit tests for every per-store ingest rule, including both ingest orders for each concurrent-write scenario (order-independence proof by test).
- Idempotency tests: double-apply of snapshots and logs across every store.
- Compaction tests: snapshot-plus-tail equivalence with the uncompacted log; cursor reset on generation advance; no cross-device file writes.
- Migration tests: v3→v4 export on first session start, mixed-version coexistence, merge-driver deregistration, database exclusion from sync.
- Local-only extraction tests: cache activity produces no synced changes; pre-existing retrieval tokens survive the move.
- Reconstruction test: delete the database, re-derive from synced state, assert logical equality per store.
- A multi-device simulation test (two simulated device directories, interleaved sessions, randomized sync order) asserting convergence: after full mutual ingest, both databases contain identical logical state.
- Latency guard: read-path benchmarks against the local view remain within the existing hook budget.
