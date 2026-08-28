# Delivery Plan — Operation-Log Sync (Spec 24)

**Status:** Transient. Delete this file once spec 24 is fully delivered and `mink.db` no longer
travels through sync on upgraded devices.

**Branch convention:** cut feature branches per phase; target PRs at the agreed integration branch,
**never at `main`**. Each phase below is independently mergeable and independently shippable.

## Background

The recurring cross-device `mink.db` bugs all trace to one design decision: the per-project SQLite
database is both the hook-latency read store *and* the synced artifact. Git sees it as an opaque
blob, so any two-device activity conflicts at the whole-file level and lands in
`src/core/sync-merge-drivers.ts:attachAndReplay` — a mid-rebase two-DB reconciliation whose failure
mode is "keep ours" (silent data loss). Safe transfer requires the WAL choreography in
`src/core/sync.ts` (`checkpointAndCloseAll` before every git op), and a slip ships corruption to
every device. Two aggravators: `compression_cache` is documented in `src/storage/schema.ts` as
local-only but lives inside the synced DB, and the FTS5 index's on-disk bytes are non-deterministic,
so identical logical state still diffs.

The fix (spec 24): sync per-device append-only operation logs + snapshots under the existing
`projects/<id>/state/<deviceId>/` sharding; make `mink.db` a local materialized view rebuilt by
ingesting sibling logs with the merge rules that already exist in `attachAndReplay`. Single writer
per synced file ⇒ conflicts impossible by construction, on git or any future transport (e.g. the
Syncthing option stays open with zero extra merge work).

| Phase | Theme | Risk | Why this order |
|------|-------|------|----------------|
| 0 | Extract local-only stores | Low | Immediate conflict-pressure relief; no layout version bump |
| 1 | Oplog write path (dual-write) | Low–Med | Logs accumulate alongside today's sync; nothing reads them yet |
| 2 | Ingest + migration v4 | Med | The cutover: DB stops syncing, binary merge driver deleted |
| 3 | Compaction + hardening | Low | Bounds growth; simulation coverage; cleanup |

## Guardrails (apply to every phase)

- **Never block a hook or session start.** Every log/ingest failure path degrades to a logged
  warning (`~/.mink/sync-warnings.log` pattern), never a thrown error in a hook.
- **Single writer, always.** No code path may write into another device's `state/<deviceId>/`
  directory. Compaction touches only the local device's files.
- **Idempotent + order-independent ingest.** Every per-store rule must pass a both-orders and a
  double-apply test before the phase ships.
- **Read latency unchanged.** Hooks keep reading the local `mink.db`; benchmarks guard the budget.
- **Mixed-version safety.** Until phase 2's version bump, everything must coexist with v3 devices
  syncing the DB as they do today.

---

## Phase 0 — Extract local-only stores (quick win)

Goal: stop machine-private churn from dirtying the synced blob. Ships alone, before any oplog work.

- **`mink-local.db`** — new sibling database in `projects/<id>/`, opened via the existing driver
  layer (`src/storage/db.ts`, `driver.bun.ts`/`driver.node.ts`), gitignored in
  `src/core/sync.ts:GITIGNORE_CONTENTS`.
- **Move `compression_cache`** — `src/repositories/compression-cache-repo.ts` points at the local
  DB; one-time lift-and-shift of live rows on first open (tokens minted pre-move must keep
  resolving — spec 24 acceptance).
- **Declare store categories** — single source of truth (e.g. `src/storage/stores.ts`) listing each
  table as `synced` | `local`, consumed by schema application and later by the oplog writer, so a
  future table must pick a side explicitly.
- **Evaluate `ledger_reads`/`ledger_writes`** — session-detail rows are device-isolated and
  diagnostic; decide (and record in the store category list) whether they move local now or stay
  synced until phase 2.

**Exit:** heavy compression/cache activity produces zero synced changes; all existing tests green;
no sync-version bump needed.

## Phase 1 — Oplog write path (dual-write)

Goal: every synced-store mutation also appends an operation entry; nothing consumes the logs yet.

- **Entry format + framing** — `src/core/oplog.ts`: one JSON entry per line
  (`seq`, `store`, `op: upsert|delete`, `key`, `payload`, `deviceId`, `ts`); atomic append;
  torn-tail detection and repair-on-next-append; monotonic per-device `seq` persisted locally.
