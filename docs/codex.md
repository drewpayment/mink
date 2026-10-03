# Codex integration (experimental)

This first increment supports note capture and retrieval, startup guidance, and
local lifecycle receipts. It does **not** implement the complete adapter contract
in spec 21 or close #115. Shared session-ledger integration, file accounting, and
compression remain followups.

## Setup

```sh
mink init --agent codex --yes
mink wiki init   # only if you do not already have a vault
```

Mink merges two command hooks into `.codex/hooks.json` and installs the shared
note skill at `.agents/skills/mink-note/SKILL.md`. Existing unrelated hooks and
AGENTS.md are preserved. Installed packages generate portable `mink codex-hook`
commands; source development uses a shell-quoted local CLI path.

Open a new Codex session in the project. Review and trust Mink's exact hook
definitions through `/hooks`; repository-local hooks also need the project config
layer to be trusted. Resume or start a session after reviewing so SessionStart
can run. Neither installing nor upgrading Mink grants trust. Changed definitions
need review again. Keep Mink installed and on the PATH used by Codex.

Use `mink codex-status` to inspect configured events, vault availability, and the
latest local lifecycle receipt. Then inspect `/hooks` for actual discovery,
current trust, and execution. A stored receipt may come from an older definition
or a manual test: it is not proof of current trust. Mink does not read or modify
Codex's trust database. This procedure targets the Codex CLI; app hook discovery
and execution have not been verified end to end.

## Feature coverage

| Feature | Coverage in this increment |
| --- | --- |
| Note capture/search | Shared skill and explicit Mink CLI commands |
| Startup guidance | SessionStart `additionalContext` |
| Session lifecycle | Per-device, per-session start/end receipts |
| Shared session ledger | Not integrated |
| Automatic read/write accounting | Not implemented, including shell reads and apply_patch |
| Tool-output compression and savings | Disabled; no PostToolUse handlers installed |
| Current Codex trust status | Manual verification through `/hooks` |

SessionStart runs for startup, resume, clear, and compaction. A receipt retains
its first start time across repeated events with the same session ID; different
threads have independent files. SessionEnd records completion. Stop is a turn
boundary and is intentionally not wired. Receipts live under the project's Mink
state in `state/<device>/codex-hooks/`; they contain hashed session IDs and
timestamps, never prompts, transcripts, or tool responses.

This increment leaves the shared Claude/Pi session untouched. Its lifecycle
commands currently perform synchronous git sync, which can exceed Codex's
three-second SessionEnd limit, and reset a single project-wide session file.
Calling them blindly would risk corrupting another assistant's accounting.
An eventual canonical adapter needs bounded finalization and session ownership.

Codex's documented output-replacement fields are not supported. Using blocking
feedback as a compressor would change tool-call semantics, especially in code
mode. This integration never transforms tool results, so images and non-text
content pass through unchanged and no compression savings are recorded.

## Validation and remaining work

Automated tests execute the adapter with documented hook payloads and check the
actual CLI JSON response, receipts, isolation, install/refresh behavior, and
preservation of unrelated configuration. They do not demonstrate a real Codex
session consuming startup context. Before calling this integration stable,
verify discovery, explicit trust, model-visible guidance, and session end in the
CLI and app. File tracking and compression require separate verified adapters.

Disable the Mink handlers through Codex `/hooks` to stop automatic execution.
The note skill and captured notes remain available.

Sources checked September 5, 2026:
[Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[Codex skills](https://developers.openai.com/codex/skills/).
