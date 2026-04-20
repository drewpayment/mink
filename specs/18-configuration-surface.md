# 18 — Configuration Surface

## Overview

Mink's behavior is configured through a layered set of settings. Some settings are shared across all machines a user owns (wiki path, feature toggles); others are machine-specific (bot tokens, local paths, heartbeat tuning). A single resolution rule blends them at read time so that every feature sees one consistent value. Both layers are plain text on disk, editable by hand, and readable by the user without special tools.

This spec covers the configuration system as a whole. Feature-specific key meanings live in the specs that own those features (wiki config in spec 15, channel config in spec 17, etc.).

## Capabilities

### Two-Tier Storage

1. **Shared configuration** — `~/.mink/config`. Intended to travel with the user across machines (e.g. via the wiki sync flow described in spec 15). Contains settings that are identical regardless of where Mink runs.

2. **Per-machine configuration** — `~/.mink/config.local`. Never synced. Contains settings that must differ between machines — credentials, absolute paths specific to that machine, ports in use, device identity.

Both files use the same key-value format.

### Resolution

When any code reads a configuration value, the resolver returns the first match in this order:

1. Environment variable (if the key has a defined env-var mapping).
2. Per-machine config file.
3. Shared config file.
4. Built-in default.

The resolver must also return the **source** of the resolved value so the UI and CLI can display it.

### Key Grouping

Keys are namespaced with dots and naturally group by domain. The configuration surface must be able to return settings grouped by their top-level namespace, in a stable order, for UIs that render a grouped list. Example groups:

- `wiki.*` — wiki location, enabled flag, auto-tag behavior.
- `notes.*` — note templates, default category.
- `sync.*` — git sync of `~/.mink`, timeouts, auto-pull/push toggles.
- `channel.*` — companion channel settings (see spec 17).
- `daemon.*` — heartbeat interval, auto-restart, boot-on-login.
- `dashboard.*` — port, default panel.
- `log.*` — log level, rotation.
- `runtime.*` — runtime preferences.

### Reads

1. **List all** — Return every known key with its resolved value and source.
2. **Read one** — Return the resolved value, source, and default for a single key.
3. **Filter** — The list must be filterable by substring match on the key name.

### Writes

1. **Set a value** — Write a key to either the shared or per-machine file. The caller specifies scope.
2. **Reset one key** — Remove the key from the named scope, falling back to the next layer.
3. **Reset all** — Clear a scope entirely, with explicit confirmation from the caller.
4. **Export** — Produce a serialized snapshot of the current resolved configuration.
5. **Import** — Merge a serialized snapshot into one of the scopes. Conflicts replace.

Writes must be atomic — partial files must never be left on disk.

### Validation

1. Each key has a declared type (string, boolean, integer, enum).
2. Writes must reject values that do not match the declared type with a clear error.
3. Unknown keys may be stored (for forward compatibility) but must be surfaced as "unknown key" in list output.

### Machine Identity

Each machine must have a stable, opaque identifier (UUID-style) persisted in the per-machine scope. It is set once on first use and never changes. This identifier is what makes per-machine configuration meaningful and is also used by sync to avoid feedback loops (see spec 15).

### Secrets

Values marked as secrets (e.g. channel bot tokens) must:

1. Be stored only in the per-machine scope.
2. Be masked by default in any read path that serves a UI.
3. Be refusable to export unless the caller explicitly opts in.

### Migration

1. When a key is renamed or restructured, the resolver must accept the old key on read and schedule a rewrite on the next write.
2. A migration run on startup is permitted when the on-disk format changes.

## Acceptance Criteria

```
GIVEN ~/.mink/config contains "wiki.enabled = true"
AND ~/.mink/config.local is absent
WHEN code reads "wiki.enabled"
THEN the resolved value is true
AND the source is "shared"

GIVEN ~/.mink/config contains "wiki.enabled = true"
AND ~/.mink/config.local contains "wiki.enabled = false"
WHEN code reads "wiki.enabled"
THEN the resolved value is false
AND the source is "local"

GIVEN the environment variable MINK_WIKI_PATH is set to "/tmp/w"
AND ~/.mink/config contains a different wiki.path
WHEN code reads "wiki.path"
THEN the resolved value is "/tmp/w"
AND the source is "env"

GIVEN no configuration exists anywhere
WHEN code reads any known key
THEN the default value is returned
AND the source is "default"

GIVEN the configuration surface is queried for all settings
WHEN the list is returned
THEN keys are grouped by namespace in a stable order
AND each entry includes key, resolved value, and source

GIVEN a secret-typed key "channel.discord.token" is stored
WHEN a UI read path requests the list
THEN the value returned for that key is masked

GIVEN the user writes "daemon.heartbeat-seconds = 10" to the shared scope
WHEN the write completes
THEN ~/.mink/config contains the new value
AND subsequent reads see 10

GIVEN the user writes "daemon.heartbeat-seconds = 10" to the local scope
WHEN the write completes
THEN ~/.mink/config.local contains the new value
AND ~/.mink/config is not touched

GIVEN a key has been reset in the local scope
WHEN the key is read afterwards
THEN the resolver falls through to the shared scope (or default)

GIVEN a caller attempts to write "daemon.heartbeat-seconds = notanumber"
WHEN the write is validated
THEN the write is rejected with a type error
AND no file is modified

GIVEN configuration is exported
WHEN secrets-inclusion is not explicitly requested
THEN secret values are omitted from the export

GIVEN the dashboard is open
WHEN any configuration write succeeds
THEN the configuration panel refreshes within 2 seconds without a page reload
```

## Edge Cases

- Both scope files absent — every read returns the default with source "default".
- Shared file corrupted — treat as empty, warn the user, do not overwrite. Local still loads.
- Local file corrupted — same treatment; shared still loads.
- Concurrent writes from two processes — last writer wins; neither file ends up half-written.
- Unknown key stored from a future version of Mink — preserved on read, displayed as "unknown" in the list, round-tripped on export.
- Key with no declared type encountered — treated as string.
- Per-machine file committed to the wiki repo by mistake — sync must refuse to include it (see spec 15).
- Export with secrets requested but no secrets exist — succeeds with no secrets in the payload.

## Test Requirements

### Unit Tests

- Resolution order across every combination of env / local / shared / default.
- Source is correct for every resolution path.
- Filter by substring returns only matching keys.
- Type validation rejects mismatched values.
- Secret masking applied on the UI read path, not on internal reads.
- Atomic write — no half-written file after a simulated crash.

### Integration Tests

- Full round trip: write → read → matches in both scopes.
- Scope isolation: writing to local does not touch shared and vice versa.
- Reset one key falls through to the next layer.
- Reset all requires explicit confirmation and clears only the named scope.
- Export then import reproduces the original configuration state (sans secrets).
- Dashboard write → SSE notification → panel updates.

### Edge Cases

- Both files absent — defaults only.
- One file corrupted — other still loads; warning emitted; no overwrite.
- Concurrent writers — final state is one of the two writes, not a mix.
- Unknown keys round-trip without loss.
- Secret export respects the opt-in flag.
