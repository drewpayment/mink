// `mink context` — print the project's context pack (spec 26): a deterministic,
// cache-anchored prefix (learned rules + recurring bugs + file skeleton) an
// assistant can load once and reuse across turns.

import { buildContextPack } from "../core/context-pack";

const USAGE = `mink context — print this project's cache-friendly context pack (spec 26)

Assembles a deterministic prefix (learned rules + recurring bugs + file-index
skeleton) bounded by a token budget. Volatile fields sit below a footer marker
so the prefix above it is byte-identical for fixed state (prompt-cache friendly).

Usage: mink context [--budget=N]
  --budget=N   Token budget for the pack (default: context.budget-tokens or 2000)`;

export function context(cwd: string, args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return;
  }
  const budgetArg = args.find((a) => a.startsWith("--budget="));
  const budgetTokens = budgetArg ? Number(budgetArg.split("=")[1]) : undefined;
  if (budgetArg && (!budgetTokens || budgetTokens <= 0)) {
    process.stderr.write("[mink] --budget must be a positive number\n");
    process.exit(1);
  }
  process.stdout.write(buildContextPack(cwd, budgetTokens ? { budgetTokens } : {}));
}
