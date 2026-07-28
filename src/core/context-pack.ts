// Context pack (spec 26). Assembles one deterministic, prompt-cache-anchored
// context prefix per project — learned rules + top relevant bugs + a file-index
// skeleton — that an assistant can load once and reuse across turns. Front-loads
// the right context instead of paying to re-read files each session.
//
// Cache stability is the whole point: the stable, high-signal content is ordered
// deterministically at the top, and every volatile field (timestamp, counts)
// lives below a footer marker. For fixed project state the prefix above the
// marker is byte-identical across calls, so a client-side prompt cache hits.

import { BugMemoryRepo } from "../repositories/bug-memory-repo";
import { FileIndexRepo } from "../repositories/file-index-repo";
import { aggregateLearningMemory } from "./state-aggregator";
import { totalEntryCount } from "./learning-memory";
import type { SectionName } from "../types/learning-memory";
import type { BugEntry } from "../types/bug-memory";
import { countTokens } from "./token-estimate";
import { resolveConfigValue } from "./global-config";
import { projectIdFor } from "./project-id";

export const VOLATILE_MARKER = "<!-- mink:volatile (below this line is excluded from the cache prefix) -->";

const DEFAULT_BUDGET_TOKENS = 2000;
const SECTION_ORDER: SectionName[] = [
  "User Preferences",
  "Key Learnings",
  "Do-Not-Repeat",
  "Decision Log",
];

export interface ContextPackOptions {
  budgetTokens?: number;
  now?: Date;
}

/** Deterministic bug ranking: most-recurring first, then most-recent, then id. */
function rankBugs(bugs: BugEntry[]): BugEntry[] {
  return [...bugs].sort(
    (a, b) =>
      b.occurrenceCount - a.occurrenceCount ||
      (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function resolveBudget(opts: ContextPackOptions): number {
  if (opts.budgetTokens && opts.budgetTokens > 0) return opts.budgetTokens;
  const configured = Number(resolveConfigValue("context.budget-tokens").value);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_BUDGET_TOKENS;
}

/**
 * Build the context pack for a project. The returned string has a cache-stable
 * prefix followed by VOLATILE_MARKER and volatile aggregates.
 */
export function buildContextPack(cwd: string, opts: ContextPackOptions = {}): string {
  const budget = resolveBudget(opts);

  const memory = aggregateLearningMemory(cwd);
  const bugs = rankBugs(BugMemoryRepo.for(cwd).listAll());
  const files = [...FileIndexRepo.for(cwd).listAll()].sort((a, b) =>
    a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0
  );

  const lines: string[] = [];
  let used = 0;
  // Add a block only if it fits the remaining budget; the header is always kept.
  const add = (block: string[], { force = false } = {}): boolean => {
    const text = block.join("\n");
    const cost = countTokens(text);
    if (!force && used + cost > budget) return false;
    lines.push(...block);
    used += cost;
    return true;
  };

  add(
    [
      `# Mink context pack — project ${projectIdFor(cwd)}`,
      "",
      "Stable, high-signal context for this project. Load once; reuse across turns.",
      "",
    ],
    { force: true }
  );

  // ── Rules (small, highest signal) ────────────────────────────────────────
  if (totalEntryCount(memory) > 0) {
    const block: string[] = ["## Learned rules", ""];
    for (const section of SECTION_ORDER) {
      const entries = memory.sections[section] ?? [];
      if (entries.length === 0) continue;
      block.push(`### ${section}`);
      for (const e of entries) block.push(`- ${e}`);
      block.push("");
    }
    add(block);
  }

  // ── Top relevant bugs ────────────────────────────────────────────────────
  if (bugs.length > 0) {
    add(["## Recurring bugs", ""]);
    for (const b of bugs) {
      const where = b.lineNumber ? `${b.filePath}:${b.lineNumber}` : b.filePath;
      const added = add([
        `- **${b.errorMessage}** (${where}, seen ${b.occurrenceCount}×)`,
        `  - cause: ${b.rootCause}`,
        `  - fix: ${b.fixDescription}`,
      ]);
      if (!added) break; // budget exhausted — stop adding lower-ranked bugs
    }
    if (lines[lines.length - 1] !== "") lines.push("");
    used += 1;
  }

  // ── File-index skeleton (largest; truncated to budget) ───────────────────
  if (files.length > 0) {
    add(["## Files", ""]);
    let shown = 0;
    for (const f of files) {
      if (!add([`- \`${f.filePath}\` — ${f.description}`])) break;
      shown++;
    }
    if (shown < files.length) {
      lines.push(`- …and ${files.length - shown} more (budget reached)`);
    }
    lines.push("");
  }

  // ── Volatile footer (excluded from the cache prefix) ─────────────────────
  const generatedAt = (opts.now ?? new Date()).toISOString();
  lines.push(VOLATILE_MARKER);
  lines.push(
    `generated: ${generatedAt} · files: ${files.length} · bugs: ${bugs.length} · ` +
      `rules: ${totalEntryCount(memory)} · budget: ${budget} tokens`
  );

  return lines.join("\n") + "\n";
}

/** The cache-stable prefix (everything above the volatile marker). */
export function stablePrefix(pack: string): string {
  const idx = pack.indexOf(VOLATILE_MARKER);
  return idx === -1 ? pack : pack.slice(0, idx);
}
