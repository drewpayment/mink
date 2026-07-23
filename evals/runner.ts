#!/usr/bin/env bun
// Retrieval eval runner for the mink-agent definition.
//
// Runs the ~15 Q/A cases in evals/cases.json against the fixture vault in
// evals/fixtures/vault, via a real headless agent CLI (`claude -p --agent
// mink-agent`), and grades the transcript by substring/path match.
//
// This is a manual, opt-in dev tool — NOT part of `bun test` / CI. It
// requires the `claude` CLI on PATH and spends real tokens per run.
//
//   npm run eval:agent                  # run every case with the claude engine
//   npm run eval:agent -- --dry-run     # validate fixtures/cases, no CLI calls, no tokens
//   npm run eval:agent -- --case body-hit-rate-limiter-algorithm
//   npm run eval:agent -- --limit 3 --keep-tmp
//
// See evals/README.md for the full flag list and what "full pass" requires.

import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
} from "fs";
import { tmpdir, homedir } from "os";
import { join, dirname, resolve } from "path";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { ENGINES, isClaudeOnPath, type EngineContext } from "./engines";

// ---------------------------------------------------------------------------
// Paths / repo discovery
// ---------------------------------------------------------------------------

function findRepoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    if (
      existsSync(join(dir, "package.json")) &&
      existsSync(join(dir, "agents", "mink-agent.md.tmpl"))
    ) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: evals/ is always one level below the repo root.
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

const REPO_ROOT = findRepoRoot();
const FIXTURE_VAULT_SRC = join(REPO_ROOT, "evals", "fixtures", "vault");
const CASES_PATH = join(REPO_ROOT, "evals", "cases.json");
const TEMPLATE_PATH = join(REPO_ROOT, "agents", "mink-agent.md.tmpl");
const INSTALLED_AGENT_PATH = join(homedir(), ".claude", "agents", "mink-agent.md");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CaseCategory = "title-hit" | "body-hit" | "graph-hop" | "negative";

interface EvalCase {
  id: string;
  category: CaseCategory;
  question: string;
  expected_paths: string[];
  expected_substrings: string[];
}

interface CasesFile {
  description?: string;
  cases: EvalCase[];
}

interface CliOptions {
  engine: string;
  dryRun: boolean;
  noInstall: boolean;
  keepTmp: boolean;
  only: string[] | null;
  limit: number | null;
  timeoutMs: number;
}

interface CaseOutcome {
  id: string;
  category: CaseCategory;
  question: string;
  pass: boolean;
  reason: string;
  engineError?: string;
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    engine: "claude",
    dryRun: false,
    noInstall: false,
    keepTmp: false,
    only: null,
    limit: null,
    timeoutMs: 120_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--engine":
        opts.engine = argv[++i];
        break;
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--no-install":
        opts.noInstall = true;
        break;
      case "--keep-tmp":
        opts.keepTmp = true;
        break;
      case "--case":
        opts.only = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--limit":
        opts.limit = Number.parseInt(argv[++i] ?? "", 10) || null;
        break;
      case "--timeout":
        opts.timeoutMs = (Number.parseInt(argv[++i] ?? "", 10) || 120) * 1000;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`[mink eval] unrecognized flag: ${arg}`);
        printHelp();
        process.exit(1);
    }
  }
  return opts;
}

function printHelp(): void {
  console.log(`Usage: npm run eval:agent -- [options]

Options:
  --engine <name>    Engine adapter to use (default: claude). See evals/engines.ts.
  --dry-run          Validate fixtures/cases and render the agent template, but
                      don't call the CLI or spend tokens.
  --no-install       Don't (re)install the fixture-rendered mink-agent definition
                      to ~/.claude/agents/mink-agent.md — assumes it's already
                      installed and current.
  --case <id[,id2]>  Run only the named case id(s) from evals/cases.json.
  --limit <n>        Run only the first n cases (after --case filtering).
  --timeout <sec>    Per-case timeout in seconds (default: 120).
  --keep-tmp         Don't delete the temp fixture instance after the run.
`);
}

// ---------------------------------------------------------------------------
// Fixture instance (isolated copy — never touches the real ~/.mink)
// ---------------------------------------------------------------------------

interface FixtureInstance {
  minkRoot: string;
  vaultPath: string;
  cleanup(): void;
}

