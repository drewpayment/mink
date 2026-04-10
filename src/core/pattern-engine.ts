import type { ExtractedPattern, PatternMatch } from "../types/learning-memory";

// Triggers for phrase-based word-boundary patterns
const PHRASE_TRIGGERS = [
  /never\s+use\s+/i,
  /\bavoid\s+/i,
];

// Stop characters/sequences that end a phrase
const PHRASE_STOP_RE = /[—–\-.]|\s+(?:in|for|with|on|by|from|to|when|if|because|since|after|before|during|until)\s+|$/;

export function extractPatterns(entries: string[]): ExtractedPattern[] {
  const results: ExtractedPattern[] = [];

  for (const entry of entries) {
    const quotedPatterns: ExtractedPattern[] = [];

    // 1. Extract quoted strings (double and single quotes)
    const quoteRe = /["']([^"']+)["']/g;
    let qMatch: RegExpExecArray | null;
    while ((qMatch = quoteRe.exec(entry)) !== null) {
      quotedPatterns.push({
        type: "literal",
        pattern: qMatch[1],
        sourceEntry: entry,
      });
    }

    results.push(...quotedPatterns);

    // 2. Extract phrase-based word-boundary patterns
    for (const triggerRe of PHRASE_TRIGGERS) {
      // Build a combined regex that finds the trigger and captures the rest
      const fullRe = new RegExp(triggerRe.source, "gi");
      let triggerMatch: RegExpExecArray | null;

      while ((triggerMatch = fullRe.exec(entry)) !== null) {
        const afterTrigger = entry.slice(triggerMatch.index + triggerMatch[0].length);

        // Remove any quoted portions from the remaining text before finding stop
        let cleaned = afterTrigger;
        // Replace quoted content with spaces to preserve indices
        cleaned = cleaned.replace(/["'][^"']*["']/g, (m) => " ".repeat(m.length));

        // Find stop position
        const stopMatch = PHRASE_STOP_RE.exec(cleaned);
        const phraseLength = stopMatch && stopMatch.index > 0 ? stopMatch.index : cleaned.length;

        let phrase = afterTrigger.slice(0, phraseLength).trim();

        // Remove quoted substrings from phrase
        phrase = phrase.replace(/["'][^"']*["']/g, "").trim();
        // Collapse multiple spaces
        phrase = phrase.replace(/\s+/g, " ").trim();

        if (phrase.length > 0) {
          results.push({
            type: "word-boundary",
            pattern: phrase,
            sourceEntry: entry,
          });
        }
      }
    }
  }

  return results;
}

export function matchPatterns(
  patterns: ExtractedPattern[],
  content: string
): PatternMatch[] {
  if (!content || patterns.length === 0) {
    return [];
  }

  const matches: PatternMatch[] = [];

  for (const pat of patterns) {
    if (pat.type === "literal") {
      // Case-sensitive includes check
      let idx = content.indexOf(pat.pattern);
      while (idx !== -1) {
        matches.push({
          pattern: pat,
          matchedText: pat.pattern,
          index: idx,
        });
        idx = content.indexOf(pat.pattern, idx + 1);
      }
    } else {
      // Word-boundary, case-insensitive
      const escaped = pat.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        matches.push({
          pattern: pat,
          matchedText: m[0],
          index: m.index,
        });
      }
    }
  }

  return matches;
}
