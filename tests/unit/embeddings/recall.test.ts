// Hybrid bug recall with a deterministic mock provider (spec 25). Proves the
// semantic path surfaces a bug the lexical path misses, and that both
// disabled- and unavailable-provider paths degrade to FTS5.

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { BugMemoryRepo } from "../../../src/repositories/bug-memory-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";
import { embedBugs, recallBugs } from "../../../src/core/embeddings/recall";
import {
  EmbeddingsUnavailableError,
  _setTestEmbeddingProvider,
  type EmbeddingProvider,
} from "../../../src/core/embeddings/provider";

// Deterministic "semantic" space: three orthogonal topics keyed by keywords, so
// a query about ports/addresses matches the EADDRINUSE bug regardless of shared
// words.
const mock: EmbeddingProvider = {
  id: "mock-v1",
  async embed(texts) {
    return texts.map((t) => {
      const s = t.toLowerCase();
      if (/port|address|eaddrinuse|in use|socket|bind/.test(s)) return Float32Array.from([1, 0, 0]);
      if (/null|undefined|cannot read|nullpointer/.test(s)) return Float32Array.from([0, 1, 0]);
      return Float32Array.from([0, 0, 1]);
    });
  },
};

const throwing: EmbeddingProvider = {
  id: "boom",
  async embed() {
    throw new EmbeddingsUnavailableError("model missing");
  },
};

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-recall-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-recall-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
});

afterEach(() => {
  _setTestEmbeddingProvider(undefined);
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function seedTwoBugs() {
  const repo = BugMemoryRepo.for(cwd);
  const portBug = repo.add({
    errorMessage: "EADDRINUSE: listen failed",
    filePath: "src/server.ts",
    rootCause: "a previous instance was still bound",
    fixDescription: "kill the stale process before restarting",
    tags: ["network"],
    relatedBugIds: [],
  });
  const nullBug = repo.add({
    errorMessage: "TypeError: cannot read properties of undefined",
    filePath: "src/list.ts",
    rootCause: "missing guard before access",
    fixDescription: "add optional chaining",
    tags: ["null-safety"],
    relatedBugIds: [],
  });
  return { portBug, nullBug };
}

describe("recallBugs — hybrid", () => {
  test("surfaces a semantically related bug the lexical search misses", async () => {
    const { portBug } = seedTwoBugs();
    _setTestEmbeddingProvider(mock);
    await embedBugs(cwd, mock);

    const query = "the address is already bound to a socket";

    // Lexical-only baseline shares almost no words with the port bug.
    const lexical = BugMemoryRepo.for(cwd).searchBugs(query);
    expect(lexical.some((m) => m.entry.id === portBug.id)).toBe(false);

    // Hybrid recall promotes it via the semantic vector.
    const hybrid = await recallBugs(cwd, query);
    expect(hybrid[0].entry.id).toBe(portBug.id);
    expect(hybrid[0].matchReasons).toContain("semantic");
  });

  test("does not surface an orthogonal (unrelated) bug via the semantic path", async () => {
    const { nullBug } = seedTwoBugs();
    _setTestEmbeddingProvider(mock);
    await embedBugs(cwd, mock);

    // A port query is orthogonal to the null-safety bug (cosine 0 < threshold),
    // and shares no words with it, so it must not appear at all.
    const results = await recallBugs(cwd, "socket address already bound to the port");
    expect(results.some((m) => m.entry.id === nullBug.id)).toBe(false);
  });

  test("falls back to FTS5 when the feature is disabled (no provider)", async () => {
    seedTwoBugs();
    _setTestEmbeddingProvider(null); // explicitly no provider
    const query = "cannot read properties of undefined";
    const hybrid = await recallBugs(cwd, query);
    const lexical = BugMemoryRepo.for(cwd).searchBugs(query);
    expect(hybrid.map((m) => m.entry.id)).toEqual(lexical.map((m) => m.entry.id));
  });

  test("falls back to FTS5 when the provider is unavailable (no throw)", async () => {
    seedTwoBugs();
    _setTestEmbeddingProvider(throwing);
    const query = "cannot read properties of undefined";
    const hybrid = await recallBugs(cwd, query);
    const lexical = BugMemoryRepo.for(cwd).searchBugs(query);
    expect(hybrid.map((m) => m.entry.id)).toEqual(lexical.map((m) => m.entry.id));
  });
});

describe("embedBugs", () => {
  test("embeds pending bugs and is idempotent", async () => {
    seedTwoBugs();
    _setTestEmbeddingProvider(mock);
    const first = await embedBugs(cwd, mock);
    expect(first).toBe(2);
    const second = await embedBugs(cwd, mock); // nothing new to embed
    expect(second).toBe(0);
  });
});
