import { isVaultInitialized, isWikiEnabled } from "../core/vault";
import { recall as recallQuery, recallCandidates, DEFAULT_POOL_SIZE, DEFAULT_NEIGHBOUR_CAP } from "../core/wiki-search";
import { resolveConfigValue } from "../core/global-config";
import type { RecallResult } from "../repositories/wiki-search-repo";
import type { RetrievalSummary } from "../core/rerank";

const USAGE =
  'Usage: mink recall "<query>" [--json] [--wide] [--rerank|--no-rerank] [--min-relevance P] [--limit N] [--project <slug>] [--tag <tag>] [--category <cat>] [--since <ISO date>]';

export interface ParsedRecallArgs {
  query: string;
  json: boolean;
  wide: boolean;
  /** true = --rerank, false = --no-rerank, undefined = follow config. */
  rerank?: boolean;
  minRelevance?: number;
  limit: number;
  project?: string;
  tag?: string;
  category?: string;
  since?: string;
}

// Exported for unit testing. Options are recognized wherever they appear in
// argv — the agent template/skills invoke this as
// `mink recall --json "<query>"` (flags before the positional query), so
// this must not assume flags come after the query.
export function parseRecallArgs(args: string[]): ParsedRecallArgs {
  const result: ParsedRecallArgs = { query: "", json: false, wide: false, limit: 10 };
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--json") {
      result.json = true;
    } else if (arg === "--wide") {
      result.wide = true;
    } else if (arg === "--rerank") {
      result.rerank = true;
    } else if (arg === "--no-rerank") {
      result.rerank = false;
    } else if (arg === "--min-relevance" && i + 1 < args.length) {
      const p = Number(args[++i]);
      if (Number.isFinite(p) && p >= 0 && p <= 1) result.minRelevance = p;
    } else if (arg === "--limit" && i + 1 < args.length) {
      result.limit = parseInt(args[++i], 10) || 10;
    } else if (arg === "--project" && i + 1 < args.length) {
      result.project = args[++i];
    } else if (arg === "--tag" && i + 1 < args.length) {
      result.tag = args[++i];
    } else if (arg === "--category" && i + 1 < args.length) {
      result.category = args[++i];
    } else if (arg === "--since" && i + 1 < args.length) {
      result.since = args[++i];
    } else if (!arg.startsWith("--")) {
      positional.push(arg);
    }
    i++;
  }
  result.query = positional.join(" ");
  return result;
}

// `mink recall` — BM25-ranked full-text search over note bodies, titles,
// aliases and tags (see wiki-search.ts / wiki-search-repo.ts). Exits 0 with
// an empty results array/list on no matches, by design: agents call this
// in a loop while researching and a miss is a normal outcome, not an error.
export async function recall(_cwd: string, args: string[]): Promise<void> {
  if (!isWikiEnabled()) {
    console.error("[mink] wiki feature is disabled");
    console.error("  Enable with: mink config wiki.enabled true");
    process.exit(1);
  }

  if (!isVaultInitialized()) {
    console.error("[mink] vault not initialized");
    console.error("  Run 'mink wiki init' first.");
    process.exit(1);
  }

  const parsed = parseRecallArgs(args);
  if (!parsed.query.trim()) {
    console.error(USAGE);
    process.exit(1);
  }

  // Judge mode: --rerank forces it on, --no-rerank forces it off, otherwise
  // recall.rerank=jev in config turns it on.
  const judgeMode = parsed.rerank ?? resolveConfigValue("recall.rerank").value.trim().toLowerCase() === "jev";

  // core/wiki-search.ts's recall() already retries once through a delete
  // + rebuild on a thrown (e.g. corrupted-index) error. If it still throws
  // after that, print the clean message it constructed instead of letting
  // an uncaught exception dump a raw stack trace.
  let results: RecallResult[];
  let candidateCount = 0;
  let judgeSummary: RetrievalSummary | null = null;
  let minRelevance = parsed.minRelevance ?? 0.7;
  try {
    const opts = {
      limit: parsed.limit,
      project: parsed.project,
      tag: parsed.tag,
      category: parsed.category,
      since: parsed.since,
    };
    if (judgeMode) {
      // Dynamic import: the judge must stay out of every static import graph
      // a lifecycle hook can reach.
      const ranked = await import("../core/recall-ranked");
      const settings = ranked.resolveRerankSettings();
      minRelevance = parsed.minRelevance ?? settings.minRelevance;
      const out = await ranked.recallRanked(parsed.query, opts, {
        mode: "judge",
        settings,
        minRelevance: parsed.minRelevance,
      });
      results = out.results;
      candidateCount = out.summary.candidates;
      judgeSummary = out.summary;
      if (out.summary.warning) console.error(`[mink] ${out.summary.warning}`);
      if (out.summary.fallback_reason === "no_credential" && parsed.rerank === true) {
        console.error(
          "[mink] --rerank needs an API key; using wide ordering. Set recall.rerank-api-key (or MINK_RECALL_RERANK_API_KEY / JEV_API_KEY)."
        );
      }
    } else if (parsed.wide) {
      // The full pool comes back (lexical first, then graph neighbours);
      // truncating to --limit here means neighbours only show when there is
      // room after the lexical hits.
      const pool = recallCandidates(parsed.query, opts, {
        poolSize: Math.max(DEFAULT_POOL_SIZE, parsed.limit),
        neighbourCap: DEFAULT_NEIGHBOUR_CAP,
      });
      candidateCount = pool.length;
      results = pool.slice(0, parsed.limit);
    } else {
      results = recallQuery(parsed.query, opts);
      candidateCount = results.length;
    }
  } catch (err) {
    console.error(`[mink] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  if (parsed.json) {
    const retrieval = judgeSummary
      ? {
          ranker: judgeSummary.ranker,
          candidates: judgeSummary.candidates,
          judged: judgeSummary.judged,
          empty_reason: judgeSummary.empty_reason,
          fallback_reason: judgeSummary.fallback_reason,
          judge_model: judgeSummary.judge_model,
          input_tokens: judgeSummary.input_tokens,
          cache_hits: judgeSummary.cache_hits,
        }
      : {
          ranker: parsed.wide ? "wide" : "lexical",
          candidates: candidateCount,
          judged: 0,
          empty_reason: results.length === 0 ? "lexical" : null,
          fallback_reason: null,
          judge_model: null,
        };
    console.log(JSON.stringify({ query: parsed.query, results, retrieval }, null, 2));
    return;
  }

  if (judgeSummary?.empty_reason === "judged") {
    console.log(
      `[mink] no relevant notes for "${parsed.query}" (${judgeSummary.judged} candidates judged, none ≥ ${minRelevance.toFixed(2)})`
    );
    return;
  }

  if (results.length === 0) {
    console.log(`[mink] no results for "${parsed.query}"`);
    return;
  }

  console.log(`[mink] ${results.length} result${results.length === 1 ? "" : "s"} for "${parsed.query}":`);
  if (judgeSummary?.fallback_reason) {
    const dim = process.stdout.isTTY ? ["\x1b[2m", "\x1b[0m"] : ["", ""];
    console.log(`${dim[0]}reranking not applied (${judgeSummary.fallback_reason}); showing lexical ordering${dim[1]}`);
  }
  console.log();
  for (const r of results) {
    const tags = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
    console.log(`  ${r.title}${tags}`);
    console.log(`    ${r.path}`);
    if (typeof r.relevance === "number") console.log(`    relevance ${r.relevance.toFixed(2)}`);
    if (r.origin === "graph") console.log("    ↳ linked from top results");
    if (r.snippet) console.log(`    ${r.snippet}`);
    console.log();
  }
}
