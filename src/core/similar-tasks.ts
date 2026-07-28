// Similar-task recall (spec 29). The session history is append-only; this makes
// it queryable. Given the files a task is about to touch (or a free-text query),
// rank prior sessions by file overlap so the assistant can reuse the approach it
// took last time — "you did something like this in session X."
//
// The similarity signal is deterministic file overlap (Jaccard). Semantic
// ranking over session descriptions is a future enhancement layered on spec 25.

import { TokenLedgerRepo } from "../repositories/token-ledger-repo";
import type { LedgerSession } from "../types/token-ledger";

export interface SimilarTask {
  sessionId: string;
  startTimestamp: string;
  score: number;
  sharedFiles: string[];
  totalFiles: number;
}

export interface SimilarTaskOptions {
  /** Files the current task touches — ranked by Jaccard overlap (preferred). */
  files?: string[];
  /** Free-text query — matched as keywords against prior sessions' file paths. */
  query?: string;
  limit?: number;
  /** Exclude a session (e.g. the current one) from the results. */
  excludeSessionId?: string;
}

/** The set of files a session touched (reads ∪ writes). */
export function sessionFiles(s: LedgerSession): Set<string> {
  const set = new Set<string>();
  for (const r of s.reads) set.add(r.filePath);
  for (const w of s.writes) set.add(w.filePath);
  return set;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/**
 * Rank prior sessions by similarity to the given files (Jaccard) or query
 * (keyword overlap against file paths). Returns the top matches, most similar
 * first, with a deterministic tie-break (newer session, then id).
 */
export function findSimilarTasks(cwd: string, opts: SimilarTaskOptions = {}): SimilarTask[] {
  const repo = TokenLedgerRepo.for(cwd);
  const sessions = [...repo.archivedSessions(), ...repo.activeSessions()];

  const queryFiles = new Set((opts.files ?? []).filter((f) => f && f.length > 0));
  const tokens = opts.query ? tokenize(opts.query) : [];
  const limit = opts.limit ?? 5;

  const out: SimilarTask[] = [];
  for (const s of sessions) {
    if (opts.excludeSessionId && s.sessionId === opts.excludeSessionId) continue;
    const files = sessionFiles(s);
    if (files.size === 0) continue;

    let score = 0;
    let shared: string[] = [];
    if (queryFiles.size > 0) {
      shared = [...files].filter((f) => queryFiles.has(f));
      score = jaccard(queryFiles, files);
    } else if (tokens.length > 0) {
      shared = [...files].filter((f) => {
        const lf = f.toLowerCase();
        return tokens.some((t) => lf.includes(t));
      });
      score = shared.length / files.size;
    }

    if (score > 0) {
      out.push({
        sessionId: s.sessionId,
        startTimestamp: s.startTimestamp,
        score,
        sharedFiles: shared.sort(),
        totalFiles: files.size,
      });
    }
  }

  out.sort(
    (a, b) =>
      b.score - a.score ||
      (a.startTimestamp < b.startTimestamp ? 1 : a.startTimestamp > b.startTimestamp ? -1 : 0) ||
      (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0)
  );
  return out.slice(0, limit);
}

export function formatSimilarTasks(tasks: SimilarTask[]): string {
  if (tasks.length === 0) return "No similar prior tasks found.";
  const lines = [`Found ${tasks.length} similar prior task(s):`, ""];
  tasks.forEach((t, i) => {
    const files = t.sharedFiles.slice(0, 8).join(", ") + (t.sharedFiles.length > 8 ? ", …" : "");
    lines.push(
      `${i + 1}. session ${t.sessionId} (${t.startTimestamp}) — ${(t.score * 100).toFixed(0)}% overlap`,
      `   shared files: ${files || "(keyword match)"}`
    );
  });
  return lines.join("\n");
}
