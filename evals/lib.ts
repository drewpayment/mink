// Pure(ish) logic for the mink-agent eval runner, split out of runner.ts so
// it can be imported and unit-tested (tests/unit/eval-runner-lib.test.ts)
// without executing the CLI's main() — runner.ts calls process.on(...) and
// main() at module scope, so importing it directly would launch a run.
//
// Everything here either takes its paths as parameters (no dependency on
// the real ~/.claude/agents) or has no I/O at all (grade/pathMatches).

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { createHash } from "crypto";

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Backup marker — see evals/README.md "Ctrl-C and crash safety"
// ---------------------------------------------------------------------------

export interface BackupMarker {
  existed: boolean;
  content: string | null;
  /** sha256 of the fixture-rendered content this marker's install wrote to
   * the installed-agent path. Restoring/deleting is only safe while the
   * file still hashes to this — see applyBackupMarker(). */
  installedHash: string;
}

export function writeBackupMarkerAt(backupPath: string, marker: BackupMarker): void {
  writeFileSync(backupPath, JSON.stringify(marker), "utf-8");
}

export function readBackupMarkerAt(backupPath: string): BackupMarker | null {
  if (!existsSync(backupPath)) return null;
  return JSON.parse(readFileSync(backupPath, "utf-8")) as BackupMarker;
}

export function clearBackupMarkerAt(backupPath: string): void {
  try {
    if (existsSync(backupPath)) unlinkSync(backupPath);
  } catch {
    // best-effort
  }
}

export type ApplyBackupOutcome = "restored" | "removed" | "skipped-mismatch";

/**
 * Applies (or safely declines to apply) a backup marker to `installedPath`.
 *
 * The naive version of this — always write marker.content back, or always
 * unlink when nothing existed before — is unsafe across a hard kill: if the
 * user notices their real mink-agent definition got clobbered and runs
 * `mink agent` again to reinstall a good one, a *later* eval invocation's
 * leftover-backup recovery would either overwrite that fresh reinstall with
 * stale backup content, or — when the marker recorded existed:false —
 * delete it outright.
 *
 * So this only restores/removes when the file currently at `installedPath`
 * still hashes to marker.installedHash, i.e. it's provably still *our*
 * stranded install and nothing has touched it since. If the hash doesn't
 * match (file changed, or was deleted — absence doesn't prove anything
 * either way), it leaves the current file exactly as-is, and discards the
 * marker — optionally saving it aside as `${backupPath}.stale` for manual
 * inspection, since at that point the marker can no longer be trusted to
 * describe what's there. Logging is left to the caller (via the returned
 * outcome) so this stays easy to unit test.
 */
export function applyBackupMarker(
  installedPath: string,
  backupPath: string,
  marker: BackupMarker,
  opts: { saveStaleAside: boolean }
): ApplyBackupOutcome {
  let currentHash: string | null = null;
  if (existsSync(installedPath)) {
    try {
      currentHash = sha256(readFileSync(installedPath, "utf-8"));
    } catch {
      currentHash = null;
    }
  }

  if (currentHash !== marker.installedHash) {
    if (opts.saveStaleAside) {
      try {
        writeFileSync(`${backupPath}.stale`, JSON.stringify(marker), "utf-8");
      } catch {
        // best-effort
      }
    }
    clearBackupMarkerAt(backupPath);
    return "skipped-mismatch";
  }

  if (marker.existed && marker.content !== null) {
    writeFileSync(installedPath, marker.content);
    clearBackupMarkerAt(backupPath);
    return "restored";
  }
  if (existsSync(installedPath)) {
    unlinkSync(installedPath);
  }
  clearBackupMarkerAt(backupPath);
  return "removed";
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

export type CaseCategory = "title-hit" | "body-hit" | "graph-hop" | "negative";

export interface EvalCase {
  id: string;
  category: CaseCategory;
  question: string;
  expected_paths: string[];
  expected_substrings: string[];
}

/**
 * True if `output` cites `expectedPath` (e.g. "projects/atlas-web/overview.md").
 * Matches the exact path with its `.md` suffix, but also the same,
 * directory-qualified path with the suffix dropped — that's how the path
 * shows up in wikilink form (`[[projects/atlas-web/overview|Atlas Web
 * Overview]]`) or in plain prose ("see projects/atlas-web/overview for
 * details"). The directory-qualified prefix is never dropped, so this stays
 * as discriminative as the exact-match version — it still can't be
 * satisfied by the bare, ambiguous basename alone. The extensionless match
 * requires a non-path-continuing character (or end of string) right after
 * it, so "projects/atlas-web/overview" doesn't spuriously match inside a
 * longer sibling path like "projects/atlas-web/overview-old.md".
 */
export function pathMatches(output: string, expectedPath: string): boolean {
  if (output.includes(expectedPath)) return true;
  if (!expectedPath.toLowerCase().endsWith(".md")) return false;
  const withoutExt = expectedPath.slice(0, -3);
  const re = new RegExp(`${escapeRegExp(withoutExt)}(?![A-Za-z0-9_-])`);
  return re.test(output);
}

/**
 * Non-negative cases require a PATH match to pass — an expected substring
 * alone is not sufficient. `claude -p` responses routinely echo nouns from
 * the question itself (e.g. asking about a "design system doc" gets back a
 * response containing the words "design system" whether or not it actually
 * found and cited projects/atlas-web/design-system.md), so substring-only
 * matching on a case whose expected_substrings overlap the question text is
 * not discriminative. Substrings are still checked and reported for
 * context, but only a cited path proves the note was actually retrieved.
 *
 * Negative cases have no expected_paths by construction (there's nothing to
 * cite) — they pass only on a not-found admission substring, which the
 * question text is designed not to contain.
 */
export function grade(kase: EvalCase, output: string): { pass: boolean; reason: string } {
  const haystack = output.toLowerCase();

  const pathHits = kase.expected_paths.filter((p) => pathMatches(output, p));
  const substringHits = kase.expected_substrings.filter((s) =>
    haystack.includes(s.toLowerCase())
  );

  if (kase.category === "negative") {
    const pass = substringHits.length > 0;
    return {
      pass,
      reason: pass
        ? `not-found admission matched: ${substringHits.join(", ")}`
        : "no not-found admission phrase found — response may be fabricating an answer",
    };
  }

  if (kase.expected_paths.length === 0) {
    // No path defined for this case — fall back to substring-only.
    const pass = substringHits.length > 0;
    return {
      pass,
      reason: pass ? `substring match: ${substringHits.join(", ")}` : "no expected substring found in output",
    };
  }

  const pass = pathHits.length > 0;
  const bits: string[] = [];
  if (pathHits.length) bits.push(`path match: ${pathHits.join(", ")}`);
  if (substringHits.length) bits.push(`substring match (supplementary): ${substringHits.join(", ")}`);
  return {
    pass,
    reason: pass
      ? bits.join("; ")
      : `no expected path cited in output${
          substringHits.length
            ? ` (substrings matched but a path citation is required: ${substringHits.join(", ")})`
            : ""
        }`,
  };
}
