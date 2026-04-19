# Delivery Plan — Panel Wiring (PR #39 Follow-ups)

**Status:** Transient. Delete this file once all six PRs below are merged and `dashboard/lib/mock-dashboard-data.ts` no longer exists.

**Branch convention:** one feature branch per PR, each cut from `main`. Do not stack the branches — the mocks give every panel a working fallback, so each PR can merge independently.

## Background

PR #39 shipped the command-center dashboard with six panels backed by mock data (`dashboard/lib/mock-dashboard-data.ts`):

| Panel | Mock source | Real backend already exists? |
|------|-------------|-------------------------------|
| Wiki Vault | `MOCK_NOTES` | Yes — `src/core/note-index.ts`, `vault.ts`, `note-linker.ts` |
| Capture | `MOCK_NOTES.tags` | Yes — `src/core/note-writer.ts` |
| Sync | `MOCK_SYNC` | Yes — `src/core/sync.ts` |
| Companion Channel (Discord) | `MOCK_DISCORD` | Yes — `src/core/channel-process.ts` |
| Daemon | Uses `usePreferences` override | Yes — `src/core/daemon.ts` |
| Configuration | `MOCK_CONFIG` | Yes — `src/core/global-config.ts` |

Every one of these is a wiring exercise: a loader in `src/core/dashboard-api.ts`, routes in `src/core/dashboard-server.ts`, types, client fetchers, a store slice, and SSE subscription. No new domain logic.

## Shared recipe

Each PR repeats these steps. Deviations are noted per-PR.

1. **Types** — add payload types to `src/types/dashboard.ts`; re-export from `@mink/types/dashboard` if consumed by the dashboard.
2. **Loader** — add `load<Panel>Panel()` to `src/core/dashboard-api.ts` that wraps the existing domain module.
3. **Routes** — register the GET (read) and POST (mutation) routes in `src/core/dashboard-server.ts` between the existing cases. Use the `jsonResponse()` helper. For mutations, return `{ success: boolean, error?: string }` like the existing scheduler actions.
4. **SSE** — add the event's `StateFileId` (or equivalent) and call `sseManager.broadcast()` at the mutation site.
5. **Client fetchers** — add functions to `dashboard/lib/api-client.ts`.
6. **Store slice** — extend `dashboard/hooks/use-dashboard-store.ts` with the new data + refetch function. Subscribe to the new SSE event in `dashboard/hooks/use-sse.ts`.
7. **Panel wiring** — replace the mock import in the panel component with the store selector; enable the `disabled` buttons; remove the amber `preview` chip.
8. **Mock removal** — delete the now-unused export from `dashboard/lib/mock-dashboard-data.ts`. After PR 6, delete the file entirely.
9. **Tests** — add one integration test per endpoint to `dashboard/tests/integration/dashboard.test.ts`; add one unit test per loader beside the module it wraps.

## Project scoping

The existing panels (overview, tokens, file-index, etc.) scope by `?project=<id>`. The six new panels are **global** — they act on `~/.mink/`, not on any project's state directory. Follow the `/api/projects` precedent (`dashboard-server.ts:409–411`): resolve early, skip `resolveProjectCwd()`.

## PR ordering

Smallest → largest. Each PR is independently mergeable and shippable.

### PR 1 — Daemon controls

**Spec:** 12 (Dashboard §Panel 16), 11 (CLI §daemon).

**Backend additions (`src/core/dashboard-server.ts`):**
- `POST /api/daemon/start` → wrap `startDaemon(cwd)` from `src/core/daemon.ts`.
- `POST /api/daemon/stop` → wrap `stopDaemon()`.
- `POST /api/daemon/restart` → compose stop + start.
- Broadcast `daemon-status` SSE event on each transition.

**Frontend changes:**
- `dashboard/lib/api-client.ts` — add `triggerDaemonStart`, `triggerDaemonStop`, `triggerDaemonRestart`.
- `dashboard/components/panels/daemon-panel.tsx` — replace `setDaemonOverride` calls (lines ~37–51) with real action calls. Keep the preferences override as a dev-mode escape hatch only, or delete it outright along with the `daemonOverride` slice of `use-preferences.ts` and the related `TweaksPanel` toggle.
- Remove amber `preview` chip from the daemon panel head.

