import type { SpecExtract } from "../domain/spec-extract";

export type { SpecExtract } from "../domain/spec-extract";

/** An API as a Judge sees it: a Candidate, or the API a Lookup has identified. */
export type ApiRef = {
  id: string;
  name: string;
  /** The Vendor's name. */
  vendor: string;
  description?: string;
};

/** A link found on a page (or a document) that may be the Spec for an API. */
export type SpecLink = {
  url: string;
  /** The link's anchor text, or the document's title. */
  text: string;
  /** Text around the link, e.g. the heading or sentence it sits in. */
  context?: string;
};

/** The label `whichApi` uses for "none of the Candidates". */
export const NONE = "none";

export type WhichApiJudgment = {
  /** Probability per Candidate id, plus `"none"`; sums to about 1. */
  probabilities: Record<string, number>;
  /** How concentrated the distribution is, 0..1. */
  confidence: number;
};

export type YesNoJudgment = {
  /** Probability of yes, 0..1. */
  probability: number;
  /** Probability of the more likely answer, `max(p, 1 - p)`, 0..1. */
  confidence: number;
};

/**
 * The narrow semantic judgments of ADR 0001. Code retrieves Candidates; a
 * Judge only weighs them. Every probability is in 0..1.
 */
export interface Judge {
  /** Which of the Candidates the name means, or `"none"` of them. */
  whichApi(name: string, candidates: ApiRef[]): Promise<WhichApiJudgment>;
  /** Whether this link or document is the Spec for the API. */
  isSpecLink(api: ApiRef, link: SpecLink): Promise<YesNoJudgment>;
  /** `isSpecLink` for several links at once, answered in order. */
  areSpecLinks(api: ApiRef, links: SpecLink[]): Promise<YesNoJudgment[]>;
  /** Whether the Spec, seen through its extract, describes the API. */
  specDescribesApi(api: ApiRef, extract: SpecExtract): Promise<YesNoJudgment>;
}

/** Why a Judge could not answer. */
export type JudgeErrorKind = "timeout" | "http" | "network" | "bad-response";

export class JudgeError extends Error {
  readonly kind: JudgeErrorKind;

  constructor(kind: JudgeErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "JudgeError";
    this.kind = kind;
  }
}

export function yesNo(probability: number): YesNoJudgment {
  return { probability, confidence: Math.max(probability, 1 - probability) };
}
