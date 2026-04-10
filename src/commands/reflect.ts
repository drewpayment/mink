import { existsSync, readFileSync } from "fs";
import { parseLearningMemory, serializeLearningMemory } from "../core/learning-memory";
import { reflectMemory } from "../core/reflection";
import { atomicWriteText, safeReadJson } from "../core/fs-utils";
import type { ReflectionResult } from "../types/learning-memory";
import type { ProjectConfig } from "../types/file-index";

const DEFAULT_TOKEN_BUDGET = 2000;

export function reflect(
  projectDir: string,
  memoryPath: string,
  configPath: string
): ReflectionResult | null {
  if (!existsSync(memoryPath)) {
    console.log("[mink] no learning memory found");
    return null;
  }

  const markdown = readFileSync(memoryPath, "utf-8");
  const mem = parseLearningMemory(markdown);

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
