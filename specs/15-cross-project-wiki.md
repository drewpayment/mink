# 15 — Cross-Project Wiki

## Overview

The cross-project wiki is Mink's second mission. Every piece of knowledge ingested through hooks — file descriptions, learned conventions, bug resolutions, architectural decisions — is incrementally written to a user-owned, project-spanning wiki. The wiki is a markdown vault compatible with tools like Obsidian, stored in a user-configurable location, and backupable to version control.

This feature is **unique to Mink** and does not exist in the reference implementation.

## Capabilities

### Wiki Structure

The wiki must organize knowledge across multiple projects:

```
wiki-root/
  index.md                     — Master index of all projects and recent activity
  projects/
    project-a/
      overview.md              — Project name, description, tech stack, key decisions
      conventions.md           — Coding conventions and preferences for this project
      architecture.md          — Architectural patterns and key design decisions
      bugs/
        bug-001.md             — Individual bug entries with full context
        bug-002.md
      sessions/
        2026-04-09.md          — Daily session summaries
  patterns/
    error-handling.md          — Cross-project patterns (e.g., how errors are handled across projects)
    authentication.md
    testing.md
  glossary.md                  — Terms and definitions encountered across projects
```

### Incremental Updates

The wiki must be updated incrementally as Mink operates:

1. **On project initialization** — Create the project's overview page with metadata from the project.
2. **On learning memory update** — Mirror new User Preferences and Key Learnings to the project's conventions page. Mirror Decision Log entries to the architecture page.
3. **On bug logged** — Create or update a bug page in the project's bugs directory with full context.
4. **On session end** — Append a session summary to the project's daily session page.
5. **On file index scan** — Update the project's overview with current file count and structure summary.

### Cross-Project Linking

The wiki must support cross-referencing:

1. **Wikilinks** — Internal links between pages using standard `[[page-name]]` syntax (compatible with Obsidian and similar tools).
2. **Pattern extraction** — When conventions or bug patterns are similar across projects, create or update cross-project pattern pages in the `patterns/` directory.
3. **Backlinks** — The index page lists all projects with links to their sub-pages.

### Knowledge Aggregation

Over time, the wiki should enable:

1. **Cross-project search** — User can search the entire wiki vault for any term.
2. **Convention comparison** — Compare how different projects handle the same concern (e.g., error handling, auth, testing).
3. **Bug pattern recognition** — Identify recurring bugs across projects (e.g., null checks, timeout handling).

### Wiki Dashboard Surface

The dashboard (spec 12) must be able to read from and write to the wiki through well-defined operations. All operations are global — they act on the single user-level vault, not on any one project.

#### Reads

1. **Vault summary** — Total note count, count of notes under `inbox/`, and the resolved vault path.
2. **Recent notes** — Most recently modified notes, with title, path, tags, category, and a display timestamp. Pageable.
3. **Tree** — The vault's top-level directory structure with a per-folder note count. Depth is bounded to keep the listing navigable.
4. **Tags** — All tags across the vault with their frequencies, ordered by frequency descending.
5. **Note body** — For a given note path, the raw markdown body, parsed frontmatter, and the list of inbound wikilinks (backlinks).
6. **Search** — Substring match against titles, tags, and body with bounded result count.

Category-based filtering must be supported on the recent-notes list.

#### Writes

1. **Quick capture** — Given free text, Mink classifies the category and tags and creates a new note in the appropriate folder. Returns the resulting note path.
2. **Structured capture** — Given explicit title, category, tags, and body, create a new note in the named category folder. Returns the resulting note path.
3. **Append to daily** — Append text to today's daily journal entry, creating the entry if it does not yet exist. Returns the entry's path.
4. **Ingest file** — Given the path of an existing external file and a target category, copy or move its contents into the vault as a new note. Returns the resulting note path.

Every write operation must:

1. Update the vault index so subsequent reads reflect the new or changed note.
2. Trigger the wiki-dashboard live-update event so open dashboard sessions refresh within 2 seconds.
3. If git backup is enabled, participate in the sync flow described earlier in this spec.
4. Return the new note's path and metadata in the response.

Write actions must be idempotent enough that a retry after a network error does not create a duplicate note when the client replays an identical request.

### Configuration

Mink maintains a global configuration directory at `~/.mink/` for user-level settings that span all projects.

#### Global Config File

A global config file at `~/.mink/config` stores user-level settings:

- **Wiki location** — Path to the wiki vault (default: `~/.mink/wiki/`).
- **Wiki enabled** — Toggle the wiki feature on/off (default: on).
- **Sync mode** — `immediate` (update on every hook) or `batched` (update on session end). Default: `immediate`.
- **Git backup enabled** — Whether to auto-commit and push wiki changes (default: off).
- **Git remote** — Remote name to push to when git backup is enabled (default: `origin`).

#### Setting Wiki Location

The wiki location can be configured through:

