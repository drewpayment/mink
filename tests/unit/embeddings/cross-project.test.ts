// Cross-project semantic recall (spec 25): a bug logged in one project surfaces,
// by meaning, while working in another. Uses a deterministic mock provider and
// two registered projects, so no model or network is needed.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { BugMemoryRepo } from "../../../src/repositories/bug-memory-repo";
import { _resetDbCacheForTests } from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";
import { minkRoot } from "../../../src/core/paths";
import { atomicWriteJson } from "../../../src/core/fs-utils";
import { embedBugs, recallBugs } from "../../../src/core/embeddings/recall";
import {
  _setTestEmbeddingProvider,
  isEmbeddingsEnabled,
  type EmbeddingProvider,
} from "../../../src/core/embeddings/provider";
import { embeddings } from "../../../src/commands/embeddings";

const mock: EmbeddingProvider = {
  id: "mock-v1",
  async embed(texts) {
    return texts.map((t) => {
      const s = t.toLowerCase();
      if (/port|address|eaddrinuse|in use|socket|bind/.test(s)) return Float32Array.from([1, 0, 0]);
      if (/null|undefined|cannot read/.test(s)) return Float32Array.from([0, 1, 0]);
      return Float32Array.from([0, 0, 1]);
    });
  },
};

let tmpRoot: string;
let cwdA: string;
let cwdB: string;

function registerProject(cwd: string, name: string) {
  const dir = join(minkRoot(), "projects", projectIdFor(cwd));
  mkdirSync(dir, { recursive: true });
  atomicWriteJson(join(dir, "project-meta.json"), {
    cwd,
    name,
    version: "0.0.0",
    aliases: [],
    pathsByDevice: {},
  });
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-xproj-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwdA = mkdtempSync(join(tmpdir(), "mink-xproj-A-"));
  cwdB = mkdtempSync(join(tmpdir(), "mink-xproj-B-"));
  registerProject(cwdA, "project-a");
  registerProject(cwdB, "project-b");
  _setTestEmbeddingProvider(mock);
});

afterEach(() => {
  _setTestEmbeddingProvider(undefined);
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  delete process.env.MINK_EMBEDDINGS_CROSS_PROJECT;
  for (const d of [tmpRoot, cwdA, cwdB]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("cross-project recall", () => {
  test("surfaces a semantically related bug from another project when enabled", async () => {
    // Project A: a null-safety bug. Project B: a port-binding bug.
    BugMemoryRepo.for(cwdA).add({
      errorMessage: "TypeError: cannot read properties of undefined",
      filePath: "a/list.ts",
      rootCause: "missing guard",
      fixDescription: "optional chaining",
      tags: [],
      relatedBugIds: [],
    });
    const portBug = BugMemoryRepo.for(cwdB).add({
      errorMessage: "EADDRINUSE: listen failed",
      filePath: "b/server.ts",
      rootCause: "stale process still bound",
      fixDescription: "kill it before restart",
      tags: ["network"],
      relatedBugIds: [],
    });
    await embedBugs(cwdA, mock);
    await embedBugs(cwdB, mock);

    process.env.MINK_EMBEDDINGS_CROSS_PROJECT = "true";
    const results = await recallBugs(cwdA, "the socket address is already bound");

    const crossHit = results.find((m) => m.project === projectIdFor(cwdB));
    expect(crossHit).toBeDefined();
    expect(crossHit!.entry.errorMessage).toBe(portBug.errorMessage);
    expect(crossHit!.matchReasons).toContain("cross-project");
  });

  test("does NOT reach into other projects when cross-project is disabled", async () => {
    BugMemoryRepo.for(cwdB).add({
      errorMessage: "EADDRINUSE: listen failed",
      filePath: "b/server.ts",
      rootCause: "stale process",
      fixDescription: "kill it",
      tags: [],
      relatedBugIds: [],
    });
    await embedBugs(cwdB, mock);

    // cross-project not set → default false
    const results = await recallBugs(cwdA, "socket address already bound");
    expect(results.some((m) => m.project)).toBe(false);
  });
});

describe("mink embeddings (CLI)", () => {
  test("enable/disable toggles the config", async () => {
    expect(isEmbeddingsEnabled()).toBe(false);
    await embeddings(cwdA, ["enable"]);
    expect(isEmbeddingsEnabled()).toBe(true);
    await embeddings(cwdA, ["disable"]);
    expect(isEmbeddingsEnabled()).toBe(false);
  });
});
