// ROI report (spec 27). Converts Mink's honest, holdout-verified measured token
// savings into a dollar figure, and reports the heuristic estimate separately —
// clearly labeled — so the credible number is never conflated with the estimate.

import { TokenLedgerRepo } from "../repositories/token-ledger-repo";
import { dollarizeInputTokens, resolvePricing } from "./pricing";

export interface RoiReport {
  // Measured (holdout-verified) compression savings — the credible number.
  measuredSavingsTokens: number;
  measuredDollars: number;
  compressionEvents: number;
  holdoutEvents: number;
  holdoutFraction: number;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number; // 1 - compressed/original over compressed arms
  // Heuristic (index-hit) savings — an estimate, not measured.
  estimatedSavingsTokens: number;
  // Pricing basis.
  model: string;
  inputPricePer1M: number;
  pricingFellBack: boolean;
  pricingOverridden: boolean;
}

export function buildRoiReport(cwd: string): RoiReport {
  const repo = TokenLedgerRepo.for(cwd);
  const life = repo.lifetime();
  const comp = repo.compressionLifetime();
  const pricing = resolvePricing();

  // total_events counts every arm; compressed-only = total − holdout.
  const compressedEvents = comp.totalEvents - comp.totalHoldoutEvents;
  const holdoutFraction = comp.totalEvents > 0 ? comp.totalHoldoutEvents / comp.totalEvents : 0;
  const compressionRatio =
    comp.totalOriginalTokens > 0
      ? 1 - comp.totalCompressedTokens / comp.totalOriginalTokens
      : 0;

  return {
    measuredSavingsTokens: comp.totalMeasuredSavings,
    measuredDollars: dollarizeInputTokens(comp.totalMeasuredSavings, pricing.inputPer1M),
    compressionEvents: compressedEvents,
    holdoutEvents: comp.totalHoldoutEvents,
    holdoutFraction,
    originalTokens: comp.totalOriginalTokens,
    compressedTokens: comp.totalCompressedTokens,
    compressionRatio,
    estimatedSavingsTokens: life.totalEstimatedSavings,
    model: pricing.model,
    inputPricePer1M: pricing.inputPer1M,
    pricingFellBack: pricing.fellBack,
    pricingOverridden: pricing.overridden,
  };
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Human-readable report. Always states the holdout basis for the measured figure. */
export function formatRoiReport(r: RoiReport): string {
  const lines: string[] = ["Mink ROI (lifetime)", ""];

  if (r.compressionEvents + r.holdoutEvents === 0) {
    lines.push("No compression measured yet — enable tool-output compression to accrue savings.");
  } else {
    const pct = (r.holdoutFraction * 100).toFixed(1);
    lines.push(
      `Measured savings: ${fmtTokens(r.measuredSavingsTokens)} tokens ≈ ${fmtUsd(r.measuredDollars)} ` +
        `at ${r.model} input pricing ($${r.inputPricePer1M}/1M)`
    );
    lines.push(
      `  verified against a ${pct}% holdout · ${r.compressionEvents} compressed / ` +
        `${r.holdoutEvents} holdout events · ` +
        `${(r.compressionRatio * 100).toFixed(0)}% average reduction`
    );
    if (r.pricingOverridden) lines.push("  (input price from your report.input-price override)");
    if (r.pricingFellBack) lines.push("  (unknown report.model — used the default price)");
  }

  lines.push("");
  lines.push(
    `Heuristic estimate (not measured): ${fmtTokens(r.estimatedSavingsTokens)} tokens from index hits`
  );
  return lines.join("\n") + "\n";
}
