import { isVaultInitialized, isWikiEnabled } from "../core/vault";
import { recall as recallQuery } from "../core/wiki-search";

const USAGE =
  'Usage: mink recall "<query>" [--json] [--limit N] [--project <slug>] [--tag <tag>] [--category <cat>] [--since <ISO date>]';

export interface ParsedRecallArgs {
  query: string;
  json: boolean;
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
  const result: ParsedRecallArgs = { query: "", json: false, limit: 10 };
  const positional: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--json") {
      result.json = true;
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

  const results = recallQuery(parsed.query, {
    limit: parsed.limit,
    project: parsed.project,
    tag: parsed.tag,
    category: parsed.category,
    since: parsed.since,
  });

  if (parsed.json) {
    console.log(JSON.stringify({ query: parsed.query, results }, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`[mink] no results for "${parsed.query}"`);
    return;
  }

  console.log(`[mink] ${results.length} result${results.length === 1 ? "" : "s"} for "${parsed.query}":`);
  console.log();
  for (const r of results) {
    const tags = r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : "";
    console.log(`  ${r.title}${tags}`);
    console.log(`    ${r.path}`);
    if (r.snippet) console.log(`    ${r.snippet}`);
    console.log();
  }
}