function prepareFixtureInstance(keepTmp: boolean): FixtureInstance {
  const base = mkdtempSync(join(tmpdir(), "mink-agent-eval-"));
  const minkRoot = join(base, "mink-root");
  const vaultPath = join(base, "vault");
  mkdirSync(minkRoot, { recursive: true });
  cpSync(FIXTURE_VAULT_SRC, vaultPath, { recursive: true });
  return {
    minkRoot,
    vaultPath,
    cleanup() {
      if (keepTmp) {
        console.log(`[mink eval] leaving fixture instance at ${base}`);
        return;
      }
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    },
  };
}

// ---------------------------------------------------------------------------
// mink-agent definition install (backed up + restored around the run)
// ---------------------------------------------------------------------------

function renderTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

function getMinkVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

interface AgentInstall {
  restore(): void;
}

/**
 * Installs the repo's current agents/mink-agent.md.tmpl — rendered against
 * the *fixture* vault/root — to the real ~/.claude/agents/mink-agent.md, so
 * `claude -p --agent mink-agent` picks up exactly the prompt under test.
 *
 * Any pre-existing installed definition is backed up in memory and restored
 * when the run finishes (success, failure, or Ctrl-C), so this never leaves
 * the user's real installed agent definition clobbered.
 */
function installFixtureAgent(fixture: FixtureInstance): AgentInstall {
  const template = readFileSync(TEMPLATE_PATH, "utf-8");
  const rendered = renderTemplate(template, {
    MINK_ROOT: fixture.minkRoot,
    VAULT_PATH: fixture.vaultPath,
    MINK_VERSION: getMinkVersion(),
  });

  const dir = dirname(INSTALLED_AGENT_PATH);
  mkdirSync(dir, { recursive: true });

  const existed = existsSync(INSTALLED_AGENT_PATH);
  const backup = existed ? readFileSync(INSTALLED_AGENT_PATH, "utf-8") : null;

  writeFileSync(INSTALLED_AGENT_PATH, rendered);

  return {
    restore() {
      try {
        if (backup !== null) {
          writeFileSync(INSTALLED_AGENT_PATH, backup);
        } else if (existsSync(INSTALLED_AGENT_PATH)) {
          unlinkSync(INSTALLED_AGENT_PATH);
        }
      } catch (err) {
        console.error(
          `[mink eval] warning: failed to restore ${INSTALLED_AGENT_PATH}: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    },
  };
}

/** Best-effort: refresh the vault index so `.mink-index.json`-backed
 * commands (wiki status, note list) see the fixture notes. Non-fatal if
 * `mink` isn't on PATH or the subcommand fails — recall/backlinks/related
 * don't exist pre-phase-1 anyway, so this is just for realism. */
function tryRebuildIndex(env: NodeJS.ProcessEnv, cwd: string): void {
  try {
    spawnSync("mink", ["wiki", "rebuild-index"], {
      cwd,
      env,
      stdio: "ignore",
      timeout: 30_000,
    });
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

function grade(kase: EvalCase, output: string): { pass: boolean; reason: string } {
  const haystack = output.toLowerCase();

  const pathHits = kase.expected_paths.filter((p) => output.includes(p));
  const substringHits = kase.expected_substrings.filter((s) =>
    haystack.includes(s.toLowerCase())
  );

  const pass = pathHits.length > 0 || substringHits.length > 0;

  if (pass) {
    const bits: string[] = [];
    if (pathHits.length) bits.push(`path match: ${pathHits.join(", ")}`);
    if (substringHits.length) bits.push(`substring match: ${substringHits.join(", ")}`);
    return { pass: true, reason: bits.join("; ") };
  }
  return {
    pass: false,
    reason:
      kase.category === "negative"
        ? "no not-found admission phrase found — response may be fabricating an answer"
        : "no expected path or substring found in output",
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadCases(): EvalCase[] {
  const raw = JSON.parse(readFileSync(CASES_PATH, "utf-8")) as CasesFile;
  return raw.cases;
}

function selectCases(all: EvalCase[], opts: CliOptions): EvalCase[] {
  let selected = all;
  if (opts.only) {
    const wanted = new Set(opts.only);
    selected = selected.filter((c) => wanted.has(c.id));
  }
  if (opts.limit) {
    selected = selected.slice(0, opts.limit);
  }
  return selected;
}

function printScorecard(outcomes: CaseOutcome[]): boolean {
  console.log();
  console.log("mink-agent retrieval eval — scorecard");
  console.log("=".repeat(60));

  const byCategory = new Map<CaseCategory, CaseOutcome[]>();
  for (const o of outcomes) {
    if (!byCategory.has(o.category)) byCategory.set(o.category, []);
    byCategory.get(o.category)!.push(o);
  }

  for (const [category, list] of byCategory) {
    const passed = list.filter((o) => o.pass).length;
    console.log(`\n${category} (${passed}/${list.length})`);
    for (const o of list) {
      const mark = o.pass ? "PASS" : "FAIL";
      console.log(`  [${mark}] ${o.id} — ${o.question}`);
      if (!o.pass) {
        console.log(`         ${o.reason}`);
        if (o.engineError) console.log(`         engine error: ${o.engineError}`);
      }
    }
  }

  const total = outcomes.length;
  const totalPassed = outcomes.filter((o) => o.pass).length;
  console.log();
  console.log("-".repeat(60));
  console.log(`Total: ${totalPassed}/${total} passed`);
  console.log("=".repeat(60));
  return totalPassed === total;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (!(opts.engine in ENGINES)) {
    console.error(
      `[mink eval] unknown engine "${opts.engine}" — available: ${Object.keys(ENGINES).join(", ")}`
    );
    process.exit(1);
  }

  const allCases = loadCases();
  const cases = selectCases(allCases, opts);
  if (cases.length === 0) {
    console.error("[mink eval] no cases matched the given filters");
    process.exit(1);
  }

  console.log(`[mink eval] repo root: ${REPO_ROOT}`);
  console.log(`[mink eval] engine: ${opts.engine}`);
  console.log(`[mink eval] cases: ${cases.length}/${allCases.length}`);

  const fixture = prepareFixtureInstance(opts.keepTmp);
  console.log(`[mink eval] fixture mink root: ${fixture.minkRoot}`);
  console.log(`[mink eval] fixture vault: ${fixture.vaultPath}`);

  if (opts.dryRun) {
    // Validate the template renders and the fixture/cases are well-formed,
    // without touching ~/.claude/agents or spending any tokens.
    const template = readFileSync(TEMPLATE_PATH, "utf-8");
    const rendered = renderTemplate(template, {
      MINK_ROOT: fixture.minkRoot,
      VAULT_PATH: fixture.vaultPath,
      MINK_VERSION: getMinkVersion(),
    });
    const unresolved = rendered.match(/\{\{[A-Z_]+\}\}/g);
    if (unresolved) {
      console.error(`[mink eval] dry-run FAILED: unresolved template vars: ${unresolved.join(", ")}`);
      fixture.cleanup();
      process.exit(1);
    }
    console.log(`[mink eval] dry-run OK: template renders cleanly (${rendered.length} chars).`);
    for (const c of cases) {
      console.log(`  - [${c.category}] ${c.id}: ${c.question}`);
    }
    fixture.cleanup();
    console.log("[mink eval] dry-run complete — no CLI calls made, no tokens spent.");
    return;
  }

  if (!isClaudeOnPath() && opts.engine === "claude") {
    console.error("[mink eval] `claude` CLI not found on PATH — required for the claude engine.");
    console.error("  Install Claude Code: https://claude.com/claude-code");
    fixture.cleanup();
    process.exit(1);
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    MINK_ROOT_OVERRIDE: fixture.minkRoot,
    MINK_WIKI_PATH: fixture.vaultPath,
  };

  tryRebuildIndex(env, fixture.minkRoot);

  const install = opts.noInstall ? null : installFixtureAgent(fixture);
  if (install) {
    console.log(`[mink eval] installed fixture-rendered mink-agent -> ${INSTALLED_AGENT_PATH}`);
  } else {
    console.log("[mink eval] --no-install: assuming mink-agent is already installed and current");
  }

  const outcomes: CaseOutcome[] = [];
  try {
    const engineFn = ENGINES[opts.engine];
    const ctx: EngineContext = { cwd: fixture.minkRoot, env, timeoutMs: opts.timeoutMs };

    for (const kase of cases) {
      process.stdout.write(`[mink eval] running ${kase.id}... `);
      const result = engineFn(kase.question, ctx);
      if (!result.ok) {
        console.log("ENGINE ERROR");
        outcomes.push({
          id: kase.id,
          category: kase.category,
          question: kase.question,
          pass: false,
          reason: "engine call failed",
          engineError: result.error,
        });
        continue;
      }
      const { pass, reason } = grade(kase, result.output);
      console.log(pass ? "pass" : "fail");
      outcomes.push({ id: kase.id, category: kase.category, question: kase.question, pass, reason });
    }
  } finally {
    if (install) install.restore();
    fixture.cleanup();
  }

  const allPassed = printScorecard(outcomes);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("[mink eval] fatal:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
