# Spec 23 — TUI Dashboard

## Mission

Give power users the dashboard's Overview visibility in a single fullscreen terminal UI — no web server, no browser. Inspired by btop and lazygit: boxed panels, single-key navigation, live-updating stats, instant startup, always leaves the terminal clean.

## Goals (v1)

- New CLI command `mink tui` that opens a fullscreen terminal dashboard.
- **Overview parity**: reproduce the web dashboard Overview panel's information — total tokens saved (heuristic + measured), lifetime KPIs, last-7-days token activity, active/most-recent session, compression measured savings, and session history.
- Live refresh while open (~1s tick) reflecting hook activity as it happens.
- Works identically under bun and node from the existing dual-runtime bundle.
- Zero new runtime dependencies.
- **Multi-project switcher**: `p` opens a project picker overlay (all registered projects, current one marked) and switches the live dashboard to the selected project's cwd without restarting the process.

## Non-goals (v1)

- Feature parity with the full web dashboard (other panels come later — see Roadmap).
- Mouse support, scrollback, configurable themes/layouts, mutation actions (e.g. toggling compression). Read-only.
- Windows legacy conhost fidelity (modern Windows Terminal is in scope).

## User experience

### Invocation

- `mink tui` — open the TUI for the current project (same project resolution as `mink dashboard`: cwd first, fall back to a registered project).
- If stdout is **not a TTY** (piped, CI): do not enter the alternate screen; print a short notice and exit 0.
- If the terminal is smaller than the minimum (80×24): show a centered "Terminal too small — need at least 80×24" message that resolves itself when the user resizes. Never render garbage.

### Layout (≥80×24, scales with terminal size)

Boxed panels with titled borders, in the spirit of btop:

```
┌ mink · <project> ───────────────────── daemon ● running · up 2h 14m ┐
│  TOTAL TOKENS SAVED   1.23M   ▐██████████▓▓▓▓░░░░▌  heuristic/meas  │
├ Lifetime ────────────────┬ Token usage — last 7 days ───────────────┤
│ Tokens     Sessions      │  saved  ▂▃▅▇▆▅▄                          │
│ Read sav.  Compression   │  in     ▁▂▃▅▄▃▂   (per-day, 3 series)    │
├ Session (most recent) ───┴ Compression — measured ──────────────────┤
│ reads/writes/tokens bars │ before→after bar, ratio, events, holdout │
├ Session history ─────────────────────────────────────────────────── ┤
│ id  start  duration  reads  writes  tokens  saved   (newest first)  │
└ q quit · ? help · r refresh ──────────────────────── updated 14:32 ┘
```

- Footer always shows key hints (lazygit convention) and last-refresh time.
- `?` opens a help overlay listing all keys; any key closes it.
- Focused panel (v1: the history table) gets a highlighted border.

### Keybindings (v1)

