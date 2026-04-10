# 14 — Framework Advisor

## Overview

The framework advisor is a knowledge-driven decision system that helps users select UI component frameworks. It contains a curated database of frameworks with comparison criteria, a decision tree for recommendation, and framework-specific migration prompts. It operates as a knowledge file the AI assistant reads — not a CLI command.

## Capabilities

### Knowledge Base

The framework advisor must maintain a curated database covering:

1. **Framework catalog** — For each supported framework:
   - Name, description, and primary use case.
   - Key strengths and limitations.
   - Styling approach (utility-first, CSS-in-JS, tokens, etc.).
   - Theming support (dark mode, design tokens, brand customization).
   - Accessibility level (WCAG compliance, built-in ARIA support).
   - Bundle size impact.
   - Community size and maintenance status.
   - Learning curve.

2. **Comparison matrix** — Side-by-side comparison of all frameworks across key dimensions.

3. **Decision tree** — A structured set of questions that narrows the recommendation:
   - What is the current styling approach?
   - Is design system fidelity or rapid prototyping more important?
   - How important is bundle size?
   - Is dark mode required?
   - What level of accessibility compliance is needed?
   - Is the project greenfield or migrating?

### Recommendation Workflow

When the user asks about framework selection:

1. AI reads the framework advisor knowledge file.
2. AI asks the user targeted questions from the decision tree.
3. Based on answers, AI recommends 1-2 frameworks with reasoning.
4. On confirmation, AI uses the framework-specific migration prompt to execute the change.

### Migration Prompts

Each framework must have a migration prompt that covers:

- Installation and setup steps.
- Configuration requirements.
- How to convert existing components to use the new framework.
- Common patterns and component mappings.
- Known gotchas and workarounds.

### Integration with Design Evaluation

After a framework migration, the design evaluation (spec 13) can be used to:

1. Capture the new look.
2. Compare against pre-migration screenshots.
3. Verify visual consistency and identify regressions.

## Acceptance Criteria

```
GIVEN the user asks "which UI framework should I use?"
WHEN the AI reads the framework advisor
THEN it asks targeted questions from the decision tree
AND narrows to 1-2 recommendations based on answers

GIVEN the user answers: "utility-first CSS, dark mode required, accessibility important"
WHEN the AI processes the decision tree
THEN the recommendation prioritizes frameworks matching those criteria
AND includes reasoning for why other frameworks were excluded

GIVEN the user confirms a framework choice
WHEN the AI reads the framework-specific migration prompt
THEN it provides step-by-step guidance for installation, configuration, and component conversion

GIVEN the framework database contains 12+ frameworks
WHEN the comparison matrix is requested
THEN all frameworks appear with ratings across all comparison dimensions

GIVEN a framework migration is complete
WHEN the user runs design evaluation
THEN new screenshots can be compared against pre-migration captures
```

## Edge Cases

- User's project uses a framework not in the database — suggest closest alternative and note the gap.
- User wants to combine two frameworks — advise on compatibility if known, otherwise flag potential conflicts.
- Decision tree reaches a tie between frameworks — present both with tradeoff analysis, let user choose.
- Framework data becomes outdated — note last-updated date in the knowledge file; recommend verifying version/feature changes.

## Test Requirements

- Unit: Decision tree traversal produces correct recommendations for known input combinations.
- Unit: All frameworks in the catalog have complete metadata (no missing dimensions).
- Unit: Migration prompts for each framework contain required sections (install, configure, migrate, gotchas).
- Integration: Full workflow — questions → answers → recommendation → migration prompt selection.
- Edge: Unknown framework input handled gracefully.
