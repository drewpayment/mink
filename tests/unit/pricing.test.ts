import { describe, expect, test, afterEach } from "bun:test";
import {
  DEFAULT_PRICING_MODEL,
  MODEL_PRICING,
  dollarizeInputTokens,
  resolvePricing,
} from "../../src/core/pricing";

afterEach(() => {
  delete process.env.MINK_REPORT_MODEL;
  delete process.env.MINK_REPORT_INPUT_PRICE;
});

describe("dollarizeInputTokens", () => {
  test("1M tokens costs the per-1M rate", () => {
    expect(dollarizeInputTokens(1_000_000, 3)).toBeCloseTo(3, 6);
  });
  test("scales linearly", () => {
    expect(dollarizeInputTokens(500_000, 3)).toBeCloseTo(1.5, 6);
    expect(dollarizeInputTokens(0, 3)).toBe(0);
  });
});

describe("resolvePricing", () => {
  test("defaults to the default model at its table price", () => {
    const p = resolvePricing();
    expect(p.model).toBe(DEFAULT_PRICING_MODEL);
    expect(p.inputPer1M).toBe(MODEL_PRICING[DEFAULT_PRICING_MODEL].inputPer1M);
    expect(p.fellBack).toBe(false);
    expect(p.overridden).toBe(false);
  });

  test("honors report.model", () => {
    process.env.MINK_REPORT_MODEL = "claude-opus";
    const p = resolvePricing();
    expect(p.model).toBe("claude-opus");
    expect(p.inputPer1M).toBe(15);
  });

  test("report.input-price overrides the table", () => {
    process.env.MINK_REPORT_MODEL = "claude-opus";
    process.env.MINK_REPORT_INPUT_PRICE = "2.5";
    const p = resolvePricing();
    expect(p.inputPer1M).toBe(2.5);
    expect(p.overridden).toBe(true);
  });

  test("an unknown model falls back to the default price", () => {
    process.env.MINK_REPORT_MODEL = "not-a-model";
    const p = resolvePricing();
    expect(p.fellBack).toBe(true);
    expect(p.inputPer1M).toBe(MODEL_PRICING[DEFAULT_PRICING_MODEL].inputPer1M);
  });

  test("a non-numeric override is ignored", () => {
    process.env.MINK_REPORT_INPUT_PRICE = "abc";
    const p = resolvePricing();
    expect(p.overridden).toBe(false);
    expect(p.inputPer1M).toBe(MODEL_PRICING[DEFAULT_PRICING_MODEL].inputPer1M);
  });
});
