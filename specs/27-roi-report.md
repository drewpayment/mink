# 27 — ROI Report

## Overview

Mink measures its own token savings honestly: a configurable fraction of
otherwise-eligible tool outputs is left uncompressed as a holdout, and reported
savings are the measured difference between original and compressed token counts,
not a per-event estimate. That measured figure is trustworthy but under-surfaced.

This capability turns it into a credible, shareable ROI statement: it dollarizes
the measured savings at a configurable model's input price and presents it
alongside its holdout basis, while keeping the separate heuristic (index-hit)
estimate clearly labeled as an estimate — so the credible number is never
conflated with the guess.

## Capabilities

### Measured Savings, Dollarized

- The report states the measured, holdout-verified token savings and their dollar
  value at a configurable input price, and always states the holdout basis
  (the holdout fraction and the compressed/holdout event counts).
- It reports the average compression ratio over compressed arms.
- The heuristic (index-hit) estimate is reported separately and explicitly
  labeled as not measured.

### Pricing

- Pricing is configurable: a model selector maps to a built-in table of input
  prices, and an explicit override sets the exact input price per million tokens.
- An unknown model selector falls back to a default price, and the fallback is
  disclosed in the report.

### Surfaces

- The report is available as a command, in both a human-readable form and a
  machine-readable form.

## Acceptance Criteria

```
GIVEN measured compression savings of N tokens and an input price of P per 1M
WHEN the report is produced
THEN the reported dollar value equals N / 1,000,000 × P

GIVEN both compressed and holdout events have been recorded
WHEN the report is produced
THEN it states the measured savings, the holdout fraction, and the compressed
     and holdout event counts

GIVEN a heuristic (index-hit) estimate exists
WHEN the report is produced
THEN the estimate is shown separately and labeled as not measured

GIVEN an explicit input-price override is configured
WHEN the report is produced
THEN the override price is used and disclosed

GIVEN an unknown pricing model is configured
WHEN the report is produced
THEN a default price is used and the fallback is disclosed

GIVEN no compression has been measured
WHEN the report is produced
THEN it states plainly that nothing has been measured yet
```

## Edge Cases

- No compression measured — state it plainly; dollar value is zero.
- Only holdout events recorded — measured savings are zero (holdout arms save
  nothing by construction).
- Non-numeric or non-positive price override — ignored in favor of the table.
- Zero original tokens — the compression ratio is zero, not a division error.

## Prompt-Cache Stability

- The report is derived deterministically from stored aggregates; identical
  inputs produce an identical report.

## Test Requirements

- Unit: dollarization math; pricing resolution (default, model selector,
  override, unknown-model fallback, non-numeric override ignored).
- Unit: report assembly from recorded compressed and holdout arms — measured
  savings, dollar value, holdout fraction, compressed/holdout counts, compression
  ratio; empty-ledger case; the human form cites the dollar figure, the model,
  and the holdout basis, and labels the heuristic estimate as not measured.
