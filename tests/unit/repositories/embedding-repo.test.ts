import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { EmbeddingRepo, hashContent } from "../../../src/repositories/embedding-repo";
import { openProjectDb, _resetDbCacheForTests } from "../../../src/storage/db";
import { projectIdFor } from "../../../src/core/project-id";

const f = (...xs: number[]) => Float32Array.from(xs);
const MODEL = "test-model";

let tmpRoot: string;
let cwd: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "mink-emb-"));
  process.env.MINK_ROOT_OVERRIDE = tmpRoot;
  cwd = mkdtempSync(join(tmpdir(), "mink-emb-cwd-"));
  mkdirSync(join(tmpRoot, "projects", projectIdFor(cwd)), { recursive: true });
});

afterEach(() => {
  _resetDbCacheForTests();
  delete process.env.MINK_ROOT_OVERRIDE;
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { rmSync(cwd, { recursive: true, force: true }); } catch { /* ignore */ }
});

function repo() {
  return new EmbeddingRepo(openProjectDb(cwd));
}

describe("EmbeddingRepo", () => {
  test("upsert then search ranks by cosine similarity", () => {
    const r = repo();
    r.upsert({ kind: "bug", refId: "a", model: MODEL, contentHash: "h1", vector: f(1, 0, 0) });
    r.upsert({ kind: "bug", refId: "b", model: MODEL, contentHash: "h2", vector: f(0, 1, 0) });
    r.upsert({ kind: "bug", refId: "c", model: MODEL, contentHash: "h3", vector: f(0.9, 0.1, 0) });

    const hits = r.search("bug", MODEL, f(1, 0, 0), 2);
    expect(hits.map((h) => h.refId)).toEqual(["a", "c"]);
    expect(hits[0].score).toBeCloseTo(1, 6);
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  test("search honors minScore", () => {
    const r = repo();
    r.upsert({ kind: "bug", refId: "a", model: MODEL, contentHash: "h", vector: f(1, 0) });
    r.upsert({ kind: "bug", refId: "b", model: MODEL, contentHash: "h", vector: f(0, 1) });
    const hits = r.search("bug", MODEL, f(1, 0), 10, 0.5);
    expect(hits.map((h) => h.refId)).toEqual(["a"]); // b scores 0, filtered out
  });

  test("search filters by kind and model", () => {
    const r = repo();
    r.upsert({ kind: "bug", refId: "a", model: MODEL, contentHash: "h", vector: f(1, 0) });
    r.upsert({ kind: "note", refId: "n", model: MODEL, contentHash: "h", vector: f(1, 0) });
    r.upsert({ kind: "bug", refId: "old", model: "other-model", contentHash: "h", vector: f(1, 0) });

    const hits = r.search("bug", MODEL, f(1, 0), 10);
    expect(hits.map((h) => h.refId)).toEqual(["a"]);
  });

  test("upsert replaces the vector for the same (kind, ref, model)", () => {
    const r = repo();
    r.upsert({ kind: "bug", refId: "a", model: MODEL, contentHash: "h1", vector: f(1, 0) });
    r.upsert({ kind: "bug", refId: "a", model: MODEL, contentHash: "h2", vector: f(0, 1) });
    expect(r.countForModel("bug", MODEL)).toBe(1);
    const hits = r.search("bug", MODEL, f(0, 1), 1);
    expect(hits[0].score).toBeCloseTo(1, 6);
  });

  test("hasFresh reflects content hash", () => {
    const r = repo();
    r.upsert({ kind: "bug", refId: "a", model: MODEL, contentHash: "h1", vector: f(1, 0) });
    expect(r.hasFresh("bug", "a", MODEL, "h1")).toBe(true);
    expect(r.hasFresh("bug", "a", MODEL, "h2")).toBe(false); // text changed
    expect(r.hasFresh("bug", "a", "other", "h1")).toBe(false); // model changed
  });

  test("deleteForRef removes all model rows for a ref", () => {
    const r = repo();
    r.upsert({ kind: "bug", refId: "a", model: MODEL, contentHash: "h", vector: f(1, 0) });
    r.upsert({ kind: "bug", refId: "a", model: "other", contentHash: "h", vector: f(1, 0) });
    r.deleteForRef("bug", "a");
    expect(r.countForModel("bug", MODEL)).toBe(0);
    expect(r.countForModel("bug", "other")).toBe(0);
  });

  test("vectors survive the BLOB round-trip through SQLite", () => {
    const r = repo();
    const v = f(0.123, -0.456, 0.789, 1, -1);
    r.upsert({ kind: "bug", refId: "a", model: MODEL, contentHash: "h", vector: v });
    // A query equal to the stored vector must score ~1.
    const hits = r.search("bug", MODEL, v, 1);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });
});

describe("hashContent", () => {
  test("is deterministic and differs by input", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });
});