| Key | Action |
|---|---|
| `q`, `Ctrl-C` | quit (restore terminal) |
| `?` | help overlay (shell keys + active screen's keys) |
| `r` | force refresh of the active screen |
| `Tab`/`Shift-Tab`, `1`–`5` | switch screens (Overview, Sessions, Compression, Memory, Wiki) |
| `j`/`k`, `↓`/`↑`, `g`/`G` | scroll/select within the active screen |
| `p` | open the project picker |
| `j`/`k`, `↓`/`↑` (picker open) | move selection |
| Enter (picker open) | switch to the selected project |
| Esc, `p`, `q` (picker open) | close the picker without switching |
| `b`/`l` (Memory screen) | focus bugs / learnings section |
| `/` (Wiki screen) | search mode — type to filter, Enter confirms, Esc clears |

A screen may declare `capturesInput` (e.g. Wiki's search mode) to receive every key — including shell-owned ones like `q`/`p`/digits — while a text input has focus; `Ctrl-C` always quits regardless.

### Visual language

- Semantic color map (accent, good, warn, error, dim, border, title) resolved once at startup: truecolor if `COLORTERM` says so, else 256-color, else plain; honor `NO_COLOR`. Degrade to 256 under `TERM=screen*/tmux*` without RGB capability.
- Sparklines via `▁▂▃▄▅▆▇█`, bars via `█▓░`, borders via Unicode box drawing.
- All text placement must be width-safe for CJK/emoji (no `.length` math).

## Data requirements

The TUI reads the same state as the web dashboard, via the three existing pure loaders in `src/core/dashboard-api.ts` — **no HTTP server, no SSE, no file watcher from dashboard-server.ts**:

- `loadOverview(cwd)` → project, daemon status, lifetime summary, compression fallbacks
- `loadTokenLedgerPanel(cwd)` → sessions list (7-day chart, session card, history)
- `loadCompressionPanel(cwd)` → lifetime/arms measured-compression stats

Client-side derivations currently living in `overview-panel.tsx` must be reimplemented in a **pure, unit-tested view-model** (shared location: `src/tui/overview-model.ts`):

1. 7-day bucketing of `ledger.sessions` by `startTimestamp` (port of `groupLast7Days`, `overview-panel.tsx:60-81`): per-day `saved`, `in` (estimatedTokens), `out` (writeCount-based) series.
2. Savings split: `heuristic = overview.summary.estimatedSavings`; `measured = compression.lifetime.totalMeasuredSavings ?? overview.compression.totalMeasuredSavings`.
3. Compression ratio: `pct(measuredSavings, arms.compressed.originalTokens)` with `overview.compression.*` fallbacks.
4. Number formatting (`1.23M`, `45.6k`), duration formatting (`2h 14m`), timestamp formatting.

### Refresh model

- `setInterval` tick, default **1000ms** (`--interval=<ms>` flag, min 250), re-runs the three loaders and repaints if the frame changed.
- Immediate repaint on keypress (scroll, help) without waiting for the tick.
- Loaders are cheap synchronous SQLite reads; polling is acceptable and simpler than watching `mink.db-wal` mtimes. (Do not reuse the web server's filename watcher — its `STATE_FILE_MAP` predates the SQLite migration and misses DB-backed changes.)

## Architecture

View layer is strictly separated from data so a future migration to a richer framework (Ink) would replace only rendering:

```
src/tui/
  term.ts            alternate screen, raw mode, cursor, cleanup, SIGWINCH,
                     key parsing (arrows/ctrl), non-TTY guard
  width.ts           charWidth/stringWidth/truncate (East-Asian wide + emoji aware)
  style.ts           color depth detection, NO_COLOR, semantic color map, sgr()
  screen.ts          cell-grid double buffer, diff repaint (never full clears)
  widgets.ts         box (titled border), statTile, sparkline, hbar, stackedBar,
                     table (scrollable window), helpOverlay
  overview-model.ts  buildOverviewModel(cwd): pure data assembly + derivations
  overview-screen.ts layout: compose widgets from OverviewModel into a Screen
src/commands/tui.ts  arg parsing, guards, run loop (tick + input), teardown
src/cli.ts           `case "tui"` + help text
```

Contracts:

- `screen.ts` renders into an in-memory cell grid; `flush()` emits minimal ANSI diffs. Rendering a `Screen` to a plain string (no ANSI) must be supported for tests.
- `buildOverviewModel(cwd)` returns plain serializable data (no ANSI, no layout) — fully unit-testable against fixture payloads.
- `overview-screen.ts` is a pure function `(model, cols, rows) → Screen` — snapshot-testable without a real terminal.
- **Terminal safety is non-negotiable**: cursor restore + alternate-screen exit on normal quit, SIGINT/SIGTERM, and uncaught exceptions. A crash must never leave the terminal wrecked.

### Runtime constraints

- Only APIs available in both node (≥24, `node:sqlite`) and bun: `process.stdout.write/columns/rows`, `process.stdin.setRawMode`, `SIGWINCH`, `setInterval`.
- No new `dependencies`. Everything bundles through the existing `scripts/build.mjs` dual-target `bun build` (new files under `src/` are picked up automatically; `files` allowlist already ships `src/**/*.ts`).

## Testing requirements

- Unit: `width.ts` (CJK, emoji ZWJ, truncation), `style.ts` (depth detection, NO_COLOR), `screen.ts` (diff output minimality, resize), each widget (fixed-size string snapshots), `overview-model.ts` (7-day bucketing edge cases: empty ledger, single session, sessions spanning >7 days; savings split fallbacks; ratio with zero denominators).
- Integration: `overview-screen.ts` full-frame snapshot at 80×24 and 120×40 from a fixture model, including empty-state (fresh project, no sessions, compression off).
- Non-TTY guard: invoking the command with stdout not a TTY exits 0 with a notice, emitting no escape codes.
- All tests must pass under `bun test` alongside the existing suite.

## Shipped screens (originally the roadmap)

All built on the screen-registry architecture (one file + one `SCREENS` entry each):

1. **Sessions** (`2`): master-detail session drill-down — full table (newest first, uncapped) + detail pane with per-session KPIs, index-hit-rate bar, and project-level waste flags (the payload carries no per-session attribution).
2. **Compression** (`3`): measured-savings KPIs, per-content-kind breakdown table, scrolling recent-events feed; disabled/empty states mirror the web panel.
3. **Memory** (`4`): bugs + learnings browser — `b`/`l` switches section focus, independent cursors, detail pane with full text.
4. **Wiki** (`5`): note list with `/`-search (substring on title + path, via `capturesInput`) and a preview pane for the selected note.

## Roadmap (post-v2, only on demand)

- Wiki: print selected note path on exit (lazygit-style "open in editor").
- Theming/config (`~/.mink/config` keys), layout presets, mouse support.

## Definition of done (v1)

- `mink tui` renders the Overview layout with live data under both `bun` and `node` runtimes.
- Numbers shown match the web dashboard Overview for the same project state.
- Quit/crash/resize/small-terminal/non-TTY all behave per this spec.
- Typecheck, build, dashboard build, and full test suite green in CI.
- `mink --help` documents the command; README gains a short TUI section with a screenshot placeholder.
