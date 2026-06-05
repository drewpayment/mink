import { BugMemoryRepo } from "../repositories/bug-memory-repo";

export function bugSearch(cwd: string, query: string): void {
  if (!query) {
    console.error("Usage: mink bug search <query>");
    process.exit(1);
  }

  const results = BugMemoryRepo.for(cwd).searchBugs(query);

  if (results.length === 0) {
    console.log("No matching bugs found.");
    return;
  }

  for (const match of results) {
    const e = match.entry;
    console.log(
      `${e.id} (score: ${match.score.toFixed(2)}) — ${e.errorMessage}`
    );
    console.log(
      `  File: ${e.filePath}${e.lineNumber ? `:${e.lineNumber}` : ""}`
    );
    console.log(`  Root cause: ${e.rootCause}`);
    console.log(`  Fix: ${e.fixDescription}`);
    if (e.tags.length > 0) console.log(`  Tags: ${e.tags.join(", ")}`);
    if (e.occurrenceCount > 1) console.log(`  Seen ${e.occurrenceCount} times`);
    console.log();
  }
}
