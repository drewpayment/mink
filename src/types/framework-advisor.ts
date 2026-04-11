// ── Framework Advisor Types (Spec 14) ─────────────────────────────────────

export type CssApproach =
  | "utility-first"
  | "css-in-js"
  | "css-modules"
  | "scoped"
  | "traditional"
  | "hybrid";

export type BundleSize = "tiny" | "small" | "medium" | "large";

export type LearningCurve = "low" | "moderate" | "steep";

export type AccessibilityRating = "basic" | "good" | "excellent";

export type TypescriptSupport = "native" | "supported" | "limited";

export interface FrameworkEntry {
  id: string;
  name: string;
  description: string;
  cssApproach: CssApproach;
  darkModeSupport: boolean;
  accessibilityRating: AccessibilityRating;
  bundleSize: BundleSize;
  learningCurve: LearningCurve;
  typescriptSupport: TypescriptSupport;
  designTokens: boolean;
  ecosystem: string;
  bestFor: string[];
  limitations: string[];
  officialUrl: string;
}

export interface DecisionTreeOption {
  label: string;
  value: string;
  nextNodeId: string | null;
  recommends?: string[];
}

export interface DecisionTreeNode {
  id: string;
  question: string;
  options: DecisionTreeOption[];
}

export const MIGRATION_SECTION_KEYS = [
  "install",
  "configure",
  "migrate-components",
  "migrate-styles",
  "gotchas",
  "verification",
] as const;

export type MigrationSectionKey = (typeof MIGRATION_SECTION_KEYS)[number];

export interface MigrationPromptSection {
  key: MigrationSectionKey;
  content: string;
}

export interface MigrationPrompt {
  frameworkId: string;
  sections: MigrationPromptSection[];
}

export interface FrameworkAdvisorKnowledge {
  version: string;
  generatedAt: string;
  frameworks: FrameworkEntry[];
  decisionTree: DecisionTreeNode[];
  migrationPrompts: MigrationPrompt[];
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Type Guard ────────────────────────────────────────────────────────────

export function isFrameworkAdvisorKnowledge(
  v: unknown
): v is FrameworkAdvisorKnowledge {
  return (
    typeof v === "object" &&
    v !== null &&
    "version" in v &&
    "frameworks" in v &&
    "decisionTree" in v &&
    "migrationPrompts" in v &&
    Array.isArray((v as FrameworkAdvisorKnowledge).frameworks)
  );
}