- **Repository integration** — repos in `src/repositories/` (file-index, token-ledger, bug-memory,
  counters) emit entries for synced stores in the same call that writes the DB, keyed off the
  phase-0 store category list. Tombstones for every delete path (file-index prune is the main one).
- **Snapshot writer** — session-stop hook writes the device's full own-contribution snapshot
  (line-oriented, same entry format with `op: upsert`) into `state/<deviceId>/`; wire into the
  existing session-stop flow next to `checkpointAndCloseAll`.
- **Sync plumbing** — `state/<deviceId>/` oplog + snapshot files ride the existing git sync as
  ordinary single-writer files (no `.gitattributes` entry needed — they can never conflict).

**Exit:** logs and snapshots accumulate and sync; v3 devices are unaffected (they ignore the new
files); a `mink sync doctor`-style check can verify log/DB agreement on any device.

## Phase 2 — Ingest + migration to sync v4 (the cutover)

Goal: `mink.db` becomes derived, local-only state; the binary merge driver dies.

- **Ingest engine** — `src/core/oplog-ingest.ts`: scan sibling `state/*/` dirs, apply
  snapshot-then-tail per source device using the per-store rules ported out of
  `attachAndReplay` into shared functions; per-source cursors (generation + seq) stored locally
  (NOT synced — alongside `device-id` in the gitignored set). Runs at session-start after
  `syncPull`, and on demand via `mink sync ingest`.
- **Migration v3→v4** — bump `MINK_SYNC_VERSION` to 4 in `src/core/sync.ts`; on first session-start
  per device: export own contribution to snapshot, init empty log, add `projects/*/mink.db` to
  `GITIGNORE_CONTENTS`, `git rm --cached` the DB files, drop `mink-db-merge` from
  `.gitattributes`/`MERGE_DRIVERS`. Reuse the existing first-mover coordination
  (`.sync-migrate.lock` pattern from prior bumps).
- **Rebuild command** — `mink sync rebuild`: delete + re-derive the local DB from synced state
  (spec 24's reconstruction acceptance); doubles as the corruption-recovery story, replacing
  "restore from a healthy device" advice in `syncPush`.
- **FTS locality** — with the DB local-only, FTS determinism stops mattering; confirm triggers
  rebuild correctly during ingest and drop any FTS-related sync workarounds.
- **Mixed-version window** — v3 devices keep syncing the DB until they upgrade; v4 devices no
  longer read it. Document the window; the version marker mechanism already forces v3 devices to
  migrate on next start after the marker advances.

**Exit:** on v4 devices, no binary DB in sync; `attachAndReplay` and the `mink-db-merge` driver are
deleted; two-device concurrent sessions produce zero conflicts on database-backed stores.

## Phase 3 — Compaction + hardening

Goal: bound growth, prove convergence, finish the operational story.

- **Compaction** — session-stop (or scheduler task via spec 10): when own log exceeds the
  configured threshold (`sync.oplog-compact-threshold` in `src/core/global-config.ts`, mirrored in
  spec 18), rewrite own snapshot, advance generation, truncate own log. Ingest-side cursor reset on
  generation advance (already specified; verify under transport lag orderings).
- **Multi-device simulation test** — two simulated device trees, interleaved sessions, randomized
  sync/ingest order, asserting logical convergence per store (spec 24 test requirement; extends
  `tests/unit/sync-merge-drivers.test.ts` / `db-merge.test.ts` lineage).
- **Retired-device pruning affordance** — `mink sync devices prune <id>` archiving a long-absent
  device's directory (manual, explicit; ingest of archived state stays possible).
- **Docs + status surfaces** — `mink sync status` shows per-device log/snapshot freshness and
  cursor lag; README/spec index updates; delete this plan.
- **(Unblocked, optional)** — transport alternatives (spec 24 §Transport Independence): with
  single-writer files, a Syncthing-style continuous transport becomes a pure transport swap;
  spec it separately if pursued.

**Exit:** logs bounded, convergence proven under randomized interleaving, recovery/rebuild/prune
commands documented — and the recurring cross-device `mink.db` conflict class is structurally gone.