1. **CLI command** — `mink config wiki.path ~/my-notes/mink-wiki` sets the wiki path. `mink config wiki.git-backup true` enables git backup. `mink config` with no arguments displays all current settings.
2. **Direct file edit** — The user can edit `~/.mink/config` directly in any text editor.
3. **Environment variable** — `MINK_WIKI_PATH` overrides the config file (useful for CI or shared machines).

Priority: environment variable > config file > default.

#### Git Backup

When the wiki is connected to a git repository and git backup is enabled:

1. **On session end** — After wiki files are updated, the session-end hook must:
   a. Stage all changed files in the wiki directory.
   b. Create a commit with a descriptive message (e.g., "mink: session summary for project-name — 3 reads, 2 writes").
   c. Push to the configured remote repository.
2. **Commit message format** — Must identify the project and summarize the session activity.
3. **Push failure handling** — If the push fails (network error, auth issue, conflict):
   a. The commit is preserved locally (work is never lost).
   b. A warning is emitted to the user with the error details.
   c. The next successful session end retries the push (accumulated local commits will push together).
   d. The hook must NEVER block or delay the session end — push is best-effort with a short timeout.
4. **Conflict resolution** — If the remote has diverged (e.g., user edited wiki from another machine):
   a. Attempt a rebase-based pull before pushing.
   b. If conflicts exist, skip the push, warn the user, and leave the local state for manual resolution.
   c. Never force-push. Never silently overwrite remote changes.

#### CLI Config Commands

- `mink config` — Display all current settings with their source (default, config file, or env var).
- `mink config <key>` — Display the value of a specific setting.
- `mink config <key> <value>` — Set a specific value in `~/.mink/config`.
- `mink config --reset <key>` — Remove a setting, reverting to default.
- `mink config --reset-all` — Reset all settings to defaults (with confirmation prompt).

### Portability

The wiki must be:

- Pure markdown files with no proprietary format.
- Compatible with Obsidian (wikilinks, folder structure, frontmatter).
- Browsable in any markdown viewer (GitHub, VS Code, etc.).
- Backupable to any git host.
- Functional without any specific tool — plain files on disk.

## Acceptance Criteria

```
GIVEN Mink is initialized in a new project "my-api"
WHEN the init hook completes
THEN a page exists at wiki-root/projects/my-api/overview.md
AND it contains the project name, description, and tech stack

GIVEN the AI adds a learning memory entry "API uses JWT tokens stored in httpOnly cookies"
WHEN the learning memory update completes
THEN wiki-root/projects/my-api/conventions.md is updated with the new entry

GIVEN the AI logs a bug in project "my-api"
WHEN the bug is saved
THEN a new page exists at wiki-root/projects/my-api/bugs/bug-NNN.md
AND it contains: error message, root cause, fix, tags
AND it links back to the project overview

GIVEN a session ends with 5 reads and 3 writes
WHEN the session summary is generated
THEN wiki-root/projects/my-api/sessions/2026-04-09.md is updated with the summary

GIVEN two projects both have a convention about "error handling with retry"
WHEN the pattern extractor runs
THEN wiki-root/patterns/error-handling.md is created or updated
AND it references both projects with links

GIVEN the user runs "mink config wiki.path ~/my-wiki/"
WHEN the command completes
THEN ~/.mink/config contains wiki.path = ~/my-wiki/
AND subsequent Mink operations write wiki files to ~/my-wiki/

GIVEN MINK_WIKI_PATH is set to "/tmp/test-wiki" and config file says "~/my-wiki/"
WHEN Mink operates
THEN wiki files are written to /tmp/test-wiki (env var takes priority)

GIVEN the wiki is in a git repo and git backup is enabled
WHEN a session ends and wiki files were updated
THEN changed files are staged and committed with a descriptive message
AND the commit is pushed to the configured remote

GIVEN the wiki git push fails due to a network error
WHEN the session-end hook handles the failure
THEN the local commit is preserved
AND a warning is emitted to the user
AND the session-end hook does NOT block or hang

GIVEN the wiki remote has diverged with non-conflicting changes
WHEN the session-end hook attempts to push
THEN it pulls with rebase first, then pushes successfully

GIVEN the wiki remote has diverged with conflicting changes
WHEN the session-end hook detects the conflict
THEN it skips the push
AND warns the user to resolve manually
AND never force-pushes

GIVEN the wiki is opened in Obsidian
WHEN the user navigates using wikilinks
THEN all internal links resolve correctly

GIVEN the user has disabled the wiki feature via "mink config wiki.enabled false"
WHEN hooks fire
THEN no wiki files are created or updated

GIVEN no ~/.mink/config exists yet
WHEN the user runs "mink config wiki.path ~/notes/wiki"
THEN ~/.mink/ directory is created
AND ~/.mink/config is created with the setting

GIVEN the user runs "mink config" with no arguments
WHEN the command completes
THEN all current settings are displayed with their source (default, config, or env var)

GIVEN the user runs "mink config --reset wiki.path"
WHEN the command completes
THEN the wiki.path setting is removed from config
AND subsequent operations use the default path ~/.mink/wiki/

GIVEN the vault contains 214 notes across inbox, projects, patterns, and resources
WHEN the wiki dashboard surface is queried for a summary
THEN the response reports 214 total notes
AND the count of inbox notes matches the actual inbox folder
AND the resolved vault path is returned

GIVEN the vault's recent notes list is queried with category = "pattern"
WHEN the response is returned
THEN only notes whose category is "pattern" are included
AND each entry carries title, path, tags, category, and timestamp

GIVEN the wiki dashboard surface receives a quick-capture request with free text
WHEN the request completes
THEN a new note exists under the appropriate category folder
AND the response returns the note's path
AND the wiki-index live-update event fires

GIVEN the wiki dashboard surface receives a daily-append request
WHEN today's daily entry does not yet exist
THEN the entry is created with the appended text
AND subsequent append requests extend the same entry

GIVEN the wiki dashboard surface receives an ingest-file request for a non-existent source
WHEN the request is processed
THEN the response is a clear "source not found" error
AND no note is created

GIVEN a note path is requested for body plus backlinks
WHEN the response is returned
THEN the raw markdown body is included
AND every page that links to the requested note is listed as a backlink

GIVEN two identical capture requests arrive in rapid succession with the same deduplication marker
WHEN both are processed
THEN only one note is created
```

