// Retrieval-level eval: scores `mink recall` (and future arms) against the
// fixture vault, with no agent, network or API key involved. See
// evals/README.md "Retrieval-level eval".
//
//   bun evals/retrieval.ts [--arms strict,wide,judge] [--json] [--verbose] [--limit 10]
//
// It is a scoreboard, not a gate: exit 0 even when cases miss; non-zero only
// on harness errors.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import {
  buildArmReport,
  parseArmsFlag,
  renderScorecard,
  runArm,
  selectArms,
  type RankedResult,
  type RetrievalArm,
  type RetrievalCase,
  type RetrievalReport,
} from "./retrieval-lib";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_VAULT = join(HERE, "fixtures", "vault");
export const CASES_PATH = join(HERE, "cases.json");

export function loadRetrievalCases(path = CASES_PATH): RetrievalCase[] {
  return (JSON.parse(readFileSync(path, "utf-8")) as { cases: RetrievalCase[] }).cases;
}

export interface FixtureEnv {
  minkRoot: string;
  vaultPath: string;
  indexed: number;
  cleanup(): void;
}

/**
 * Copies the fixture vault into a fresh temp dir, points MINK_ROOT_OVERRIDE
 * and MINK_WIKI_PATH at it, and builds the FTS index. src modules are
 * imported dynamically *after* the env is set. cleanup() restores the env,
 * closes the index DB and removes the temp dir; it is idempotent.
 */
export async function setupFixtureVault(): Promise<FixtureEnv> {
  const minkRoot = mkdtempSync(join(tmpdir(), "mink-retrieval-eval-"));
  const vaultPath = join(minkRoot, "wiki");
  const saved = {
    root: process.env.MINK_ROOT_OVERRIDE,
    wiki: process.env.MINK_WIKI_PATH,
  };
  let done = false;
  let dbMod: typeof import("../src/storage/wiki-search-db") | null = null;
  const restoreEnv = () => {
    if (saved.root === undefined) delete process.env.MINK_ROOT_OVERRIDE;
    else process.env.MINK_ROOT_OVERRIDE = saved.root;
    if (saved.wiki === undefined) delete process.env.MINK_WIKI_PATH;
    else process.env.MINK_WIKI_PATH = saved.wiki;
  };
  try {
    cpSync(FIXTURE_VAULT, vaultPath, { recursive: true });
    process.env.MINK_ROOT_OVERRIDE = minkRoot;
    process.env.MINK_WIKI_PATH = vaultPath;

    const vault = await import("../src/core/vault");
    if (resolve(vault.resolveVaultPath()) !== resolve(vaultPath)) {
      throw new Error(`vault path did not resolve to the temp fixture (got ${vault.resolveVaultPath()})`);
    }
    const search = await import("../src/core/wiki-search");
    dbMod = await import("../src/storage/wiki-search-db");
    const { indexed } = search.reindexVault();
    return {
      minkRoot,
      vaultPath,
      indexed,
      cleanup() {
        if (done) return;
        done = true;
        try {
          dbMod?._resetWikiSearchDbForTests();
        } catch {
          // best-effort
        }
        restoreEnv();
        try {
          rmSync(minkRoot, { recursive: true, force: true });
        } catch {
          // best-effort
        }
      },
    };
  } catch (err) {
    restoreEnv();
    rmSync(minkRoot, { recursive: true, force: true });
    throw err;
  }
}

/** Arm 0: today's recall() (AND-joined BM25, substring fallback). */
export function strictArm(): RetrievalArm {
  return {
    name: "strict",
    available: () => true,
    async run(query, limit): Promise<RankedResult[]> {
      const { recall } = await import("../src/core/wiki-search");
      return recall(query, { limit }).map((r) => ({ path: r.path, score: r.score }));
    },
  };
}

/**
 * Arm 1: recallCandidates() — any-term FTS plus one-hop graph neighbours.
 * Returns the FULL candidate pool (lexical then graph), not truncated to
 * `limit`, so the scorecard can measure pool recall (hit@pool) and cost
 * (pool size). hit@k / MRR are still computed on the pool's order.
 */
export function wideArm(): RetrievalArm {
  return {
    name: "wide",
    available: () => true,
    async run(query): Promise<RankedResult[]> {
      const { recallCandidates, DEFAULT_POOL_SIZE, DEFAULT_NEIGHBOUR_CAP } = await import("../src/core/wiki-search");
      return recallCandidates(query, {}, { poolSize: DEFAULT_POOL_SIZE, neighbourCap: DEFAULT_NEIGHBOUR_CAP }).map(
        (r) => ({ path: r.path, score: r.score })
      );
    },
  };
}

function stubArm(name: string, blurb: string): RetrievalArm {
  return {
    name,
    available: () => `not yet implemented (${blurb})`,
    async run() {
      throw new Error(`${name} arm is not implemented`);
    },
  };
}

export function registeredArms(): RetrievalArm[] {
  return [
    strictArm(),
    wideArm(),
    stubArm("judge", "external relevance reranker"),
  ];
}

interface CliOptions {
  arms: string[] | null;
  json: boolean;
  verbose: boolean;
  limit: number;
}

export function parseCli(argv: string[]): CliOptions {
  const o: CliOptions = { arms: null, json: false, verbose: false, limit: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") o.json = true;
    else if (a === "--verbose") o.verbose = true;
    else if (a === "--arms") o.arms = parseArmsFlag(argv[++i] ?? "");
    else if (a.startsWith("--arms=")) o.arms = parseArmsFlag(a.slice(7));
    else if (a === "--limit") o.limit = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!Number.isInteger(o.limit) || o.limit < 1) throw new Error("--limit must be a positive integer");
  return o;
}

export async function runRetrievalEval(opts: CliOptions, arms = registeredArms()): Promise<RetrievalReport> {
  const cases = loadRetrievalCases();
  const { active, skipped } = selectArms(arms, opts.arms);
  const adversarial = new Set(cases.filter((c) => (c.adversarial_paths ?? []).length > 0).map((c) => c.id));
  const report: RetrievalReport = { limit: opts.limit, caseCount: cases.length, arms: [], skipped };
  if (active.length === 0) return report;

  const fixture = await setupFixtureVault();
  try {
    for (const arm of active) {
      const results = await runArm(arm, cases, opts.limit);
      report.arms.push(buildArmReport(arm.name, results, adversarial));
    }
  } finally {
    fixture.cleanup();
  }
  return report;
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2));
  if (!existsSync(FIXTURE_VAULT)) throw new Error(`fixture vault missing: ${FIXTURE_VAULT}`);
  const report = await runRetrievalEval(opts);
  if (opts.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderScorecard(report, opts.verbose));
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`[retrieval eval] ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
    process.exit(1);
  });
}
