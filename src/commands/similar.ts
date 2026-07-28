// `mink similar` — recall prior sessions similar to the task at hand (spec 29).

import { findSimilarTasks, formatSimilarTasks } from "../core/similar-tasks";

const USAGE = `mink similar — find prior sessions similar to the current task (spec 29)

Usage:
  mink similar --files=a.ts,b.ts     Rank prior sessions by file overlap
  mink similar <query words>         Match a description against prior file paths
  mink similar --files=a.ts refactor Combine both`;

export function similar(cwd: string, args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return;
  }
  const filesArg = args.find((a) => a.startsWith("--files="));
  const files = filesArg
    ? filesArg.slice("--files=".length).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const query = args.filter((a) => !a.startsWith("--")).join(" ").trim() || undefined;

  if ((!files || files.length === 0) && !query) {
    process.stderr.write("[mink] provide --files=... and/or a query\n");
    process.exit(1);
  }
  process.stdout.write(formatSimilarTasks(findSimilarTasks(cwd, { files, query })) + "\n");
}
