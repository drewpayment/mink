import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Cross-device convergence: simulate two devices writing into the same project
// state by manually creating per-device shards. The aggregator should produce
// a single coherent view across both. This is the "no conflict" guarantee at
// the read layer.

let mockRoot: string;

beforeEach(() => {
  mockRoot = mkdtempSync(join(tmpdir(), "mink-xdevice-test-"));
  process.env.MINK_ROOT_OVERRIDE = mockRoot;
  // Wiki path is read from config keys (MINK_WIKI_PATH env var > config file >
  // default ~/.mink/wiki). The default doesn't honour MINK_ROOT_OVERRIDE, so
  // we have to point it explicitly to our isolated tmp wiki.
  process.env.MINK_WIKI_PATH = join(mockRoot, "wiki");
});

afterEach(() => {
  delete process.env.MINK_ROOT_OVERRIDE;
  delete process.env.MINK_WIKI_PATH;
  rmSync(mockRoot, { recursive: true, force: true });
});

function makeSession(id: string, start: string, tokens = 100) {
  return {
    sessionId: id,
    startTimestamp: start,
    endTimestamp: start,
    reads: [],
    writes: [],
    totals: {
      readCount: 1,
      writeCount: 0,
      estimatedTokens: tokens,
      repeatedReads: 0,
      fileIndexHits: 1,
      fileIndexMisses: 0,
    },
    estimatedSavings: 0,
  };
}

function ledgerWith(sessions: ReturnType<typeof makeSession>[]) {
  return {
    lifetime: sessions.reduce(
      (acc, s) => ({
        totalTokens: acc.totalTokens + s.totals.estimatedTokens,
        totalReads: acc.totalReads + s.totals.readCount,
        totalWrites: acc.totalWrites + s.totals.writeCount,
        totalSessions: acc.totalSessions + 1,
        totalFileIndexHits: acc.totalFileIndexHits + s.totals.fileIndexHits,
        totalFileIndexMisses: acc.totalFileIndexMisses + s.totals.fileIndexMisses,
        totalRepeatedReads: acc.totalRepeatedReads + s.totals.repeatedReads,
        totalEstimatedSavings: acc.totalEstimatedSavings + s.estimatedSavings,
      }),
      {
        totalTokens: 0,
        totalReads: 0,
        totalWrites: 0,
        totalSessions: 0,
        totalFileIndexHits: 0,
        totalFileIndexMisses: 0,
        totalRepeatedReads: 0,
        totalEstimatedSavings: 0,
      }
    ),
    sessions,
  };
}

describe("cross-device sync convergence", () => {
  test("aggregator surfaces sessions from both device shards", async () => {
    const projDir = join(mockRoot, "projects", "proj-A");
    const stateA = join(projDir, "state", "device-A");
    const stateB = join(projDir, "state", "device-B");
    mkdirSync(stateA, { recursive: true });
    mkdirSync(stateB, { recursive: true });

    writeFileSync(
      join(stateA, "token-ledger.json"),
      JSON.stringify(
        ledgerWith([
          makeSession("a-1", "2026-04-10T09:00:00.000Z", 100),
          makeSession("a-2", "2026-04-11T09:00:00.000Z", 200),
        ])
      )
    );
    writeFileSync(
      join(stateB, "token-ledger.json"),
      JSON.stringify(
        ledgerWith([makeSession("b-1", "2026-04-10T13:00:00.000Z", 300)])
      )
    );

    const { aggregateTokenLedgerAt } = await import(
      "../../src/core/state-aggregator"
    );
    const merged = aggregateTokenLedgerAt(projDir);

    expect(merged.sessions.map((s) => s.sessionId)).toEqual([
      "a-1",
      "b-1",
      "a-2",
    ]);
    expect(merged.lifetime.totalSessions).toBe(3);
    expect(merged.lifetime.totalTokens).toBe(600);
  });

  test("note collision auto-suffix produces two distinct files when content differs", async () => {
    // Set up a vault by configuring wiki.path in global config
    const wikiPath = join(mockRoot, "wiki");
    mkdirSync(join(wikiPath, "inbox"), { recursive: true });
    mkdirSync(join(wikiPath, "areas", "daily"), { recursive: true });
    mkdirSync(join(wikiPath, "projects"), { recursive: true });
    mkdirSync(join(wikiPath, "resources"), { recursive: true });
    mkdirSync(join(wikiPath, "archives"), { recursive: true });
    mkdirSync(join(wikiPath, "patterns"), { recursive: true });
    mkdirSync(join(wikiPath, "templates"), { recursive: true });
    writeFileSync(join(mockRoot, "config"), `wiki.path=${wikiPath}\nwiki.enabled=true\n`);
    // Vault manifest required by isVaultInitialized()
    writeFileSync(
      join(wikiPath, ".mink-vault.json"),
      JSON.stringify({
        version: 1,
        path: wikiPath,
        createdAt: new Date().toISOString(),
      })
    );

    const { createNote } = await import("../../src/core/note-writer");

    const first = createNote({
      title: "API Auth Pattern",
      body: "first device's content",
      category: "patterns",
      tags: [],
    });
    const second = createNote({
      title: "API Auth Pattern",
      body: "second device's different content",
      category: "patterns",
      tags: [],
    });

    expect(first.filePath).not.toBe(second.filePath);
    expect(first.filePath.endsWith("api-auth-pattern.md")).toBe(true);
    expect(second.filePath).toMatch(/api-auth-pattern-[a-f0-9]+\.md$/);
    // Both files exist on disk with their respective content
    expect(readFileSync(first.filePath, "utf-8")).toContain(
      "first device's content"
    );
    expect(readFileSync(second.filePath, "utf-8")).toContain(
      "second device's different content"
    );
  });

  test("note re-save with identical content is a no-op (no suffix)", async () => {
    const wikiPath = join(mockRoot, "wiki");
    mkdirSync(join(wikiPath, "patterns"), { recursive: true });
    mkdirSync(join(wikiPath, "templates"), { recursive: true });
    writeFileSync(join(mockRoot, "config"), `wiki.path=${wikiPath}\nwiki.enabled=true\n`);
    writeFileSync(
      join(wikiPath, ".mink-vault.json"),
      JSON.stringify({
        version: 1,
        path: wikiPath,
        createdAt: new Date().toISOString(),
      })
    );

    const { createNote } = await import("../../src/core/note-writer");

    const fixedTime = "2026-04-15T10:00:00.000Z";
    const first = createNote({
      title: "Same Title",
      body: "same body",
      category: "patterns",
      tags: [],
      created: fixedTime,
    });
    const second = createNote({
      title: "Same Title",
      body: "same body",
      category: "patterns",
      tags: [],
      created: fixedTime,
    });

    // Idempotent re-save: same path, no suffix.
    expect(second.filePath).toBe(first.filePath);
  });
});
