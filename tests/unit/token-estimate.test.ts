import { describe, expect, test } from "bun:test";
import { estimateTokens } from "../../src/core/token-estimate";

describe("estimateTokens", () => {
  test("uses code ratio (3.5) for .ts files", () => {
    const content = "a".repeat(350);
    expect(estimateTokens(content, "src/app.ts")).toBe(100);
  });

  test("uses code ratio (3.5) for .py files", () => {
    const content = "a".repeat(700);
    expect(estimateTokens(content, "main.py")).toBe(200);
  });

  test("uses prose ratio (4.0) for .md files", () => {
    const content = "a".repeat(400);
    expect(estimateTokens(content, "README.md")).toBe(100);
  });

  test("uses prose ratio (4.0) for .txt files", () => {
    const content = "a".repeat(200);
    expect(estimateTokens(content, "notes.txt")).toBe(50);
  });

  test("uses default ratio (3.75) for unknown extensions", () => {
    const content = "a".repeat(375);
    expect(estimateTokens(content, "data.csv")).toBe(100);
  });

  test("rounds up to nearest integer", () => {
    const content = "a".repeat(10);
    expect(estimateTokens(content, "tiny.ts")).toBe(3);
  });

  test("returns 0 for empty content", () => {
    expect(estimateTokens("", "empty.ts")).toBe(0);
  });

  test("handles uppercase extensions", () => {
    const content = "a".repeat(350);
    expect(estimateTokens(content, "APP.TS")).toBe(100);
  });

  test("handles .tsx as code", () => {
    const content = "a".repeat(350);
    expect(estimateTokens(content, "Component.tsx")).toBe(100);
  });

  test("handles .jsx as code", () => {
    const content = "a".repeat(350);
    expect(estimateTokens(content, "Component.jsx")).toBe(100);
  });

  test("handles .go as code", () => {
    const content = "a".repeat(350);
    expect(estimateTokens(content, "main.go")).toBe(100);
  });

  test("handles .rs as code", () => {
    const content = "a".repeat(350);
    expect(estimateTokens(content, "lib.rs")).toBe(100);
  });

  test("handles .mdx as prose", () => {
    const content = "a".repeat(400);
    expect(estimateTokens(content, "post.mdx")).toBe(100);
  });

  test("handles file with no extension using default ratio", () => {
    const content = "a".repeat(375);
    expect(estimateTokens(content, "Makefile")).toBe(100);
  });
});
