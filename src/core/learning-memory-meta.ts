import { createHash, randomUUID } from "crypto";
import { atomicWriteJson, safeReadJson } from "./fs-utils";
import { learningMemoryMetaPath } from "./paths";
import type {
  LearningMemory,
  LearningMemoryMeta,
  RuleMeta,
  SectionName,
} from "../types/learning-memory";

function emptyMeta(): LearningMemoryMeta {
  return { version: 1, entries: {} };
}

function isMeta(value: unknown): value is LearningMemoryMeta {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return obj.version === 1 && typeof obj.entries === "object" && obj.entries !== null;
}

export function entryKey(section: SectionName, text: string): string {
  const normalized = `${section}::${text.toLowerCase().trim()}`;
  return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

export function loadMeta(cwd: string): LearningMemoryMeta {
  const raw = safeReadJson(learningMemoryMetaPath(cwd));
  if (raw && isMeta(raw)) return raw;
  return emptyMeta();
}

export function saveMeta(cwd: string, meta: LearningMemoryMeta): void {
  atomicWriteJson(learningMemoryMetaPath(cwd), meta);
}

export function getMetaForEntry(
  meta: LearningMemoryMeta,
  section: SectionName,
  text: string
): RuleMeta | undefined {
  return meta.entries[entryKey(section, text)];
}

export function setMetaForEntry(
  meta: LearningMemoryMeta,
  section: SectionName,
  text: string,
  partial: Omit<Partial<RuleMeta>, "id" | "createdAt"> & { source: RuleMeta["source"] }
): RuleMeta {
  const key = entryKey(section, text);
  const existing = meta.entries[key];
  const record: RuleMeta = existing
    ? { ...existing, ...partial }
    : {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        ...partial,
      };
  meta.entries[key] = record;
  return record;
}

export function removeMetaForEntry(
  meta: LearningMemoryMeta,
  section: SectionName,
  text: string
): void {
  delete meta.entries[entryKey(section, text)];
}

export function pruneOrphans(
  meta: LearningMemoryMeta,
  mem: LearningMemory
): LearningMemoryMeta {
  const live = new Set<string>();
  for (const section of Object.keys(mem.sections) as SectionName[]) {
    for (const text of mem.sections[section]) {
      live.add(entryKey(section, text));
    }
  }
  const pruned: Record<string, RuleMeta> = {};
  for (const [k, v] of Object.entries(meta.entries)) {
    if (live.has(k)) pruned[k] = v;
  }
  return { version: 1, entries: pruned };
}
