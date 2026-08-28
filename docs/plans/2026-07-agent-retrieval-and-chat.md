# Mink Agent: Retrieval & Chat — Next Iteration Plan

_Drafted 2026-07-23 from a two-track audit: (1) the `mink agent` / capture / retrieval implementation in this repo, (2) the actual state of the live vault at `~/.mink`._

## Diagnosis — why retrieval feels inconsistent

Capture is healthy. Retrieval fails for five compounding reasons, roughly in order of impact:

1. **`mink note search` is body-blind.** It substring-matches only `title`, `tags`, `filePath`, and a 120-char first-line `description` from `.mink-index.json` (`src/core/note-index.ts:193`). Any fact in a note body is invisible to it. No ranking, hard cap of 20.
2. **The agent isn't told how to search.** `agents/mink-agent.md.tmpl` says "search the vault" but prescribes no procedure. The model often picks the documented-but-weak `mink note search` instead of `rg`, and silently misses.
3. **34% of wikilinks are dead.** 960 of 2,856 links don't resolve: files are kebab-slugs (`global-catalog.md`) but notes link by display title (`[[Global Catalog]]`), and only 9 of ~985 real notes declare `aliases:`. Side effect: 54% of notes are orphans, so link-graph navigation dead-ends.
4. **Test pollution drowns the index.** ~22% of the 1,335 index entries are integration-test junk (`mink-init-test-*`, `hello-world-*`, `sync-*`); 916 of 988 dirs under `~/.mink/projects` are `mink-dash-integ-*`. Root cause: tests write to the real `$HOME` vault.
5. **Ambiguity.** 65 duplicated basenames across 234 files (41 `README.md`, 16 `overview.md`, same-day dailies ×5) make bare `[[overview]]`-style links non-deterministic; daily notes use three different naming formats.

Also relevant: spec 15's auto-aggregation (per-project `overview/conventions/bugs` pages, `patterns/`, glossary) is essentially unimplemented — the wiki today is a manually/skill-populated PARA vault, and `patterns/` is empty.

**On Obsidian:** `~/.mink/wiki` already *is* a valid Obsidian vault (`.obsidian/` present, plain markdown + wikilinks + frontmatter). There is no official headless Obsidian CLI worth bundling — community `obsidian-cli` tools wrap the desktop app's URI scheme and can't serve as a search backend. The right move is to stay markdown-native and Obsidian-compatible, fix link hygiene so Obsidian's graph actually works, and own retrieval ourselves (SQLite FTS5 — already a mink dependency for bug memory).

**On API keys:** none needed. `mink agent` already rides Claude Code's auth (`claude --agent`). The chat iteration below keeps that pattern via headless engine adapters (`claude -p`, Copilot CLI, Pi), so mink never holds a key.

---

## Phase 0 — Stop the bleeding: vault hygiene (`mink wiki doctor`)

New command `mink wiki doctor` (audit) / `mink wiki doctor --fix` (repair). Never hard-deletes: quarantines to `archives/_doctor/<date>/`. `--dry-run` prints the full change list.

Checks & fixes:
- **Purge test pollution** from both stores: wiki notes matching `mink-init-test-*`, `mink-refresh-cwd-*`, `mink-targets-cwd-*`, `hello-world-*`, `sync-*`, `note-<timestamp>`, `test-note-*`; project-state dirs matching `mink-dash-integ-*`. Re-index afterward.
- **Backfill `aliases:`** on every note whose H1/title differs from its slug (title + slug both listed). This alone should recover most of the 960 broken links and collapse the orphan count.
- **Canonicalize ambiguous links**: rewrite bare `[[overview]]`/`[[README]]`-style links to path-qualified `[[projects/<slug>/overview|overview]]` when multiple targets exist.
- **Standardize dailies** to ISO `YYYY-MM-DD.md`; rename the stragglers and fix inbound links.
- **Fix or remove** the broken top-level `notes` symlink (points at a nonexistent user path).
- Report link-health stats (resolved/broken/orphans) so progress is measurable.

**Root-cause fix (same phase): test isolation.** Integration tests must set `MINK_WIKI_PATH`/mink root to a temp dir — add a test-harness fixture and a CI guard that fails any test touching the real home. Without this, pollution returns.

