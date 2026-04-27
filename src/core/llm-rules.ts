import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from "fs";
import { addEntry, parseLearningMemory, serializeLearningMemory, createEmptyLearningMemory } from "./learning-memory";
import { atomicWriteText } from "./fs-utils";
import { executeAiCli, safeJsonExtract } from "./llm-runner";
import { learningMemoryPath, actionLogPath } from "./paths";
import {
  loadMeta,
  saveMeta,
  setMetaForEntry,
  pruneOrphans,
  entryKey,
} from "./learning-memory-meta";
import { addSuggestions } from "./learning-suggestions";
import { resolveLearningMemoryAi } from "./global-config";
import type {
  RuleSource,
  SectionName,
  SuggestedRule,
} from "../types/learning-memory";

// ── Section validation ─────────────────────────────────────────────────────

const VALID_SECTIONS: SectionName[] = [
  "User Preferences",
  "Key Learnings",
  "Do-Not-Repeat",
  "Decision Log",
];

function isValidSection(value: unknown): value is SectionName {
  return typeof value === "string" && (VALID_SECTIONS as string[]).includes(value);
}

function clampConfidence(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

// ── Prompts ────────────────────────────────────────────────────────────────

const JSON_ONLY_PREFIX =
  "Output ONLY a JSON object matching the schema. No prose, no fences, no explanation.\n\n";

const SECTION_LIST = VALID_SECTIONS.map((s) => `"${s}"`).join(", ");

function proposePrompt(actionLogTail: string, maxRules: number): string {
  return (
    JSON_ONLY_PREFIX +
    `Schema: { "rules": [{ "section": ${SECTION_LIST}, "text": string, "confidence": number 0..1, "rationale": string, "sourceSessionIds": string[] }] }\n\n` +
    `Task: read the recent Mink action log below and propose at most ${maxRules} new learning rules.\n` +
    `Rules must be concrete, generalizable, and supported by recurring evidence. Reject one-shot anomalies. Each "text" must be a single imperative sentence under 200 characters. Section choices: User Preferences (workflow style), Key Learnings (project facts), Do-Not-Repeat (mistakes corrected), Decision Log (committed decisions). Set "confidence" to your honest 0..1 belief the rule will hold next session.\n\n` +
    `--- ACTION LOG ---\n${actionLogTail}\n--- END ---`
  );
}

function refinePrompt(section: SectionName, text: string): string {
  return (
    JSON_ONLY_PREFIX +
    `Schema: { "refinedText": string, "rationale": string, "confidence": number 0..1 }\n\n` +
    `Refine the user's draft learning rule. Tighten phrasing into a single imperative sentence under 200 characters. Preserve user intent. Do not invent constraints not implied by the draft. If the draft is already optimal, return it verbatim with high confidence.\n\n` +
    `Section: ${section}\nDraft: ${JSON.stringify(text)}`
  );
}

function curatePrompt(memorySnapshot: string): string {
  return (
    JSON_ONLY_PREFIX +
    `Schema: { "removeKeys": string[], "mergeOps": [{ "keep": string, "dropKeys": string[] }] }\n\n` +
    `Identify only semantic duplicates or directly contradicted rules. Leave ambiguous pairs alone. Keys are the entry hashes provided alongside each entry. "removeKeys" deletes entries; "mergeOps.keep" is the surviving key, "dropKeys" are merged into it (keep's text wins).\n\n` +
    `--- MEMORY ---\n${memorySnapshot}\n--- END ---`
  );
}

// ── Action log windowing ───────────────────────────────────────────────────

function readActionLogTail(cwd: string, maxBytes: number): string {
  const path = actionLogPath(cwd);
  if (!existsSync(path)) return "";
  try {
    const stat = statSync(path);
    if (stat.size <= maxBytes) return readFileSync(path, "utf-8");
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
      return buf.toString("utf-8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

// ── Public helpers ─────────────────────────────────────────────────────────

interface ProposeOptions {
  maxBytes?: number;
  maxRules?: number;
  timeoutMs?: number;
}

export interface ProposedRule {
  section: SectionName;
  text: string;
  confidence: number;
  rationale: string;
  sourceSessionIds: string[];
}

export async function proposeRulesFromActionLog(
  cwd: string,
  opts: ProposeOptions = {}
): Promise<ProposedRule[]> {
  const tail = readActionLogTail(cwd, opts.maxBytes ?? 32_000);
  if (!tail.trim()) return [];

  const prompt = proposePrompt(tail, opts.maxRules ?? 8);
  let raw: string;
  try {
    raw = await executeAiCli(prompt, opts.timeoutMs ?? 180_000);
  } catch (err) {
    console.warn(`[mink] propose-rules: AI CLI failed: ${(err as Error).message}`);
    return [];
  }

  const parsed = safeJsonExtract<{ rules?: unknown[] }>(raw);
  if (!parsed || !Array.isArray(parsed.rules)) {
    console.warn("[mink] propose-rules: could not parse JSON from AI CLI output");
    return [];
  }

  const rules: ProposedRule[] = [];
  for (const item of parsed.rules) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isValidSection(r.section)) continue;
    if (typeof r.text !== "string" || r.text.trim() === "") continue;
    rules.push({
      section: r.section,
      text: r.text.trim(),
      confidence: clampConfidence(r.confidence),
      rationale: typeof r.rationale === "string" ? r.rationale : "",
      sourceSessionIds: Array.isArray(r.sourceSessionIds)
        ? r.sourceSessionIds.filter((s): s is string => typeof s === "string")
        : [],
    });
  }
  return rules;
}

export interface RefineResult {
  refinedText: string;
  rationale: string;
  confidence: number;
}

export async function refineRule(
  section: SectionName,
  text: string,
  timeoutMs = 60_000
): Promise<RefineResult> {
  const prompt = refinePrompt(section, text);
  const raw = await executeAiCli(prompt, timeoutMs);
  const parsed = safeJsonExtract<{
    refinedText?: unknown;
    rationale?: unknown;
    confidence?: unknown;
  }>(raw);

  if (!parsed) {
    return { refinedText: text, rationale: "AI output unparseable; returned input verbatim", confidence: 0 };
  }

  return {
    refinedText:
      typeof parsed.refinedText === "string" && parsed.refinedText.trim() !== ""
        ? parsed.refinedText.trim()
        : text,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    confidence: clampConfidence(parsed.confidence),
  };
}

interface CurateResult {
  removed: number;
  merged: number;
}

export async function curateAndDedupe(
  cwd: string,
  timeoutMs = 180_000
): Promise<CurateResult> {
  const memPath = learningMemoryPath(cwd);
  if (!existsSync(memPath)) return { removed: 0, merged: 0 };

  const mem = parseLearningMemory(readFileSync(memPath, "utf-8"));
  const meta = loadMeta(cwd);

  const snapshot: Array<{ key: string; section: SectionName; text: string }> = [];
  for (const section of VALID_SECTIONS) {
    for (const text of mem.sections[section]) {
      snapshot.push({ key: entryKey(section, text), section, text });
    }
  }
  if (snapshot.length === 0) return { removed: 0, merged: 0 };

  const memorySnapshot = JSON.stringify(snapshot, null, 2);
  let raw: string;
  try {
    raw = await executeAiCli(curatePrompt(memorySnapshot), timeoutMs);
  } catch (err) {
    console.warn(`[mink] curate-rules: AI CLI failed: ${(err as Error).message}`);
    return { removed: 0, merged: 0 };
  }

  const parsed = safeJsonExtract<{
    removeKeys?: unknown;
    mergeOps?: unknown;
  }>(raw);
  if (!parsed) return { removed: 0, merged: 0 };

  const removeKeys = new Set<string>(
    Array.isArray(parsed.removeKeys)
      ? parsed.removeKeys.filter((k): k is string => typeof k === "string")
      : []
  );

  // Merge ops: for each op, drop all `dropKeys` (the kept entry stays as-is).
  if (Array.isArray(parsed.mergeOps)) {
    for (const op of parsed.mergeOps) {
      if (!op || typeof op !== "object") continue;
      const drops = (op as Record<string, unknown>).dropKeys;
      if (!Array.isArray(drops)) continue;
      for (const k of drops) {
        if (typeof k === "string") removeKeys.add(k);
      }
    }
  }

  if (removeKeys.size === 0) return { removed: 0, merged: 0 };

  // Build a fresh memory excluding the keys to remove.
  const next = createEmptyLearningMemory(mem.projectName);
  let removed = 0;
  for (const section of VALID_SECTIONS) {
    for (const text of mem.sections[section]) {
      if (removeKeys.has(entryKey(section, text))) {
        removed++;
        continue;
      }
      addEntry(next, section, text);
    }
  }
  atomicWriteText(memPath, serializeLearningMemory(next));

  const prunedMeta = pruneOrphans(meta, next);
  saveMeta(cwd, prunedMeta);

  return { removed, merged: 0 };
}

// ── Routing helpers used by scheduler and the propose endpoint ─────────────

export interface RouteResult {
  autoAccepted: number;
  queued: number;
}

export function routeProposed(
  cwd: string,
  rules: ProposedRule[],
  threshold: number,
  source: RuleSource = "llm:auto"
): RouteResult {
  if (rules.length === 0) return { autoAccepted: 0, queued: 0 };

  const memPath = learningMemoryPath(cwd);
  const mem = existsSync(memPath)
    ? parseLearningMemory(readFileSync(memPath, "utf-8"))
    : createEmptyLearningMemory("unknown");
  const meta = loadMeta(cwd);

  let autoAccepted = 0;
  const toQueue: Omit<SuggestedRule, "id" | "createdAt" | "status">[] = [];

  for (const rule of rules) {
    if (rule.confidence >= threshold) {
      // Skip if the rule already exists verbatim.
      const existing = mem.sections[rule.section];
      if (existing.includes(rule.text)) continue;
      addEntry(mem, rule.section, rule.text);
      setMetaForEntry(meta, rule.section, rule.text, {
        source,
        confidence: rule.confidence,
        rationale: rule.rationale,
        sourceSessionIds: rule.sourceSessionIds,
      });
      autoAccepted++;
    } else {
      toQueue.push({
        section: rule.section,
        text: rule.text,
        confidence: rule.confidence,
        rationale: rule.rationale,
        source,
        sourceSessionIds: rule.sourceSessionIds,
      });
    }
  }

  if (autoAccepted > 0) {
    atomicWriteText(memPath, serializeLearningMemory(mem));
    saveMeta(cwd, meta);
  }
  const queued = toQueue.length > 0 ? addSuggestions(cwd, toQueue).length : 0;
  return { autoAccepted, queued };
}

// ── Scheduler entrypoints ──────────────────────────────────────────────────

export async function runMine(cwd: string, timeoutMs: number): Promise<RouteResult> {
  const config = resolveLearningMemoryAi();
  if (!config.enabled || !config.scheduledMining) {
    return { autoAccepted: 0, queued: 0 };
  }

  const rules = await proposeRulesFromActionLog(cwd, {
    timeoutMs,
    maxRules: config.maxRulesPerRun,
  });
  return routeProposed(cwd, rules, config.autoAcceptThreshold);
}

export async function runCurate(cwd: string, timeoutMs: number): Promise<CurateResult> {
  const config = resolveLearningMemoryAi();
  if (!config.enabled) return { removed: 0, merged: 0 };
  return curateAndDedupe(cwd, timeoutMs);
}

