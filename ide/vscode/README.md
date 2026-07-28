# Mink for VS Code (spec 31)

A thin VS Code extension that surfaces [Mink](../../README.md) where you work. It
never reimplements Mink logic — every command shells out to the `mink` CLI and
streams the result into a **Mink** output channel.

## Commands

| Command | Runs |
|---|---|
| **Mink: Context Pack** | `mink context` |
| **Mink: Search Bug Memory** | `mink bug search <query>` |
| **Mink: Similar Tasks (current file)** | `mink similar --files=<active file>` |
| **Mink: Capture Note** | `mink note <text>` |

## Requirements

- The `mink` CLI installed and on your `PATH`.
- A workspace folder open (commands run with that folder as the working
  directory, so they resolve against that project's Mink state).

## Architecture

All decision logic lives in [`src/cli-bridge.ts`](src/cli-bridge.ts) — pure,
VS-Code-free, and unit-tested (`tests/unit/ide-cli-bridge.test.ts` in the repo
root). [`src/extension.ts`](src/extension.ts) is thin VS Code glue: register
commands, spawn `mink`, render output.

## Develop / test

```bash
cd ide/vscode
npm install          # pulls @types/vscode + esbuild
npm run typecheck
npm run build        # bundles to dist/extension.js
```

Then press **F5** in VS Code to launch an Extension Development Host and try the
commands. The interactive UI must be tested in that host — it cannot be exercised
headlessly. The pure CLI-bridge logic is covered by the repo's bun test suite.

Gutter decorations (bugs keyed to the current file) and a JetBrains port are
planned follow-ups.
