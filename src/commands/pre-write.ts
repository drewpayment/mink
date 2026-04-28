import { relative } from "path";
import { readFileSync } from "fs";
import { readStdinJson } from "../core/stdin";
import { sessionPath, learningMemoryPath, bugMemoryPath } from "../core/paths";
import { safeReadJson, atomicWriteJson } from "../core/fs-utils";
import { createSessionState, isSessionState } from "../core/session";
import { parseLearningMemory, getEntries } from "../core/learning-memory";
import {
  aggregateLearningMemory,
  aggregateBugMemory,
} from "../core/state-aggregator";
import { extractPatterns, matchPatterns } from "../core/pattern-engine";
import {
  loadBugMemory,
  lookupBugsForFile,
  formatBugSummary,
} from "../core/bug-memory";
import type { SessionState } from "../types/session";
import type { PatternMatch } from "../types/learning-memory";
import type { BugMemory } from "../types/bug-memory";
import type { PreToolUseInput } from "../types/hook-input";

export interface PreWriteResult {
  warnings: string[];
  patternMatches: PatternMatch[];
  bugSummary: string | null;
}

export function analyzePreWrite(
  filePath: string,
  writeContent: string,
  doNotRepeatEntries: string[],
  bugMemory?: BugMemory
): PreWriteResult {
  const warnings: string[] = [];
  const allMatches: PatternMatch[] = [];

  // 1. Learning memory enforcement
  if (doNotRepeatEntries.length > 0 && writeContent.length > 0) {
    const patterns = extractPatterns(doNotRepeatEntries);
    const matches = matchPatterns(patterns, writeContent);
    allMatches.push(...matches);

    for (const match of matches) {
      warnings.push(
        `[mink] Do-Not-Repeat violation: "${match.matchedText}" — from: ${match.pattern.sourceEntry}`
      );
    }
  }

  // 2. Bug memory lookup — surface known bugs for this file
  let bugSummary: string | null = null;
  if (bugMemory) {
    const bugEntries = lookupBugsForFile(bugMemory, filePath);
    bugSummary = formatBugSummary(bugEntries);
  }

  return { warnings, patternMatches: allMatches, bugSummary };
}

function isPreToolUseInput(value: unknown): value is PreToolUseInput {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.tool_name !== "string") return false;
  if (typeof obj.tool_input !== "object" || obj.tool_input === null) return false;
  return true;
}

function extractWriteContent(input: PreToolUseInput): string {
  const ti = input.tool_input;
  if (input.tool_name === "Write" && typeof ti.content === "string") {
    return ti.content;
  }
  if (input.tool_name === "Edit" && typeof ti.new_string === "string") {
    return ti.new_string;
  }
  return "";
}

export async function preWrite(cwd: string): Promise<void> {
  // 5-second safety timeout
  const timer = setTimeout(() => process.exit(0), 5000);

  try {
    const input = await readStdinJson();
    if (!isPreToolUseInput(input)) return;
    if (input.tool_name !== "Write" && input.tool_name !== "Edit") return;

    const absolutePath = input.tool_input.file_path;
    if (!absolutePath) return;

    const filePath = relative(cwd, absolutePath);
    const writeContent = extractWriteContent(input);

    // Load learning memory Do-Not-Repeat entries (canonical + sidecars)
    let doNotRepeatEntries: string[] = [];
    try {
      const mem = aggregateLearningMemory(cwd);
      doNotRepeatEntries = getEntries(mem, "Do-Not-Repeat");
    } catch {
      // Learning memory not found or corrupt — skip enforcement
    }

    // Load bug memory for this file (aggregated across shards)
    let bugMemory: BugMemory | undefined;
    try {
      bugMemory = aggregateBugMemory(cwd);
    } catch {
      // Bug memory not found or corrupt — skip lookup
    }

    const result = analyzePreWrite(filePath, writeContent, doNotRepeatEntries, bugMemory);

    // Emit warnings to stderr (advisory only)
    for (const warning of result.warnings) {
      process.stderr.write(warning + "\n");
    }

    // Emit bug summary to stderr if there are known bugs for this file
    if (result.bugSummary) {
      process.stderr.write(result.bugSummary + "\n");
    }

    // Update session counters if there were pattern matches
    if (result.patternMatches.length > 0) {
      const rawState = safeReadJson(sessionPath(cwd));
      const state: SessionState = isSessionState(rawState)
        ? rawState
        : createSessionState();

      state.counters.learnedRuleWarnings += result.patternMatches.length;
      atomicWriteJson(sessionPath(cwd), state);
    }
  } catch {
    // Never crash — exit silently
  } finally {
    clearTimeout(timer);
  }
}
