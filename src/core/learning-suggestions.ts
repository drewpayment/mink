import { randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { atomicWriteJson, atomicWriteText, safeReadJson } from "./fs-utils";
import {
  learningMemoryPath,
  learningSuggestionsPath,
} from "./paths";
import {
  parseLearningMemory,
  serializeLearningMemory,
  addEntry,
  createEmptyLearningMemory,
} from "./learning-memory";
import { entryKey, loadMeta, saveMeta, setMetaForEntry } from "./learning-memory-meta";
import type {
  RuleMeta,
  SectionName,
  SuggestedRule,
  SuggestionsStore,
} from "../types/learning-memory";

function emptyStore(): SuggestionsStore {
  return { version: 1, suggestions: [] };
}

function isStore(value: unknown): value is SuggestionsStore {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj.version === 1 && Array.isArray(obj.suggestions);
}

export function loadSuggestions(cwd: string): SuggestionsStore {
  const raw = safeReadJson(learningSuggestionsPath(cwd));
  if (raw && isStore(raw)) return raw;
  return emptyStore();
}

export function saveSuggestions(cwd: string, store: SuggestionsStore): void {
  atomicWriteJson(learningSuggestionsPath(cwd), store);
}

export function newSuggestion(
  fields: Omit<SuggestedRule, "id" | "createdAt" | "status">
): SuggestedRule {
  return {
    ...fields,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending",
  };
}

export function addSuggestions(
  cwd: string,
  items: Omit<SuggestedRule, "id" | "createdAt" | "status">[]
): SuggestedRule[] {
  const store = loadSuggestions(cwd);
  const seenKeys = new Set(
    store.suggestions
      .filter((s) => s.status === "pending")
      .map((s) => entryKey(s.section, s.text))
  );

  const added: SuggestedRule[] = [];
  for (const item of items) {
    const key = entryKey(item.section, item.text);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const record = newSuggestion(item);
    store.suggestions.push(record);
    added.push(record);
  }

  saveSuggestions(cwd, store);
  return added;
}

export function findSuggestion(
  store: SuggestionsStore,
  id: string
): SuggestedRule | undefined {
  return store.suggestions.find((s) => s.id === id);
}

function loadMemoryForWrite(cwd: string) {
  const memPath = learningMemoryPath(cwd);
  if (!existsSync(memPath)) return createEmptyLearningMemory("unknown");
  try {
    return parseLearningMemory(readFileSync(memPath, "utf-8"));
  } catch {
    return createEmptyLearningMemory("unknown");
  }
}

export interface AcceptResult {
  meta: RuleMeta;
  section: SectionName;
  text: string;
}

export function acceptSuggestion(
  cwd: string,
  id: string,
  edits?: { section?: SectionName; text?: string }
): AcceptResult | null {
  const store = loadSuggestions(cwd);
  const target = findSuggestion(store, id);
  if (!target || target.status !== "pending") return null;

  const section = edits?.section ?? target.section;
  const text = edits?.text ?? target.text;

  const memory = loadMemoryForWrite(cwd);
  addEntry(memory, section, text);
  atomicWriteText(learningMemoryPath(cwd), serializeLearningMemory(memory));

  const meta = loadMeta(cwd);
  const record = setMetaForEntry(meta, section, text, {
    source: edits ? "llm:refined" : target.source,
    confidence: target.confidence,
    rationale: target.rationale,
    sourceSessionIds: target.sourceSessionIds,
  });
  saveMeta(cwd, meta);

  target.status = "accepted";
  saveSuggestions(cwd, store);

  return { meta: record, section, text };
}

export function rejectSuggestion(cwd: string, id: string): boolean {
  const store = loadSuggestions(cwd);
  const target = findSuggestion(store, id);
  if (!target) return false;
  if (target.status !== "pending") return true;
  target.status = "rejected";
  saveSuggestions(cwd, store);
  return true;
}

export function pendingCount(store: SuggestionsStore): number {
  return store.suggestions.filter((s) => s.status === "pending").length;
}
