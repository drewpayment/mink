// Relevance judge interface (spec 25). A judge scores one query/candidate
// pair with the probability that the candidate answers the query. Providers
// live in core/judges/*; the reranker (core/rerank.ts) drives them.
//
// Import boundary: nothing reachable from a lifecycle hook may import this
// module (enforced by tests/unit/rerank-import-guard.test.ts).

/** Bump when the judging question wording changes: scores are not comparable across wordings. */
export const QUESTION_VERSION = "answers_query/v1";

export interface JudgeCandidate {
  path: string;
  title: string;
  tags: string[];
  excerpt: string;
}

export interface JudgeResult {
  /** Probability in [0, 1] that the candidate answers the query. */
  relevance: number;
  inputTokens?: number;
  /** Model the provider reports having used (falls back to the requested name). */
  model?: string;
}

export interface RelevanceJudge {
  /** The model name requested from the provider. */
  readonly modelVersion: string;
  readonly questionVersion: string;
  judge(query: string, candidate: JudgeCandidate, signal: AbortSignal): Promise<JudgeResult>;
}

export type JudgeErrorKind =
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "invalid"
  | "network"
  | "timeout"
  | "malformed"
  | "model";

export class JudgeError extends Error {
  readonly kind: JudgeErrorKind;
  readonly retryAfterMs?: number;

  constructor(kind: JudgeErrorKind, message?: string, opts: { retryAfterMs?: number } = {}) {
    super(message ?? `judge error: ${kind}`);
    this.name = "JudgeError";
    this.kind = kind;
    this.retryAfterMs = opts.retryAfterMs;
  }
}
