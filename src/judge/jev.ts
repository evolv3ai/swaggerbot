import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  type ChoiceCriteria,
  choice,
  noul,
  type Question,
  type RequestOptions,
  type SystemOneRequest,
} from "@typesafe-ai/sdk";
import { clampSpecExtract, type SpecExtract } from "../domain/spec-extract";
import {
  type ApiRef,
  type Judge,
  JudgeError,
  NONE,
  type SpecLink,
  type WhichApiJudgment,
  type YesNoJudgment,
  yesNo,
} from "./judge";

/** Wording of `whichApi`, a `choice` over the Candidates' ids plus `"none"`. */
export const WHICH_API_QUESTION = {
  instructions:
    "Someone asked for an API by the name in `name`. Which of the listed APIs does that name mean? Choose none if the name means none of them.",
  none: "None of the listed APIs: the name means a different API, or no API at all.",
};

/** The path in `IS_SPEC_LINK_QUESTION` that is replaced by each link's state path. */
export const LINK_PLACEHOLDER = "{link}";

/** Wording of `isSpecLink`, a `noul` per link over `{api, links}`. */
export const IS_SPEC_LINK_QUESTION = {
  instructions: `Does the link in \`${LINK_PLACEHOLDER}\` lead to an OpenAPI or Swagger document (a machine-readable description of an API, in JSON or YAML) that describes the API in \`api\`?`,
  criteria: {
    true: "The link is the OpenAPI or Swagger document for that API.",
    false:
      "The link is something else: a human-readable documentation page, a document for a different API, an SDK, or an unrelated page.",
  },
};

/** Wording of `specDescribesApi`, a `noul` over `{api, spec}`. */
export const SPEC_DESCRIBES_API_QUESTION = {
  instructions:
    "`spec` summarizes an OpenAPI or Swagger document: its title, the start of its description, its server hosts, some tags and paths, and how many paths it has. Does that document describe the API in `api`?",
  criteria: {
    true: "The document describes that API, in any version.",
    false:
      "The document describes a different API, an internal or test API, an example or tutorial API, or cannot be tied to that API.",
  },
};

type Answer =
  | { type: "noul"; noul: number }
  | {
      type: "choice";
      choice: string;
      confidence: number;
      probabilities: Readonly<Record<string, number>>;
    }
  | { type: "score" };

/** The part of `TypeSafeClient` the Jev judge uses; tests stub it. */
export type SystemOneClient = {
  systemOne(
    request: SystemOneRequest,
    options?: RequestOptions,
  ): PromiseLike<{ answers: Readonly<Record<string, Answer>> }>;
};

export type JevJudgeOptions = {
  /** Per attempt, in ms. Default 10 000. */
  timeoutMs?: number;
  /** Wait before the single retry on 429/5xx, in ms. Default 500. */
  retryDelayMs?: number;
};

/** A Judge backed by TypeSafe's Jev through `@typesafe-ai/sdk`. */
export class JevJudge implements Judge {
  readonly #client: SystemOneClient;
  readonly #timeoutMs: number;
  readonly #retryDelayMs: number;

  constructor(client: SystemOneClient, options: JevJudgeOptions = {}) {
    this.#client = client;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#retryDelayMs = options.retryDelayMs ?? 500;
  }

