export type SectionName =
  | "User Preferences"
  | "Key Learnings"
  | "Do-Not-Repeat"
  | "Decision Log";

export interface LearningMemory {
  projectName: string;
  sections: Record<SectionName, string[]>;
}

export interface ExtractedPattern {
  type: "literal" | "word-boundary";
  pattern: string;
  sourceEntry: string;
}

export interface PatternMatch {
  pattern: ExtractedPattern;
  matchedText: string;
  index: number;
}

export interface ReflectionResult {
  beforeTokens: number;
  afterTokens: number;
  mergedCount: number;
  trimmedCount: number;
  withinBudget: boolean;
}

export interface SeedInfo {
  projectName: string;
  description: string;
  frameworks: string[];
}

// ── Provenance / metadata sidecar ──────────────────────────────────────────

export type RuleSource = "user" | "llm:auto" | "llm:refined" | "reflection";

export interface RuleMeta {
  id: string;
  createdAt: string;
  source: RuleSource;
  confidence?: number;
  rationale?: string;
  sourceSessionIds?: string[];
}

export interface LearningMemoryMeta {
  version: 1;
  entries: Record<string, RuleMeta>;
}

// ── Pending suggestions inbox ──────────────────────────────────────────────

export type SuggestionStatus = "pending" | "accepted" | "rejected";

export interface SuggestedRule {
  id: string;
  section: SectionName;
  text: string;
  confidence: number;
  rationale: string;
  source: RuleSource;
  createdAt: string;
  sourceSessionIds: string[];
  status: SuggestionStatus;
}

export interface SuggestionsStore {
  version: 1;
  suggestions: SuggestedRule[];
}
