import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { atomicWriteJson, atomicWriteText, safeReadJson } from "../../src/core/fs-utils";

describe("atomicWriteJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes valid JSON to file", () => {
    const filePath = join(dir, "test.json");
    atomicWriteJson(filePath, { key: "value" });
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content).toEqual({ key: "value" });
  });

  test("overwrites existing file", () => {
    const filePath = join(dir, "test.json");
    atomicWriteJson(filePath, { version: 1 });
    atomicWriteJson(filePath, { version: 2 });
    const content = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(content).toEqual({ version: 2 });
  });

  test("does not leave .tmp file on success", () => {
    const filePath = join(dir, "test.json");
    atomicWriteJson(filePath, { key: "value" });
    const files = Bun.file(filePath + ".tmp");
    expect(files.size).toBe(0);
  });
});

describe("atomicWriteText", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes text content to file", () => {
    const filePath = join(dir, "test.md");
    atomicWriteText(filePath, "hello world");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("hello world");
  });

  test("overwrites existing file", () => {
    const filePath = join(dir, "test.md");
    atomicWriteText(filePath, "first content");
    atomicWriteText(filePath, "second content");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("second content");
  });

  test("creates parent directories if they do not exist", () => {
    const filePath = join(dir, "nested", "deep", "test.md");
    atomicWriteText(filePath, "nested content");
    const content = readFileSync(filePath, "utf-8");
    expect(content).toBe("nested content");
  });

  test("does not leave .tmp file on success", () => {
    const filePath = join(dir, "test.md");
    atomicWriteText(filePath, "data");
    const tmpFile = Bun.file(filePath + ".tmp");
    expect(tmpFile.size).toBe(0);
  });
});

describe("safeReadJson", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mink-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("reads valid JSON file", () => {
    const filePath = join(dir, "test.json");
    writeFileSync(filePath, JSON.stringify({ key: "value" }));
    const result = safeReadJson(filePath);
    expect(result).toEqual({ key: "value" });
  });

  test("returns null for missing file", () => {
    const result = safeReadJson(join(dir, "nope.json"));
    expect(result).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    const filePath = join(dir, "bad.json");
    writeFileSync(filePath, "not json {{{");
    const result = safeReadJson(filePath);
    expect(result).toBeNull();
  });
});