Acceptance: broken-link rate < 5%, zero `*-test-*` entries in `.mink-index.json`, tests green with no writes outside temp dirs.

## Phase 1 — A real retrieval engine (`mink recall`)

- **SQLite FTS5 full-text index** of the wiki (note bodies + title + tags + frontmatter fields), BM25-ranked, stored beside the vault (e.g. `~/.mink/wiki/.mink-search.db`, gitignored). Incremental updates hooked into `note-writer.ts`; `mink wiki reindex` for full rebuilds; mtime-based catch-up on startup so external edits (Obsidian, git sync) get picked up.
- **`mink recall "<query>"`** — ranked results with path, title, matched snippet, tags; `--json` for agents; filters `--project`, `--tag`, `--category`, `--since`. Make `mink note search` an alias or deprecate it.
- **Graph queries**: `mink wiki related <note>` (backlinks + outlinks + shared-tag neighbors) and `mink wiki backlinks <note>`, replacing the dashboard's O(n) full-vault regex scan (`dashboard-api.ts:647`) with indexed lookups.
- **Write-time hygiene** so Phase 0 never regresses: `note-writer.ts` auto-adds `aliases: [<Title>]` when slug ≠ title; `note-linker.ts` emits path-qualified links when the bare name is ambiguous.

Acceptance: a fact that exists only in a note body is findable via `mink recall` in one call; dashboard note view no longer reads every file.

## Phase 2 — Teach the agent to retrieve (prompt rewrite)

Rewrite `agents/mink-agent.md.tmpl` (and the `mink-note` skill's retrieval guidance):
- **Explicit retrieval playbook**: (1) `mink recall --json "<query>"`, (2) widen with tag/category filters, (3) `rg` fallback for exact strings, (4) follow `mink wiki related` one hop from the best hits, (5) cite paths; say "not found, here's what I tried" instead of guessing.
- Remove references to the unimplemented `projects/<slug>/{overview,conventions,architecture}` structure (or build it — see Phase 4).
- Capture guidance: always set aliases, tags from existing vocabulary, and at least one wikilink to an existing note (kill orphans at birth).
- Add a small eval harness: ~15 question/answer pairs against a fixture vault, run with `claude -p --agent mink-agent` in CI-optional mode, so retrieval quality is measured, not vibes.

## Phase 3 — `mink chat`: the less-Claude-Code experience

A chat pane in the existing TUI dashboard (feat/tui-dashboard already has the btop/lazygit shell), plus standalone `mink chat`. No API key: it drives an installed agent CLI headlessly through an **engine adapter** interface:

```
interface ChatEngine {
  start(opts): Session          // cwd = ~/.mink, system prompt = mink-agent definition
  send(text): AsyncIterable<Delta>
  resume(sessionId): Session
}
```

- **claude** adapter first: `claude -p --output-format stream-json --include-partial-messages` with `--agent mink-agent` / `--resume` for session continuity.
- **copilot** and **pi** adapters behind the same interface (both have headless/programmatic modes); engine chosen by `mink.config` or `--engine`.
- The TUI renders streamed markdown, shows cited note paths as openable items (enter → view note in dashboard / `o` → open in Obsidian via `obsidian://` URI), and offers a capture keybinding that routes through the same note-writer.
- `mink agent` remains as the "drop me into a full Claude Code session in the vault" power tool.

This phase is deliberately last: with Phases 0–2 done, every engine gets good retrieval for free via `mink recall`; the TUI is presentation.

## Phase 4 (optional, later) — Spec 15 auto-population

Hook-driven per-project `overview.md` / `conventions.md` / bug pages and cross-project `patterns/`, as spec'd. These act as MOC entry points that further improve recall. Deferred until 0–2 prove out.

---

## Execution notes

- Order: 0 → 1 → 2 ship together as one beta (they're the fix for the user-felt pain); 3 is the next beta; 4 backlog.
- Phase 0 doctor + test isolation, Phase 1 engine, and Phase 2 prompt work are independent enough to parallelize across subagents after the doctor's quarantine format and the recall CLI contract are pinned.
- All work on feature branches per repo convention; beta releases tagged per the release process.
