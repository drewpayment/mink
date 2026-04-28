import { readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { minkRoot } from "./paths";
import { parseLearningMemory, serializeLearningMemory } from "./learning-memory";
import type { LearningMemory, SectionName } from "../types/learning-memory";
import type { FileIndex, FileIndexEntry } from "../types/file-index";
import type { DeviceInfo, DeviceRegistry } from "../types/config";

// Custom git merge drivers. All three follow the same contract: read base /
// ours / theirs from disk, compute a deterministic merged result, write it to
// the ours-path, and exit 0 — never fail, never leave conflict markers. Any
// parse error or unexpected shape falls back to "ours" (the local side) and
// logs the failure to ~/.mink/sync-warnings.log so the user can investigate
// later, but the merge itself succeeds and sync stays unblocked.

interface DriverArgs {
  basePath: string;
  oursPath: string;
  theirsPath: string;
  // The original repo path being merged — used in the warning log only.
  filePath: string;
}

function logWarning(driver: string, args: DriverArgs, err: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] ${driver} fallback for ${args.filePath}: ${err instanceof Error ? err.message : String(err)}\n`;
    appendFileSync(join(minkRoot(), "sync-warnings.log"), line);
  } catch {
    // Even logging is best-effort — we never want to block a merge.
  }
}

function readJsonOrNull(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readTextOrEmpty(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

// ── mink-json-union: file-index.json ───────────────────────────────────────

function isFileIndexShape(value: unknown): value is FileIndex {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.header === "object" &&
    obj.header !== null &&
    typeof obj.entries === "object" &&
    obj.entries !== null
  );
}

function mergeFileIndex(ours: FileIndex, theirs: FileIndex): FileIndex {
  const entries: Record<string, FileIndexEntry> = { ...ours.entries };
  for (const [path, entry] of Object.entries(theirs.entries)) {
    const existing = entries[path];
    if (!existing) {
      entries[path] = entry;
      continue;
    }
    // Prefer the side with the more recent lastModified — describes the most
    // up-to-date snapshot of the file.
    if (entry.lastModified > existing.lastModified) {
      entries[path] = entry;
    }
  }
  // Header: latest lastScanTimestamp wins; totalFiles becomes the merged count.
  const lastScan =
    ours.header.lastScanTimestamp > theirs.header.lastScanTimestamp
      ? ours.header.lastScanTimestamp
      : theirs.header.lastScanTimestamp;
  return {
    header: {
      lastScanTimestamp: lastScan,
      totalFiles: Object.keys(entries).length,
      // Header counters are deprecated under sync v2 (counters live in
      // .mink-state-counters.json per device). Preserve max for legacy reads.
      lifetimeHits: Math.max(
        ours.header.lifetimeHits,
        theirs.header.lifetimeHits
      ),
      lifetimeMisses: Math.max(
        ours.header.lifetimeMisses,
        theirs.header.lifetimeMisses
      ),
    },
    entries,
  };
}

export function mergeJsonUnion(args: DriverArgs): void {
  try {
    const ours = readJsonOrNull(args.oursPath);
    const theirs = readJsonOrNull(args.theirsPath);
    if (!isFileIndexShape(ours) || !isFileIndexShape(theirs)) {
      logWarning(
        "mink-json-union",
        args,
        new Error("non-FileIndex shape — keeping ours")
      );
      return;
    }
    const merged = mergeFileIndex(ours, theirs);
    writeFileSync(args.oursPath, JSON.stringify(merged, null, 2));
  } catch (err) {
    logWarning("mink-json-union", args, err);
  }
}

// ── mink-learning-memory: learning-memory.md ───────────────────────────────

function mergeLearningMemory(
  ours: LearningMemory,
  theirs: LearningMemory
): LearningMemory {
  const projectName =
    ours.projectName !== "unknown"
      ? ours.projectName
      : theirs.projectName;
  const sectionNames: SectionName[] = [
    "User Preferences",
    "Key Learnings",
    "Do-Not-Repeat",
    "Decision Log",
  ];
  const sections = {} as LearningMemory["sections"];
  for (const section of sectionNames) {
    const existing = new Map<string, string>();
    for (const entry of ours.sections[section] ?? []) {
      existing.set(entry.trim().toLowerCase(), entry);
    }
    for (const entry of theirs.sections[section] ?? []) {
      const norm = entry.trim().toLowerCase();
      if (!existing.has(norm)) {
        existing.set(norm, entry);
      }
    }
    sections[section] = [...existing.values()];
  }
  return { projectName, sections };
}

export function mergeLearningMemoryDriver(args: DriverArgs): void {
  try {
    const ours = parseLearningMemory(readTextOrEmpty(args.oursPath));
    const theirs = parseLearningMemory(readTextOrEmpty(args.theirsPath));
    const merged = mergeLearningMemory(ours, theirs);
    writeFileSync(args.oursPath, serializeLearningMemory(merged));
  } catch (err) {
    logWarning("mink-learning-memory", args, err);
  }
}

// ── mink-devices: devices.json ─────────────────────────────────────────────

function isDeviceRegistry(value: unknown): value is DeviceRegistry {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.devices === "object" &&
    obj.devices !== null &&
    !Array.isArray(obj.devices)
  );
}

function mergeDevicesRegistry(
  ours: DeviceRegistry,
  theirs: DeviceRegistry
): DeviceRegistry {
  const devices: Record<string, DeviceInfo> = { ...ours.devices };
  for (const [id, info] of Object.entries(theirs.devices)) {
    const existing = devices[id];
    if (!existing) {
      devices[id] = info;
      continue;
    }
    devices[id] = {
      // Prefer ours.name (user-set) when set; otherwise take theirs.
      name: existing.name || info.name,
      hostname: existing.hostname || info.hostname,
      platform: existing.platform || info.platform,
      firstSeen:
        existing.firstSeen < info.firstSeen
          ? existing.firstSeen
          : info.firstSeen,
      lastSeen:
        existing.lastSeen > info.lastSeen
          ? existing.lastSeen
          : info.lastSeen,
    };
  }
  return { devices };
}

export function mergeDevicesDriver(args: DriverArgs): void {
  try {
    const ours = readJsonOrNull(args.oursPath);
    const theirs = readJsonOrNull(args.theirsPath);
    if (!isDeviceRegistry(ours) || !isDeviceRegistry(theirs)) {
      logWarning(
        "mink-devices",
        args,
        new Error("non-DeviceRegistry shape — keeping ours")
      );
      return;
    }
    const merged = mergeDevicesRegistry(ours, theirs);
    writeFileSync(args.oursPath, JSON.stringify(merged, null, 2));
  } catch (err) {
    logWarning("mink-devices", args, err);
  }
}

// ── Dispatcher ─────────────────────────────────────────────────────────────

export function runMergeDriver(
  name: string,
  basePath: string,
  oursPath: string,
  theirsPath: string,
  filePath: string
): number {
  const args: DriverArgs = { basePath, oursPath, theirsPath, filePath };
  switch (name) {
    case "mink-json-union":
      mergeJsonUnion(args);
      return 0;
    case "mink-learning-memory":
      mergeLearningMemoryDriver(args);
      return 0;
    case "mink-devices":
      mergeDevicesDriver(args);
      return 0;
    default:
      logWarning(name, args, new Error("unknown driver — keeping ours"));
      return 0;
  }
}
