import type { LearningMemory, SectionName, ReflectionResult } from "../types/learning-memory";
import { serializeLearningMemory } from "./learning-memory";
import { estimateTokens } from "./token-estimate";

// Trim order: Decision Log first → Key Learnings → User Preferences → Do-Not-Repeat last
const TRIM_ORDER: SectionName[] = [
  "Decision Log",
  "Key Learnings",
  "User Preferences",
  "Do-Not-Repeat",
];

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Extract the quoted pattern from a Do-Not-Repeat entry, e.g.
 * `Don't use "var" in code` → `var`
 * Only matches double-quoted strings to avoid matching apostrophes in contractions.
 * Returns null if no double-quoted pattern found.
 */
function extractQuotedPattern(entry: string): string | null {
  const m = entry.match(/"([^"]+)"/);
  return m ? m[1] : null;
}

/**
 * Extract date from an entry in the form `[YYYY-MM-DD]`
 * Returns the date string or null.
 */
function extractDate(entry: string): string | null {
  const m = entry.match(/\[(\d{4}-\d{2}-\d{2})\]/);
  return m ? m[1] : null;
}

function deepCopy(mem: LearningMemory): LearningMemory {
  return {
    projectName: mem.projectName,
    sections: {
      "User Preferences": [...mem.sections["User Preferences"]],
      "Key Learnings": [...mem.sections["Key Learnings"]],
      "Do-Not-Repeat": [...mem.sections["Do-Not-Repeat"]],
      "Decision Log": [...mem.sections["Decision Log"]],
    },
  };
}

/**
 * Merge duplicates within each section.
 * - Exact duplicates (normalized whitespace) → keep one
 * - Do-Not-Repeat: entries sharing same quoted pattern → merge, keep newer date
 * Returns a new LearningMemory (does not mutate input).
 */
export function mergeDuplicates(mem: LearningMemory): LearningMemory {
  const result = deepCopy(mem);

  const sectionNames: SectionName[] = [
    "User Preferences",
    "Key Learnings",
    "Do-Not-Repeat",
    "Decision Log",
  ];

  for (const section of sectionNames) {
    const entries = result.sections[section];

    if (section === "Do-Not-Repeat") {
      // First pass: group by quoted pattern (where it exists)
      const byQuotedPattern = new Map<string, string[]>();
      const noPattern: string[] = [];

      for (const entry of entries) {
        const qp = extractQuotedPattern(entry);
        if (qp !== null) {
          if (!byQuotedPattern.has(qp)) {
            byQuotedPattern.set(qp, []);
          }
          byQuotedPattern.get(qp)!.push(entry);
        } else {
          noPattern.push(entry);
        }
      }

      const merged: string[] = [];

      // For each quoted pattern group, keep the one with the newer date (or last entry)
      for (const [, group] of byQuotedPattern) {
        if (group.length === 1) {
          merged.push(group[0]);
        } else {
          // Find the entry with the newest date
          let best = group[0];
          let bestDate = extractDate(group[0]);
          for (let i = 1; i < group.length; i++) {
            const d = extractDate(group[i]);
            if (d !== null && (bestDate === null || d > bestDate)) {
              best = group[i];
              bestDate = d;
            } else if (d === null && bestDate === null) {
              // No dates — keep last (newer = later in list)
              best = group[i];
            }
          }
          merged.push(best);
        }
      }

      // For entries without quoted patterns, deduplicate by normalized whitespace
      const seenNoPattern = new Set<string>();
      for (const entry of noPattern) {
        const norm = normalizeWhitespace(entry);
        if (!seenNoPattern.has(norm)) {
          seenNoPattern.add(norm);
          merged.push(entry);
        }
      }

      result.sections[section] = merged;
    } else {
      // Standard deduplication: normalize whitespace and deduplicate
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const entry of entries) {
        const norm = normalizeWhitespace(entry);
        if (!seen.has(norm)) {
          seen.add(norm);
          deduped.push(entry);
        }
      }
      result.sections[section] = deduped;
    }
  }

  return result;
}

/**
 * Trim oldest entries from sections in the given order.
 * Trim order: Decision Log → Key Learnings → User Preferences → Do-Not-Repeat
 * Within each section, remove oldest (first) entries.
 * Returns a new LearningMemory (does not mutate input).
 */
export function trimOldest(mem: LearningMemory, trimCount: number): LearningMemory {
  if (trimCount <= 0) {
    return deepCopy(mem);
  }

  const result = deepCopy(mem);
  let remaining = trimCount;

  for (const section of TRIM_ORDER) {
    if (remaining <= 0) break;
    const entries = result.sections[section];
    const toRemove = Math.min(remaining, entries.length);
    result.sections[section] = entries.slice(toRemove);
    remaining -= toRemove;
  }

  return result;
}

/**
 * Reflect memory against a token budget: merge duplicates then trim oldest until within budget.
 * If budget <= 0, skip pruning.
 */
export function reflectMemory(
  mem: LearningMemory,
  tokenBudget: number
): { memory: LearningMemory; result: ReflectionResult } {
  const serialized = serializeLearningMemory(mem);
  const beforeTokens = estimateTokens(serialized, "learning-memory.md");

  if (tokenBudget <= 0) {
    return {
      memory: deepCopy(mem),
      result: {
        beforeTokens,
        afterTokens: beforeTokens,
        mergedCount: 0,
        trimmedCount: 0,
        withinBudget: true,
      },
    };
  }

  if (beforeTokens <= tokenBudget) {
    return {
      memory: deepCopy(mem),
      result: {
        beforeTokens,
        afterTokens: beforeTokens,
        mergedCount: 0,
        trimmedCount: 0,
        withinBudget: true,
      },
    };
  }

  // Step 1: Merge duplicates
  const beforeMergeCount = countEntries(mem);
  const afterMerge = mergeDuplicates(mem);
  const afterMergeCount = countEntries(afterMerge);
  const mergedCount = beforeMergeCount - afterMergeCount;

  const afterMergeSerialized = serializeLearningMemory(afterMerge);
  const afterMergeTokens = estimateTokens(afterMergeSerialized, "learning-memory.md");

  if (afterMergeTokens <= tokenBudget) {
    return {
      memory: afterMerge,
      result: {
        beforeTokens,
        afterTokens: afterMergeTokens,
        mergedCount,
        trimmedCount: 0,
        withinBudget: true,
      },
    };
  }

  // Step 2: Trim oldest one at a time until within budget or empty
  let current = afterMerge;
  let trimmedCount = 0;

  while (true) {
    const currentSerialized = serializeLearningMemory(current);
    const currentTokens = estimateTokens(currentSerialized, "learning-memory.md");

    if (currentTokens <= tokenBudget) {
      return {
        memory: current,
        result: {
          beforeTokens,
          afterTokens: currentTokens,
          mergedCount,
          trimmedCount,
          withinBudget: true,
        },
      };
    }

    const total = countEntries(current);
    if (total === 0) {
      return {
        memory: current,
        result: {
          beforeTokens,
          afterTokens: currentTokens,
          mergedCount,
          trimmedCount,
          withinBudget: false,
        },
      };
    }

    current = trimOldest(current, 1);
    trimmedCount += 1;
  }
}

function countEntries(mem: LearningMemory): number {
  return (
    mem.sections["User Preferences"].length +
    mem.sections["Key Learnings"].length +
    mem.sections["Do-Not-Repeat"].length +
    mem.sections["Decision Log"].length
  );
}
