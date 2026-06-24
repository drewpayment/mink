// `mink retrieve <token>` — return the byte-exact original of a previously
// compressed tool output (spec 22 §Reversibility). Prints the original to
// stdout on a hit; on a miss (unknown or expired token) it prints a short,
// non-fatal notice to stderr and exits 0 so the assistant is never stranded by
// an error.

import { CompressionCacheRepo } from "../repositories/compression-cache-repo";

export function retrieve(cwd: string, args: string[]): void {
  const token = args[0];
  if (!token) {
    process.stderr.write("[mink] usage: mink retrieve <token>\n");
    return;
  }

  let entry = null;
  try {
    entry = CompressionCacheRepo.for(cwd).get(token);
  } catch {
    // Treat any storage error as a miss — never throw at the assistant.
    entry = null;
  }

  if (!entry) {
    process.stderr.write(
      `[mink] no retrievable output for token "${token}" (unknown or expired)\n`
    );
    return;
  }

  process.stdout.write(entry.content);
}
