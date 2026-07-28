// `mink report` — dollarized ROI from Mink's holdout-verified measured savings
// (spec 27).

import { buildRoiReport, formatRoiReport } from "../core/roi-report";

const USAGE = `mink report — dollarized savings from measured (holdout-verified) compression (spec 27)

Usage: mink report [--json]
  --json   Emit the raw report as JSON

Pricing is configurable: set report.model (claude-sonnet|claude-opus|claude-haiku)
or override the exact rate with report.input-price (USD per 1M input tokens).`;

export function report(cwd: string, args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE + "\n");
    return;
  }
  const r = buildRoiReport(cwd);
  if (args.includes("--json")) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    return;
  }
  process.stdout.write(formatRoiReport(r));
}
