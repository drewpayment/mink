import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  projectDir,
  projectStateDir,
  tokenLedgerPath,
  tokenLedgerShardPath,
  tokenLedgerArchiveShardPath,
  bugMemoryPath,
  bugMemoryShardPath,
  actionLogPath,
  actionLogShardPath,
  learningMemoryPath,
  learningMemorySidecarPath,
} from "../../src/core/paths";
import {
  aggregateTokenLedger,
  aggregateTokenLedgerArchive,
  aggregateBugMemory,
  aggregateActionLog,
  aggregateLearningMemory,
} from "../../src/core/state-aggregator";
import type { TokenLedger, LedgerSession } from "../../src/types/token-ledger";
import type { BugMemory, BugEntry } from "../../src/types/bug-memory";

function makeSession(
  id: string,
  start: string,
  tokens: number = 100
): LedgerSession {
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

function ledgerWith(sessions: LedgerSession[]): TokenLedger {
  let lifetime = {
    totalTokens: 0,
    totalReads: 0,
    totalWrites: 0,
    totalSessions: 0,
    totalFileIndexHits: 0,
    totalFileIndexMisses: 0,
    totalRepeatedReads: 0,
    totalEstimatedSavings: 0,
  };
  for (const s of sessions) {
    lifetime.totalTokens += s.totals.estimatedTokens;
    lifetime.totalReads += s.totals.readCount;
    lifetime.totalWrites += s.totals.writeCount;
    lifetime.totalSessions += 1;
    lifetime.totalFileIndexHits += s.totals.fileIndexHits;
    lifetime.totalFileIndexMisses += s.totals.fileIndexMisses;
  }
  return { lifetime, sessions };
}

function bugEntry(id: string, overrides: Partial<BugEntry> = {}): BugEntry {
  return {
    id,
    createdAt: "2026-04-01T00:00:00.000Z",
    lastSeenAt: "2026-04-01T00:00:00.000Z",
    errorMessage: `error-${id}`,
    filePath: `/src/${id}.ts`,
    rootCause: "rc",
    fixDescription: "fix",
    tags: [],
    occurrenceCount: 1,
    relatedBugIds: [],
    ...overrides,
  };
}

let scratchCwd: string;
let pdir: string;
let sdir: string;

beforeEach(() => {
  scratchCwd = mkdtempSync(join(tmpdir(), "mink-aggregator-test-"));
  pdir = projectDir(scratchCwd);
  sdir = projectStateDir(scratchCwd);
  mkdirSync(pdir, { recursive: true });
});

afterEach(() => {
  if (existsSync(pdir)) rmSync(pdir, { recursive: true, force: true });
  if (existsSync(scratchCwd)) {
    rmSync(scratchCwd, { recursive: true, force: true });
  }
});

describe("aggregateTokenLedger", () => {
  test("returns empty ledger when no sources exist", () => {
    const result = aggregateTokenLedger(scratchCwd);
    expect(result.sessions).toEqual([]);
    expect(result.lifetime.totalSessions).toBe(0);
  });

  test("reads legacy non-sharded ledger", () => {
    writeFileSync(
      tokenLedgerPath(scratchCwd),
      JSON.stringify(
        ledgerWith([makeSession("s1", "2026-04-01T00:00:00.000Z", 100)]),
        null,
        2
      )
    );
    const result = aggregateTokenLedger(scratchCwd);
    expect(result.sessions.map((s) => s.sessionId)).toEqual(["s1"]);
    expect(result.lifetime.totalTokens).toBe(100);
  });

  test("merges multiple device shards plus legacy", () => {
    mkdirSync(join(sdir, "dev-A"), { recursive: true });
    mkdirSync(join(sdir, "dev-B"), { recursive: true });

    writeFileSync(
      tokenLedgerShardPath(scratchCwd, "dev-A"),
      JSON.stringify(
        ledgerWith([makeSession("s-a", "2026-04-02T00:00:00.000Z", 200)]),
        null,
        2
      )
    );
    writeFileSync(
      tokenLedgerShardPath(scratchCwd, "dev-B"),
      JSON.stringify(
        ledgerWith([makeSession("s-b", "2026-04-03T00:00:00.000Z", 300)]),
        null,
        2
      )
    );
    writeFileSync(
      tokenLedgerPath(scratchCwd),
      JSON.stringify(
        ledgerWith([makeSession("s-legacy", "2026-04-01T00:00:00.000Z", 50)]),
        null,
        2
      )
    );

    const result = aggregateTokenLedger(scratchCwd);
    expect(result.sessions.map((s) => s.sessionId)).toEqual([
      "s-legacy",
      "s-a",
      "s-b",
    ]);
    expect(result.lifetime.totalTokens).toBe(550);
    expect(result.lifetime.totalSessions).toBe(3);
  });

  test("dedupes sessions appearing in legacy AND a shard", () => {
    // This co-existence cannot happen in production (migration uses `git mv`
    // atomically). The aggregator dedupes session IDs in the sessions[] array
    // defensively; lifetime counters are summed from each source ledger as
    // persisted, so they may over-count in this synthetic case. We assert the
    // session-dedup behaviour only.
    mkdirSync(join(sdir, "dev-A"), { recursive: true });

    const dup = makeSession("s-shared", "2026-04-01T00:00:00.000Z", 100);
    writeFileSync(
      tokenLedgerShardPath(scratchCwd, "dev-A"),
      JSON.stringify(ledgerWith([dup]), null, 2)
    );
    writeFileSync(
      tokenLedgerPath(scratchCwd),
      JSON.stringify(ledgerWith([dup]), null, 2)
    );

    const result = aggregateTokenLedger(scratchCwd);
    expect(result.sessions.length).toBe(1);
  });

  test("preserves lifetime counters even when sessions are empty (post-archive)", () => {
    writeFileSync(
      tokenLedgerPath(scratchCwd),
      JSON.stringify(
        {
          lifetime: {
            totalTokens: 5000,
            totalReads: 100,
            totalWrites: 50,
            totalSessions: 3,
            totalFileIndexHits: 80,
            totalFileIndexMisses: 20,
            totalRepeatedReads: 5,
            totalEstimatedSavings: 1500,
          },
          sessions: [],
        },
        null,
        2
      )
    );
    const result = aggregateTokenLedger(scratchCwd);
    expect(result.sessions).toEqual([]);
    expect(result.lifetime.totalTokens).toBe(5000);
    expect(result.lifetime.totalSessions).toBe(3);
  });
});

describe("aggregateTokenLedgerArchive", () => {
  test("returns empty when no archives exist", () => {
    expect(aggregateTokenLedgerArchive(scratchCwd)).toEqual([]);
  });

  test("merges archive shards chronologically", () => {
    mkdirSync(join(sdir, "dev-A"), { recursive: true });
    mkdirSync(join(sdir, "dev-B"), { recursive: true });

    writeFileSync(
      tokenLedgerArchiveShardPath(scratchCwd, "dev-A"),
      JSON.stringify([makeSession("a1", "2026-03-01T00:00:00.000Z")], null, 2)
    );
    writeFileSync(
      tokenLedgerArchiveShardPath(scratchCwd, "dev-B"),
      JSON.stringify([makeSession("b1", "2026-02-01T00:00:00.000Z")], null, 2)
    );

    const result = aggregateTokenLedgerArchive(scratchCwd);
    expect(result.map((s) => s.sessionId)).toEqual(["b1", "a1"]);
  });
});

describe("aggregateBugMemory", () => {
  test("returns empty memory when no sources exist", () => {
    const result = aggregateBugMemory(scratchCwd);
    expect(result.entries).toEqual([]);
    expect(result.nextId).toBe(1);
  });

  test("unions entries across shards by id", () => {
    mkdirSync(join(sdir, "dev-A"), { recursive: true });
    mkdirSync(join(sdir, "dev-B"), { recursive: true });

    writeFileSync(
      bugMemoryShardPath(scratchCwd, "dev-A"),
      JSON.stringify(
        { entries: [bugEntry("bug-001"), bugEntry("bug-002")], nextId: 3 },
        null,
        2
      )
    );
    writeFileSync(
      bugMemoryShardPath(scratchCwd, "dev-B"),
      JSON.stringify(
        { entries: [bugEntry("bug-003")], nextId: 4 },
        null,
        2
      )
    );

    const result = aggregateBugMemory(scratchCwd);
    expect(result.entries.map((e) => e.id).sort()).toEqual([
      "bug-001",
      "bug-002",
      "bug-003",
    ]);
    expect(result.nextId).toBe(4);
  });

  test("merges duplicate entries: max occurrence, max lastSeen, min createdAt", () => {
    mkdirSync(join(sdir, "dev-A"), { recursive: true });
    mkdirSync(join(sdir, "dev-B"), { recursive: true });

    writeFileSync(
      bugMemoryShardPath(scratchCwd, "dev-A"),
      JSON.stringify(
        {
          entries: [
            bugEntry("bug-001", {
              createdAt: "2026-04-01T00:00:00.000Z",
              lastSeenAt: "2026-04-05T00:00:00.000Z",
              occurrenceCount: 3,
              tags: ["a"],
            }),
          ],
          nextId: 2,
        },
        null,
        2
      )
    );
    writeFileSync(
      bugMemoryShardPath(scratchCwd, "dev-B"),
      JSON.stringify(
        {
          entries: [
            bugEntry("bug-001", {
              createdAt: "2026-03-15T00:00:00.000Z",
              lastSeenAt: "2026-04-10T00:00:00.000Z",
              occurrenceCount: 2,
              tags: ["b"],
            }),
          ],
          nextId: 2,
        },
        null,
        2
      )
    );

    const result = aggregateBugMemory(scratchCwd);
    expect(result.entries.length).toBe(1);
    const merged = result.entries[0];
    expect(merged.occurrenceCount).toBe(3);
    expect(merged.lastSeenAt).toBe("2026-04-10T00:00:00.000Z");
    expect(merged.createdAt).toBe("2026-03-15T00:00:00.000Z");
    expect(merged.tags.sort()).toEqual(["a", "b"]);
  });
});

describe("aggregateActionLog", () => {
  test("returns empty when no sources", () => {
    expect(aggregateActionLog(scratchCwd)).toBe("");
  });

  test("concatenates session blocks chronologically across shards", () => {
    mkdirSync(join(sdir, "dev-A"), { recursive: true });
    mkdirSync(join(sdir, "dev-B"), { recursive: true });

    const sessionA = `\n### Session — 2026-04-02 10:00\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n| --- | --- | --- | --- | --- |\n| 10:00 | Session start | — | — | — |\n`;
    const sessionB = `\n### Session — 2026-04-01 09:00\n\n| Time | Action | File(s) | Outcome | ~Tokens |\n| --- | --- | --- | --- | --- |\n| 09:00 | Session start | — | — | — |\n`;

    writeFileSync(actionLogShardPath(scratchCwd, "dev-A"), sessionA);
    writeFileSync(actionLogShardPath(scratchCwd, "dev-B"), sessionB);

    const result = aggregateActionLog(scratchCwd);
    const idxB = result.indexOf("2026-04-01");
    const idxA = result.indexOf("2026-04-02");
    expect(idxB).toBeGreaterThanOrEqual(0);
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeLessThan(idxA);
  });
});

describe("aggregateLearningMemory", () => {
  test("returns empty memory when no canonical or sidecars", () => {
    const result = aggregateLearningMemory(scratchCwd);
    expect(result.projectName).toBe("unknown");
    expect(result.sections["User Preferences"]).toEqual([]);
  });

  test("merges canonical with sidecar entries, deduped", () => {
    writeFileSync(
      learningMemoryPath(scratchCwd),
      `# Learning Memory — my-project

## User Preferences
- prefers TypeScript

## Key Learnings

## Do-Not-Repeat

## Decision Log
- adopted ESM in 2026
`
    );
    writeFileSync(
      learningMemorySidecarPath(scratchCwd, "dev-A"),
      `# Learning Memory — my-project

## User Preferences
- Prefers TypeScript

## Key Learnings
- always atomic-write JSON

## Do-Not-Repeat

## Decision Log
`
    );

    const result = aggregateLearningMemory(scratchCwd);
    expect(result.projectName).toBe("my-project");
    expect(result.sections["User Preferences"]).toEqual(["prefers TypeScript"]);
    expect(result.sections["Key Learnings"]).toEqual([
      "always atomic-write JSON",
    ]);
    expect(result.sections["Decision Log"]).toEqual(["adopted ESM in 2026"]);
  });

  test("uses sidecar projectName when canonical is unknown", () => {
    writeFileSync(
      learningMemorySidecarPath(scratchCwd, "dev-A"),
      `# Learning Memory — only-in-sidecar

## User Preferences
- one
`
    );
    const result = aggregateLearningMemory(scratchCwd);
    expect(result.projectName).toBe("only-in-sidecar");
    expect(result.sections["User Preferences"]).toEqual(["one"]);
  });
});
