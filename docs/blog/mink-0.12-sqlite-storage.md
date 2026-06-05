# Mink 0.12: Why I Moved the Hot Path to SQLite

When I [introduced Mink](./introducing-mink.md), the pitch was simple: a hidden presence that quietly maintains state files in `~/.mink/` so your AI assistant stops re-reading the same files and stops repeating mistakes you already corrected.

That state lived in JSON on disk. A file index, a bug memory, a token ledger — each a `.json` file that Mink read and rewrote as Claude worked. It was simple, human-readable, and easy to back up. For most projects, it was fine.

Then people started pointing Mink at big repos. And JSON started to hurt.

## The problem: JSON on the hot path

Mink runs inside Claude Code's lifecycle hooks. Every time the assistant is about to read a file, a `pre-read` hook fires. Every time it writes one, a `post-write` hook fires. These hooks sit directly between you and your assistant — if they're slow, *everything* feels slow.

Here's the thing about a JSON file index: to look up a single file, you parse the **entire** file into memory. To record one new file, you mutate that object and serialize the **entire** thing back to disk. On a 2,000-file project, you never notice. On a 20,000-file monorepo, every hook is parsing and rewriting a multi-megabyte blob — on every read, on every write.

That's an O(n) tax on an operation that should be O(1). The bigger your project, the more the bookkeeping costs — which is exactly backwards from what you want. Mink also carried a file-count cap to keep the JSON from getting unwieldy, which meant the largest projects — the ones that need the help most — were the ones it served worst.

So in 0.12 I moved the three hot-path stores — **file index, bug memory, and token ledger** — out of JSON and into a single per-project SQLite database at `~/.mink/projects/{id}/mink.db`.

## Why SQLite

SQLite is the right tool for this almost embarrassingly well:

- **Indexed lookups.** Checking "have we seen this file?" becomes a single indexed query, not a full-file parse. Lookup cost stops scaling with project size.
- **Incremental writes.** Recording one file touches one row. No more serialize-the-world on every hook.
- **It's a single file.** All the operational simplicity of the old JSON approach — one thing per project, easy to copy, easy to reason about — without the read/write penalty. WAL mode keeps concurrent hook activity smooth.
- **Full-text search comes for free.** SQLite's FTS5 turns bug memory from a linear scan into a real search index.

No server, no daemon, no extra dependency to install. Just a smarter file.

## What you actually get

### Hooks that don't slow down as your project grows

This is the headline. The whole point of Mink is to be invisible — a presence that moves alongside you without getting in the way. A hook that parses a 5MB JSON file on every read is *not* invisible. Indexed SQLite lookups keep hook latency low and flat, whether you're in a 500-file service or a 30,000-file monorepo. **The file-count cap is gone.**

### Incremental scans that finish in a blink

`mink scan` used to re-walk and re-describe your project from scratch. Now it tracks file modification times and a truncated content hash, so it only does work for files that actually changed. A warm re-scan of an unchanged repo is essentially instant:

```text
$ mink scan
(no changes)            # sub-second on a warm 20k-file repo

$ mink scan             # after editing one file
(1 re-indexed, 4 unchanged)

$ touch src/app.ts && mink scan
(1 touch-only)          # mtime moved but content is identical — no re-describe
```

That last case matters more than it looks. Tools, formatters, and branch switches bump modification times constantly without changing a byte. The content hash lets Mink tell "actually edited" from "merely touched" and skip the expensive re-description work for the latter.

### Real full-text bug search

Bug memory — the record of mistakes you've corrected so they don't recur — now lives in an FTS5 index. `mink bug search <query>` returns ranked matches with the same scoring, threshold, and boost behavior as before, but backed by a proper search engine instead of a linear walk. It's faster, and it stays fast as your bug history grows.

### Multi-device sync that just converges

If you sync `~/.mink/` across machines (via git, Dropbox, whatever), two devices can each record new files, bugs, and tokens independently. The old JSON files would conflict on merge. The new database ships with a custom merge driver, `mink-db-merge`, that understands the schema: file-index conflicts resolve to the newer entry, counters merge by max-per-device, insert-only tables take the union. Overlapping changes from two machines converge without you ever seeing a conflict marker.

### A lifetime token ledger that adds up correctly

The token ledger moved into SQLite too, with an `archived` flag that replaces the old separate archive file, and lifetime totals summed per-device directly in SQL. Your "tokens saved" numbers stay accurate across sessions and machines without juggling multiple files.

## The migration is automatic — and reversible

You don't have to do anything. The first time 0.12 runs in a project, it migrates your existing JSON state into `mink.db` and moves the original files into a `legacy-backup/` folder right next to the new database. Nothing is deleted. If you ever want to inspect — or restore — the old state, it's sitting right there.

Mink also now ships a single runtime-selecting `mink` command that picks the right build for whatever you're running. On Bun it uses the `bun:sqlite` driver; on Node it uses `node:sqlite`. Same database, same behavior, either runtime. You can confirm what you're on:

```bash
$ mink --version
mink 0.12.0
  runtime:  bun 1.x.x
  bundle:   cli.bun.js
```

## Why this matters

Mink's entire promise is that it saves you tokens and friction *without adding friction of its own*. The moment the bookkeeping is slow enough to notice, the deal breaks. JSON-on-disk was a fine starting point, but it tied Mink's overhead to the size of your project — penalizing exactly the large, long-lived codebases where remembering-across-sessions pays off the most.

SQLite cuts that cord. Lookups stay fast, writes stay cheap, scans only do real work, search is a real index, and your state survives multi-device sync intact. The bigger and longer-lived your project, the more this matters — which is finally the right direction for the cost curve to bend.

It installs and upgrades the same way it always has:

```bash
bun add -g @drewpayment/mink   # or: npm install -g @drewpayment/mink
cd your-project
mink scan                      # watch the migration happen once, then fly
mink dashboard                 # tokens, still live
```

As always: if you're running this on a real codebase, I'd love to hear what your cold and warm scan times look like, especially on a big repo. That's the number this whole release was built to move.

**GitHub:** [drewpayment/mink](https://github.com/drewpayment/mink) · **npm:** `@drewpayment/mink` · **Feedback:** [open an issue](https://github.com/drewpayment/mink/issues)
