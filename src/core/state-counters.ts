// Wrapper over the per-device counters table. The legacy implementation
// kept these in projects/<id>/.mink-state-counters.json; Phase 1's
// importer copies that file's contents into the `counters` table the
// first time the project DB opens, and the file is moved to
// legacy-backup/. Both APIs (totals and per-device) remain available so
// the dashboard and `mink status` keep their existing surface.

import { CountersRepo } from "../repositories/counters-repo";

export interface StateCounters {
  fileIndexHits: number;
  fileIndexMisses: number;
}

export function loadCounters(cwd: string): StateCounters {
  const t = CountersRepo.for(cwd).totals();
  return { fileIndexHits: t.hits, fileIndexMisses: t.misses };
}

export function incrementFileIndexHit(cwd: string): void {
  CountersRepo.for(cwd).incrementHit();
}

export function incrementFileIndexMiss(cwd: string): void {
  CountersRepo.for(cwd).incrementMiss();
}