## Edge Cases

- Wiki directory doesn't exist — create it with the full directory structure.
- Wiki directory is a git repo but git backup is disabled — do not auto-commit; leave that to the user's git workflow.
- Two Mink sessions for different projects run simultaneously — each writes to its own project subdirectory, no conflicts.
- Project is renamed — old wiki pages remain; new pages are created under the new name. A redirect note is added.
- Wiki grows very large (1000+ pages) — no performance concern since files are independent; index page should be periodically rebuilt.
- User moves the wiki to a different location — run `mink config wiki.path <new-path>`, no data migration needed (new location starts fresh or user moves files manually).
- Git backup enabled but wiki is not a git repo — emit a one-time warning with instructions to run `git init` in the wiki directory; skip commit/push until it is a repo.
- Git remote does not exist — emit clear error naming the configured remote and how to add it.
- Git backup push times out (>10 seconds) — abort the push, preserve local commit, warn the user.
- `~/.mink/config` file is corrupted — fall back to defaults for all settings, warn the user, do not overwrite the corrupted file (let them inspect it).
- Cross-project pattern detection finds false similarities — threshold for similarity should be conservative; better to miss a pattern than create noise.
- Dashboard capture while wiki is disabled — capture requests must fail fast with a clear "wiki disabled" error, not silently no-op.
- Dashboard requests a note body for a path outside the vault — refuse with a clear error; never serve files from outside the vault root.
- Concurrent captures from the dashboard and a companion channel — both succeed and produce distinct notes; neither corrupts the vault index.
- Very large vault (5000+ notes) — summary and tree queries must remain responsive; body reads remain O(1) relative to vault size.

## Test Requirements

### Unit Tests

- Wiki page creation from project metadata.
- Incremental update logic — new content appended, existing content preserved.
- Wikilink generation — correct syntax, resolves to existing pages.
- Session summary formatting matches wiki page structure.
- Config file parsing — reads key-value pairs correctly.
- Config priority resolution — env var > config file > default.
- Config write — sets, resets, and displays settings correctly.
- Git commit message generation from session data.

### Integration Tests

- Full lifecycle — init → learn → bug → session → verify all wiki pages.
- Cross-project pattern detection across two sample projects.
- Wiki renders correctly in a markdown viewer (valid markdown, no broken links within the vault).
- `mink config wiki.path <path>` → subsequent operations use the new path.
- `mink config wiki.enabled false` → hooks produce zero wiki file operations.
- Git backup: session end → wiki files committed → pushed to remote.
- Git backup with remote divergence (no conflict) → rebase + push succeeds.
- Git backup with remote conflict → push skipped, user warned, local commit preserved.
- Git backup with network failure → local commit preserved, warning emitted, no hang.
- `~/.mink/` directory creation on first config write.
- Dashboard surface: summary, recent notes, tree, tags, and body reads all return consistent data for a seeded vault.
- Dashboard surface: quick-capture, structured-capture, daily-append, and ingest-file writes each produce the expected note and emit the live-update event.
- Dashboard surface: path traversal outside the vault root is refused.

### Edge Cases

- Simultaneous updates from two projects do not corrupt shared files (index, patterns).
- Disabled wiki feature produces zero wiki file operations.
- Git backup enabled but wiki is not a git repo — warning emitted, no crash.
- Git push timeout (>10s) — aborted cleanly, local commit preserved.
- Corrupted config file — defaults used, warning emitted, file not overwritten.
- `mink config --reset-all` prompts for confirmation before clearing.

### Property Tests

- All generated files are valid markdown.
- All wikilinks reference pages that exist.
- Git backup never force-pushes under any circumstance.
- Session-end hook with git backup never blocks for more than 15 seconds total.
