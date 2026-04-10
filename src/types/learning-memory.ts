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
