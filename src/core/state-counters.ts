import { atomicWriteJson, safeReadJson } from "./fs-utils";
import { fileIndexCountersPath } from "./paths";

// Per-device telemetry counters. Lives at projects/<id>/.mink-state-counters.json
// and is gitignored so each device's counts never collide. Aggregated views
// (dashboard, status) sum across devices via aggregateStateCounters().

export interface StateCounters {
  fileIndexHits: number;
  fileIndexMisses: number;
}

function emptyCounters(): StateCounters {
  return { fileIndexHits: 0, fileIndexMisses: 0 };
}

function isStateCounters(value: unknown): value is StateCounters {
  if (value === null || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.fileIndexHits === "number" &&
    typeof obj.fileIndexMisses === "number"
  );
}

export function loadCounters(cwd: string): StateCounters {
  const raw = safeReadJson(fileIndexCountersPath(cwd));
  if (raw !== null && isStateCounters(raw)) return raw;
  return emptyCounters();
}

export function saveCounters(cwd: string, counters: StateCounters): void {
  atomicWriteJson(fileIndexCountersPath(cwd), counters);
}

export function incrementFileIndexHit(cwd: string): void {
  const c = loadCounters(cwd);
  c.fileIndexHits++;
  saveCounters(cwd, c);
}

export function incrementFileIndexMiss(cwd: string): void {
  const c = loadCounters(cwd);
  c.fileIndexMisses++;
  saveCounters(cwd, c);
}