  async whichApi(
    name: string,
    candidates: ApiRef[],
  ): Promise<WhichApiJudgment> {
    if (candidates.length === 0) {
      return { probabilities: { [NONE]: 1 }, confidence: 1 };
    }
    const criteria: ChoiceCriteria = {};
    for (const c of candidates) {
      if (c.id === NONE || c.id in criteria) {
        throw new Error(`whichApi: duplicate or reserved Candidate id ${c.id}`);
      }
      criteria[c.id] = describeApi(c);
    }
    criteria[NONE] = WHICH_API_QUESTION.none;

    const answers = await this.#ask({
      state: { name },
      questions: { api: choice(WHICH_API_QUESTION.instructions, criteria) },
    });
    const answer = answers.api;
    if (answer?.type !== "choice") throw badResponse("api", answer);
    const probabilities: Record<string, number> = {};
    for (const label of Object.keys(criteria)) {
      probabilities[label] = probabilityOf(answer.probabilities[label] ?? 0);
    }
    return { probabilities, confidence: probabilityOf(answer.confidence) };
  }

  async isSpecLink(api: ApiRef, link: SpecLink): Promise<YesNoJudgment> {
    const [judgment] = await this.areSpecLinks(api, [link]);
    if (!judgment) throw badResponse("link0", undefined);
    return judgment;
  }

  async areSpecLinks(api: ApiRef, links: SpecLink[]): Promise<YesNoJudgment[]> {
    if (links.length === 0) return [];
    const questions: Record<string, Question> = {};
    links.forEach((_, i) => {
      questions[`link${i}`] = noul(
        IS_SPEC_LINK_QUESTION.instructions.replace(
          LINK_PLACEHOLDER,
          `links[${i}]`,
        ),
        IS_SPEC_LINK_QUESTION.criteria,
      );
    });
    const answers = await this.#ask({
      state: { api: describeApi(api), links: links.map(describeLink) },
      questions,
    });
    return links.map((_, i) => yesNoFrom(answers, `link${i}`));
  }

  async specDescribesApi(
    api: ApiRef,
    extract: SpecExtract,
  ): Promise<YesNoJudgment> {
    const answers = await this.#ask({
      state: { api: describeApi(api), spec: clampSpecExtract(extract) },
      questions: {
        describes: noul(
          SPEC_DESCRIBES_API_QUESTION.instructions,
          SPEC_DESCRIBES_API_QUESTION.criteria,
        ),
      },
    });
    return yesNoFrom(answers, "describes");
  }

  /** One `systemOne` call, retried once on 429/5xx. */
  async #ask(
    request: SystemOneRequest,
  ): Promise<Readonly<Record<string, Answer>>> {
    try {
      return await this.#attempt(request);
    } catch (err) {
      if (!isRetryable(err)) throw toJudgeError(err);
    }
    await new Promise((resolve) => setTimeout(resolve, this.#retryDelayMs));
    try {
      return await this.#attempt(request);
    } catch (err) {
      throw toJudgeError(err);
    }
  }

  async #attempt(
    request: SystemOneRequest,
  ): Promise<Readonly<Record<string, Answer>>> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new JudgeError(
            "timeout",
            `Jev did not answer within ${this.#timeoutMs} ms`,
          ),
        );
      }, this.#timeoutMs);
    });
    try {
      const response = await Promise.race([
        this.#client.systemOne(request, {
          signal: controller.signal,
          timeout: this.#timeoutMs,
          retry: { maxRetries: 0 },
        }),
        timeout,
      ]);
      return response.answers;
    } finally {
      clearTimeout(timer);
    }
  }
}

function describeApi(api: ApiRef) {
  return {
    name: api.name,
    vendor: api.vendor,
    ...(api.description ? { description: api.description } : {}),
  };
}

function describeLink(link: SpecLink) {
  return {
    url: link.url,
    text: link.text,
    ...(link.context ? { context: link.context } : {}),
  };
}

function yesNoFrom(
  answers: Readonly<Record<string, Answer>>,
  key: string,
): YesNoJudgment {
  const answer = answers[key];
  if (answer?.type !== "noul") throw badResponse(key, answer);
  return yesNo(probabilityOf(answer.noul));
}

function probabilityOf(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new JudgeError("bad-response", `Jev returned probability ${value}`);
  }
  return value;
}

function badResponse(key: string, answer: unknown): JudgeError {
  return new JudgeError(
    "bad-response",
    `Jev answer ${key} is missing or of the wrong type: ${JSON.stringify(answer)}`,
  );
}

function isRetryable(err: unknown): boolean {
  return err instanceof APIError && (err.status === 429 || err.status >= 500);
}

function toJudgeError(err: unknown): JudgeError {
  if (err instanceof JudgeError) return err;
  if (err instanceof APITimeoutError) {
    return new JudgeError("timeout", "Jev timed out", { cause: err });
  }
  if (err instanceof APIError) {
    return new JudgeError("http", `Jev returned HTTP ${err.status}`, {
      cause: err,
    });
  }
  if (err instanceof APIConnectionError) {
    return new JudgeError("network", "Could not reach Jev", { cause: err });
  }
  return new JudgeError("network", "Jev call failed", { cause: err });
}
