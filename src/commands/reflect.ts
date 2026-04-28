import { existsSync } from "fs";
import { dirname } from "path";
import { serializeLearningMemory, totalEntryCount } from "../core/learning-memory";
import { aggregateLearningMemoryAt } from "../core/state-aggregator";
import { reflectMemory } from "../core/reflection";
import { atomicWriteText, safeReadJson } from "../core/fs-utils";
import type { ReflectionResult } from "../types/learning-memory";
import type { ProjectConfig } from "../types/file-index";

const DEFAULT_TOKEN_BUDGET = 2000;

export function reflect(
  _cwd: string,
  memoryPath: string,
  configPath: string
): ReflectionResult | null {
  // Aggregate canonical + every device's sidecar that sits next to memoryPath.
  // Using dirname(memoryPath) keeps callers in control of where the project
  // state lives — production passes projectDir(cwd)/learning-memory.md, tests
  // pass arbitrary temp directories.
  const projDir = dirname(memoryPath);
  const mem = aggregateLearningMemoryAt(projDir);
  if (totalEntryCount(mem) === 0 && !existsSync(memoryPath)) {
    console.log("[mink] no learning memory found");
    return null;
  }

  const config = safeReadJson(configPath) as ProjectConfig | null;
  const tokenBudget = config?.learningMemoryTokenBudget ?? DEFAULT_TOKEN_BUDGET;

  const { memory: updated, result } = reflectMemory(mem, tokenBudget);

  if (result.mergedCount > 0 || result.trimmedCount > 0) {
    atomicWriteText(memoryPath, serializeLearningMemory(updated));
  }

  console.log(
    `[mink] reflect: ${result.beforeTokens} → ${result.afterTokens} tokens` +
      ` | merged: ${result.mergedCount} | trimmed: ${result.trimmedCount}` +
      ` | within budget: ${result.withinBudget}`
  );

  return result;
}
