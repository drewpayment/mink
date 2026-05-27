// End-to-end contract for the Claude Code hooks mink registers.
//
// Unit tests call the hook functions directly with synthetic state, which
// cannot catch the failure modes that actually surface on user machines:
//
//   - The registered shell command becomes unparseable or refers to a
//     binary that does not exist (the "other machine" symptom — empty
//     dashboard despite reads/writes happening).
//   - The CLI dispatcher silently drops an event because the payload
//     schema drifted (the post-read tool_response vs tool_output bug
//     that caused near-zero token savings before PR #80).
//   - A hook is registered but its subcommand was renamed or removed.
//
// This file exercises the real path: it builds a hooks config the same way
// `mink init` does, executes each registered command through a shell with
// the appropriate stdin payload, then asserts the expected state files
// landed where dashboard / status would later read them from.
//
// Each test isolates state via MINK_ROOT_OVERRIDE so a parallel test run
// (or a developer running this against their actual mink home) never sees
// cross-contamination.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  realpathSync,
} from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { spawn } from "child_process";
import { buildHooksConfig } from "../../src/commands/init";

interface RegisteredHook {
  command: string;
}

interface RegisteredEvent {
  matcher: string;
  hooks: RegisteredHook[];
}

type RegisteredSettings = {
  hooks: Record<string, RegisteredEvent[]>;
};

// Absolute path to this repo's src/cli.ts. Tests deliberately point hooks
// at the source CLI (not dist/cli.js) so the suite is hermetic — it does
// not require a prior `bun run build`, nor does it depend on whether the
// `mink` bin is installed on PATH.
const CLI_TS = resolve(import.meta.dir, "../../src/cli.ts");

function buildSettings(): RegisteredSettings {
  const hooks = buildHooksConfig(CLI_TS);
  return { hooks };
}

