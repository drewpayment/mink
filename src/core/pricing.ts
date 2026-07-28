// Token pricing for the ROI report (spec 27). Published USD list prices per 1M
// tokens, used to dollarize measured token savings. Overridable via config so a
// user can pin their own negotiated/enterprise rate. Pure and deterministic.

import { resolveConfigValue } from "./global-config";

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

// Indicative public list prices (USD / 1M tokens). These are a reasonable
// default; the exact figure is user-overridable via `report.input-price`.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-sonnet": { inputPer1M: 3, outputPer1M: 15 },
  "claude-opus": { inputPer1M: 15, outputPer1M: 75 },
  "claude-haiku": { inputPer1M: 0.8, outputPer1M: 4 },
};

export const DEFAULT_PRICING_MODEL = "claude-sonnet";

export interface ResolvedPricing {
  model: string;
  inputPer1M: number;
  /** True when the model name was unknown and the default table entry was used. */
  fellBack: boolean;
  /** True when the input price came from an explicit config override. */
  overridden: boolean;
}

/**
 * Resolve the input price per 1M tokens. Precedence:
 *   1. `report.input-price` config override (a positive number), if set;
 *   2. the `report.model` table entry;
 *   3. the default model, when `report.model` is unknown.
 */
export function resolvePricing(): ResolvedPricing {
  const model = resolveConfigValue("report.model").value || DEFAULT_PRICING_MODEL;
  const overrideRaw = resolveConfigValue("report.input-price").value;
  const override = Number(overrideRaw);

  if (overrideRaw && Number.isFinite(override) && override > 0) {
    return { model, inputPer1M: override, fellBack: false, overridden: true };
  }

  const entry = MODEL_PRICING[model];
  if (entry) {
    return { model, inputPer1M: entry.inputPer1M, fellBack: false, overridden: false };
  }
  return {
    model: DEFAULT_PRICING_MODEL,
    inputPer1M: MODEL_PRICING[DEFAULT_PRICING_MODEL].inputPer1M,
    fellBack: true,
    overridden: false,
  };
}

/** Dollar value of `tokens` at the given input price per 1M tokens. */
export function dollarizeInputTokens(tokens: number, inputPer1M: number): number {
  return (tokens / 1_000_000) * inputPer1M;
}