**Mock removal:** none (daemon panel doesn't use `mock-dashboard-data.ts`).

**Tests:** integration tests asserting that POST → process lifecycle → overview endpoint reflects new state.

### PR 2 — Configuration editor

**Spec:** 18, 12 (§Panel 17).

**Backend additions:**
- `src/types/dashboard.ts` — `ConfigPanelPayload = { entries: Array<{ key, value, source, type, group, isSecret }> }`.
- `src/core/dashboard-api.ts` — `loadConfigPanel()` wrapping `resolveAllConfig()` (already in `src/core/global-config.ts`). Mask secrets before returning.
- `src/core/dashboard-server.ts` — `GET /api/config`, `POST /api/config/set` (body: `{ key, value, scope: "shared" | "local" }`), `POST /api/config/reset` (body: `{ key?, scope, all?: boolean }`). Broadcast `config-changed` SSE event.
- Keep `global-config.ts` behavior — no changes to its public API.

**Frontend changes:**
- `dashboard/lib/api-client.ts` — `fetchConfig`, `setConfigValue`, `resetConfigKey`.
- `dashboard/hooks/use-dashboard-store.ts` — config slice + refetch.
- `dashboard/components/panels/config-panel.tsx` — swap `MOCK_CONFIG` for store selector. Make the `Toggle` and `input` controls writable (debounce by ~500ms). Show the source chip (shared / local / env / default) next to each key.
- Drop `MOCK_CONFIG` export from `mock-dashboard-data.ts`.

### PR 3 — Sync status

**Spec:** 15 §Git Backup, 12 (§Panel 14).

**Backend additions:**
- `src/types/dashboard.ts` — `SyncPanelPayload = { initialized, branch, remote, ahead, behind, lastPush, lastPull, pending: Array<{ op, file, delta }> }`.
- `src/core/dashboard-api.ts` — `loadSyncPanel()` wrapping `getSyncStatus()` + a small `git status --porcelain` wrapper for the `pending` list (reuse any helper already in `sync.ts`).
- `src/core/dashboard-server.ts` — `GET /api/sync`, `POST /api/sync/pull`, `POST /api/sync/push`, `POST /api/sync/disconnect`. Broadcast `sync-status` SSE event on completion.

**Frontend changes:**
- Api client + store slice + panel wiring as per the recipe.
- Add an empty-state branch to `sync-panel.tsx` for when `!initialized` (prompt to run `mink sync init <remote>`).
- Drop `MOCK_SYNC` export.

### PR 4 — Companion channel (Discord)

**Spec:** 17, 12 (§Panel 15).

**Backend additions:**
- `src/types/dashboard.ts` — `ChannelPanelPayload = { status, bot, uptime, messages, tokenMasked, allowlist, logs: Array<{ t, m }> }`.
- `src/core/dashboard-api.ts` — `loadChannelPanel()` wrapping `getChannelStatus()` + `getChannelLogs()` (parsed into structured lines, last N only). Mask the token.
- `src/core/dashboard-server.ts` — `GET /api/channel`, `POST /api/channel/start`, `POST /api/channel/stop`, `POST /api/channel/restart`. Broadcast `channel-status` on start/stop, `channel-logs` on new log lines (requires a small tail watcher around the log file).

**Frontend changes:**
- Api client + store slice + panel wiring as per the recipe.
- Allowlist edits reuse PR 2's `setConfigValue` against `channel.discord.allowlist`.
- Drop `MOCK_DISCORD` export.

### PR 5 — Wiki vault read

**Spec:** 15 §Wiki Dashboard Surface, 12 (§Panel 12).

**Backend additions:**
- `src/types/dashboard.ts` — `WikiPanelPayload = { totalNotes, inboxCount, vaultPath, recent: Array<VaultIndexEntry>, tags: Array<[string, number]>, tree: Array<{ name, path, count, depth }> }` and `WikiNotePayload = { path, frontmatter, body, backlinks: string[] }`.
- `src/core/dashboard-api.ts` — `loadWikiPanel(opts?: { limit?, category? })` using `getRecentNotes`, `getVaultTags`, and a new `buildVaultTree()` walker over `vaultRoot()` bounded to depth 2–3. `loadWikiNote(path)` using `note-linker.ts` for backlinks. Refuse paths that escape the vault root.
- `src/core/dashboard-server.ts` — `GET /api/wiki` (with optional `?category=&limit=`), `GET /api/wiki/note?path=`. Read-only — no mutations in this PR.

**Frontend changes:**
- Api client + store slice + panel wiring.
- Extend `use-sse.ts` to refetch wiki on `vault-index` events.
- Update `wiki-panel.tsx` — tree + recent list + reader pane all bind to store. Drop `MOCK_NOTES` usage here.
- Update the tag cloud in `capture-panel.tsx` to read tags from the wiki store (keep the forms disabled until PR 6).
- Drop the wiki tree constant and `MOCK_NOTES.recent` / `tags` uses.

### PR 6 — Capture writes

**Spec:** 15 §Wiki Dashboard Surface (Writes), 12 (§Panel 13).

**Backend additions:**
- `src/core/dashboard-server.ts` — `POST /api/wiki/notes` (body: `{ title?, category?, body, tags?, mode: "quick" | "structured" }` → `createNote` or classifier-driven quick capture), `POST /api/wiki/daily` (body: `{ content }` → `appendToDaily`), `POST /api/wiki/ingest` (body: `{ sourcePath, category }` → `ingestFile`). All emit `vault-index` SSE so PR 5's wiki panel refreshes.
- Add a simple idempotency key header (`X-Mink-Dedup-Key`) honored by `createNote` to prevent double-submit duplicates.

**Frontend changes:**
- Api client mutators for each mode.
- `capture-panel.tsx` — enable the four modes, wire `onClick` handlers, surface success/error inline. Remove the `disabled` + `title` hints and the amber `preview` chip.
- Remove the last remaining uses of `MOCK_NOTES` and delete `dashboard/lib/mock-dashboard-data.ts`.

## Cross-cutting tasks (fold into PR 1 or run as PR 0)

- **SSE event IDs** — extend `StateFileId` (wherever it's defined in `src/types/`) with `vault-index`, `sync-status`, `channel-status`, `channel-logs`, `config-changed`, `daemon-status`. Without these, PRs 2–6 cannot emit the live-update events their specs require.
- **Types package** — re-export the new payload types from `@mink/types/dashboard` so `dashboard/lib/api-client.ts` can import them. Check where this package lives (`packages/types/` or similar) before touching.
- **Global-scope route handling** — `resolveProjectCwd()` in `dashboard-server.ts` currently returns 404 when the project doesn't match. The six new GET routes need to bypass that resolver, matching the `/api/projects` precedent at line 409–411.
- **Secret masking helper** — small utility in `dashboard-api.ts` that turns a `channel.discord.token` value into `••••` + last four. Reused by config panel and channel panel.

## What this plan intentionally does not cover

- Cmd-K command palette. Not in scope for the wiring work.
- Obsidian-style graph view. Separate feature, needs its own spec.
- Multi-channel support beyond Discord. Spec 17 leaves room; implementation can wait.
- Auth on mutation endpoints. Local-dev only for now; add a loopback-binding note to spec 12 edge cases before shipping over a network.
- Migration of existing PR #39 preferences (`daemonOverride`, etc.). PR 1 decides whether to delete or demote to dev-only.

## Validation before each PR merges

- `bun run build` in `dashboard/` exports cleanly.
- `bunx tsc --noEmit` at repo root with no new errors.
- `bun test` green (excluding the pre-existing `status command` flake noted in PR #39).
- Manual smoke: open the panel in a browser, exercise every button, verify SSE refresh.