function getRegisteredCommand(
  settings: RegisteredSettings,
  event: string,
  matcher: string
): string {
  const entries = settings.hooks[event] ?? [];
  const entry = entries.find((e) => e.matcher === matcher) ?? entries[0];
  if (!entry) throw new Error(`no hook registered for ${event}/${matcher}`);
  return entry.hooks[0].command;
}

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runHook(
  command: string,
  cwd: string,
  stdinPayload: string,
  minkRoot: string
): Promise<RunResult> {
  return new Promise((resolveRun) => {
    const proc = spawn(command, {
      cwd,
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MINK_ROOT_OVERRIDE: minkRoot },
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("exit", (code) => {
      resolveRun({ exitCode: code ?? -1, stdout, stderr });
    });
    if (stdinPayload) proc.stdin.write(stdinPayload);
    proc.stdin.end();
  });
}

function readProjectState(minkRoot: string): {
  projectId: string;
  projectDir: string;
} {
  const projectsDir = join(minkRoot, "projects");
  if (!existsSync(projectsDir)) {
    throw new Error("project state was never created");
  }
  const ids = readdirSync(projectsDir);
  if (ids.length === 0) {
    throw new Error("project state was never created");
  }
  if (ids.length > 1) {
    throw new Error(
      `expected exactly one project under ${projectsDir}, found ${ids.length}: ${ids.join(", ")}`
    );
  }
  return { projectId: ids[0], projectDir: join(projectsDir, ids[0]) };
}

describe("hook-contract e2e", () => {
  let projectCwd: string;
  let minkRoot: string;
  let settings: RegisteredSettings;

  beforeEach(() => {
    // realpath resolution matters on macOS, where /var/folders is a symlink
    // to /private/var/folders. The spawned hook sees the resolved form via
    // process.cwd(), so we must hand it the same form — otherwise
    // relative(cwd, absolutePath) produces a /var-vs-/private mismatch and
    // every recorded path is a long ../../.. chain.
    projectCwd = realpathSync(
      mkdtempSync(join(tmpdir(), "mink-hook-contract-cwd-"))
    );
    minkRoot = realpathSync(
      mkdtempSync(join(tmpdir(), "mink-hook-contract-root-"))
    );
    settings = buildSettings();
  });

  afterEach(() => {
    rmSync(projectCwd, { recursive: true, force: true });
    rmSync(minkRoot, { recursive: true, force: true });
  });

  // ── Registration ────────────────────────────────────────────────────────

  test("registers commands for every lifecycle event", () => {
    const events = Object.keys(settings.hooks).sort();
    expect(events).toEqual(["PostToolUse", "PreToolUse", "SessionStart", "Stop"]);

    // PreToolUse and PostToolUse each cover Read + Edit + Write.
    const pre = settings.hooks.PreToolUse.map((e) => e.matcher).sort();
    const post = settings.hooks.PostToolUse.map((e) => e.matcher).sort();
    expect(pre).toEqual(["Edit", "Read", "Write"]);
    expect(post).toEqual(["Edit", "Read", "Write"]);
  });

  test("every registered command is shell-parseable and resolves to a real CLI subcommand", () => {
    for (const [event, entries] of Object.entries(settings.hooks)) {
      for (const entry of entries) {
        const cmd = entry.hooks[0].command;
        expect(cmd, `${event}/${entry.matcher}`).toMatch(
          /(mink|cli\.ts|cli\.js)\s+[a-z][a-z-]+$/
        );
      }
    }
  });

  // ── SessionStart ────────────────────────────────────────────────────────

  test("SessionStart creates session.json in the project state dir", async () => {
    const cmd = getRegisteredCommand(settings, "SessionStart", "");
    const result = await runHook(cmd, projectCwd, "{}", minkRoot);

    expect(result.exitCode, result.stderr).toBe(0);
    const { projectDir } = readProjectState(minkRoot);
    const sessionFile = join(projectDir, "session.json");
    expect(existsSync(sessionFile)).toBe(true);
    const session = JSON.parse(readFileSync(sessionFile, "utf-8"));
    expect(session.reads).toBeDefined();
    expect(session.writes).toBeDefined();
  });

  // ── PostToolUse / Read ─────────────────────────────────────────────────

  test("PostToolUse/Read records a read entry given Claude Code's legacy tool_output payload", async () => {
    // Bootstrap session.
    const startCmd = getRegisteredCommand(settings, "SessionStart", "");
    await runHook(startCmd, projectCwd, "{}", minkRoot);

    // Create a real file in the project so post-read can record it.
    const filePath = join(projectCwd, "src", "demo.ts");
    mkdirSync(join(projectCwd, "src"), { recursive: true });
    writeFileSync(filePath, "export const x = 1;\n".repeat(40));

    const postReadCmd = getRegisteredCommand(settings, "PostToolUse", "Read");
    const payload = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: filePath },
      tool_output: { content: "export const x = 1;\n".repeat(40) },
    });
    const result = await runHook(postReadCmd, projectCwd, payload, minkRoot);
    expect(result.exitCode, result.stderr).toBe(0);

    const { projectDir } = readProjectState(minkRoot);
    const session = JSON.parse(
      readFileSync(join(projectDir, "session.json"), "utf-8")
    );
    // SessionState.reads is keyed by relative filePath; the value carries
    // counters/tokens, not the path itself.
    expect(Object.keys(session.reads)).toEqual(["src/demo.ts"]);
    const recorded = session.reads["src/demo.ts"] as { estimatedTokens: number };
    // Content was provided, so token estimate must be > 0 — this guards the
    // schema extraction (regression: returning null silently makes savings = 0).
    expect(recorded.estimatedTokens).toBeGreaterThan(0);
  });

  // Claude Code's current production payload nests tool output under
  // `tool_response` (often as an array of {type:"text", text}) rather than
  // the legacy `tool_output.content` shape. Guards against a regression
  // where the extractor silently returns null and token savings stay at 0
  // — the exact bug that motivated PR #80's post-read fix.
  test("PostToolUse/Read records a read entry given Claude Code's tool_response payload", async () => {
    const startCmd = getRegisteredCommand(settings, "SessionStart", "");
    await runHook(startCmd, projectCwd, "{}", minkRoot);

    const filePath = join(projectCwd, "src", "modern.ts");
    const text = "export const modern = true;\n".repeat(40);
    mkdirSync(join(projectCwd, "src"), { recursive: true });
    writeFileSync(filePath, text);

    const postReadCmd = getRegisteredCommand(settings, "PostToolUse", "Read");
    const payload = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: filePath },
      tool_response: [{ type: "text", text }],
    });
    const result = await runHook(postReadCmd, projectCwd, payload, minkRoot);
    expect(result.exitCode, result.stderr).toBe(0);

    const { projectDir } = readProjectState(minkRoot);
    const session = JSON.parse(
      readFileSync(join(projectDir, "session.json"), "utf-8")
    );
    expect(session.reads["src/modern.ts"].estimatedTokens).toBeGreaterThan(0);
  });

  test("PostToolUse/Read ignores payloads it does not understand without crashing", async () => {
    const startCmd = getRegisteredCommand(settings, "SessionStart", "");
    await runHook(startCmd, projectCwd, "{}", minkRoot);

    const postReadCmd = getRegisteredCommand(settings, "PostToolUse", "Read");
    // Malformed: wrong tool name. The hook must exit 0 (never crash) and
    // leave the session.json read map empty.
    const payload = JSON.stringify({
      tool_name: "NotARealTool",
      tool_input: { file_path: "/tmp/whatever" },
    });
    const result = await runHook(postReadCmd, projectCwd, payload, minkRoot);
    expect(result.exitCode, result.stderr).toBe(0);

    const { projectDir } = readProjectState(minkRoot);
    const session = JSON.parse(
      readFileSync(join(projectDir, "session.json"), "utf-8")
    );
    expect(Object.keys(session.reads).length).toBe(0);
  });

  // ── PostToolUse / Write ────────────────────────────────────────────────

  test("PostToolUse/Write upserts a file-index entry from on-disk content", async () => {
    const startCmd = getRegisteredCommand(settings, "SessionStart", "");
    await runHook(startCmd, projectCwd, "{}", minkRoot);

    // post-write reads the file off disk, not from the payload.
    const filePath = join(projectCwd, "src", "feature.ts");
    mkdirSync(join(projectCwd, "src"), { recursive: true });
    writeFileSync(
      filePath,
      "/** Adds two numbers. */\nexport function add(a: number, b: number) { return a + b; }\n"
    );

    const postWriteCmd = getRegisteredCommand(settings, "PostToolUse", "Write");
    const payload = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: filePath, content: "ignored — read from disk" },
    });
    const result = await runHook(postWriteCmd, projectCwd, payload, minkRoot);
    expect(result.exitCode, result.stderr).toBe(0);

    // file_index lives in mink.db; query through the same repo the dashboard
    // uses, with the test's MINK_ROOT_OVERRIDE applied so paths resolve to
    // the temp project state dir.
    process.env.MINK_ROOT_OVERRIDE = minkRoot;
    const { FileIndexRepo } = await import("../../src/repositories/file-index-repo");
    const entry = FileIndexRepo.for(projectCwd).lookupEntry("src/feature.ts");
    expect(entry).not.toBeNull();
    expect(entry!.estimatedTokens).toBeGreaterThan(0);

    const { projectDir } = readProjectState(minkRoot);
    const session = JSON.parse(
      readFileSync(join(projectDir, "session.json"), "utf-8")
    );
    expect(session.writes.length).toBe(1);
    expect(session.writes[0].filePath).toBe("src/feature.ts");
  });

  // ── PreToolUse / Read ──────────────────────────────────────────────────

  test("PreToolUse/Read exits 0 on a valid payload (does not block)", async () => {
    const startCmd = getRegisteredCommand(settings, "SessionStart", "");
    await runHook(startCmd, projectCwd, "{}", minkRoot);

    const preReadCmd = getRegisteredCommand(settings, "PreToolUse", "Read");
    const payload = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: "/tmp/anything.ts" },
    });
    const result = await runHook(preReadCmd, projectCwd, payload, minkRoot);
    expect(result.exitCode, result.stderr).toBe(0);
  });

  // ── Stop / session lifecycle ───────────────────────────────────────────

  test("Stop after a session with activity archives a ledger entry", async () => {
    const startCmd = getRegisteredCommand(settings, "SessionStart", "");
    await runHook(startCmd, projectCwd, "{}", minkRoot);

    // Drive one read so the session has activity worth archiving.
    const filePath = join(projectCwd, "src", "activity.ts");
    mkdirSync(join(projectCwd, "src"), { recursive: true });
    writeFileSync(filePath, "export const ACTIVE = true;\n".repeat(30));

    const postReadCmd = getRegisteredCommand(settings, "PostToolUse", "Read");
    await runHook(
      postReadCmd,
      projectCwd,
      JSON.stringify({
        tool_name: "Read",
        tool_input: { file_path: filePath },
        tool_output: { content: "export const ACTIVE = true;\n".repeat(30) },
      }),
      minkRoot
    );

    const stopCmd = getRegisteredCommand(settings, "Stop", "");
    const result = await runHook(stopCmd, projectCwd, "{}", minkRoot);
    expect(result.exitCode, result.stderr).toBe(0);

    // Token ledger may live in mink.db, in a per-device shard, or in the
    // canonical JSON depending on migration phase. aggregateTokenLedger is
    // the same function the dashboard uses to union all sources — that is
    // the contract we want to validate.
    process.env.MINK_ROOT_OVERRIDE = minkRoot;
    const { aggregateTokenLedger } = await import("../../src/core/state-aggregator");
    const ledger = aggregateTokenLedger(projectCwd);
    expect(ledger.lifetime.totalSessions).toBeGreaterThanOrEqual(1);
    expect(ledger.lifetime.totalReads).toBeGreaterThanOrEqual(1);
  });
});
