import type { SpecExtract } from "../domain/spec-extract";
import {
  type ApiRef,
  type Judge,
  NONE,
  type SpecLink,
  type WhichApiJudgment,
  type YesNoJudgment,
} from "./judge";

export type FakeJudgeScript = {
  /** Answers keyed by the name asked about. */
  whichApi?: Record<string, WhichApiJudgment>;
  /** Answers keyed by link url. */
  isSpecLink?: Record<string, YesNoJudgment>;
  /** Answers keyed by the extract's `title`. */
  specDescribesApi?: Record<string, YesNoJudgment>;
  /**
   * Answers for anything not scripted. Unless set: `whichApi` says `"none"`
   * with certainty, and the yes/no judgments say no with certainty.
   */
  defaults?: {
    whichApi?: WhichApiJudgment;
    isSpecLink?: YesNoJudgment;
    specDescribesApi?: YesNoJudgment;
  };
};

export type FakeJudgeCall =
  | { judgment: "whichApi"; name: string; candidates: ApiRef[] }
  | { judgment: "isSpecLink"; api: ApiRef; link: SpecLink }
  | { judgment: "specDescribesApi"; api: ApiRef; extract: SpecExtract };

const NO: YesNoJudgment = { probability: 0, confidence: 1 };

/** A Judge with scripted answers, for tests. It never calls TypeSafe. */
export class FakeJudge implements Judge {
  /** Every judgment asked, in order; `areSpecLinks` records one per link. */
  readonly calls: FakeJudgeCall[] = [];
  readonly #script: FakeJudgeScript;

  constructor(script: FakeJudgeScript = {}) {
    this.#script = script;
  }

  async whichApi(
    name: string,
    candidates: ApiRef[],
  ): Promise<WhichApiJudgment> {
    this.calls.push({ judgment: "whichApi", name, candidates });
    const answer =
      this.#script.whichApi?.[name] ?? this.#script.defaults?.whichApi;
    if (answer) return answer;
    const probabilities: Record<string, number> = { [NONE]: 1 };
    for (const c of candidates) probabilities[c.id] = 0;
    return { probabilities, confidence: 1 };
  }

  async isSpecLink(api: ApiRef, link: SpecLink): Promise<YesNoJudgment> {
    this.calls.push({ judgment: "isSpecLink", api, link });
    return (
      this.#script.isSpecLink?.[link.url] ??
      this.#script.defaults?.isSpecLink ??
      NO
    );
  }

  async areSpecLinks(api: ApiRef, links: SpecLink[]): Promise<YesNoJudgment[]> {
    return Promise.all(links.map((link) => this.isSpecLink(api, link)));
  }

  async specDescribesApi(
    api: ApiRef,
    extract: SpecExtract,
  ): Promise<YesNoJudgment> {
    this.calls.push({ judgment: "specDescribesApi", api, extract });
    return (
      this.#script.specDescribesApi?.[extract.title] ??
      this.#script.defaults?.specDescribesApi ??
      NO
    );
  }
}
