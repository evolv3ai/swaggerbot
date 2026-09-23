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
import { SPEC_EXTRACT_LIMITS, type SpecExtract } from "../domain/spec-extract";
import {
  type ApiRef,
  type Judge,
  JudgeError,
  NONE,
  type SpecLink,
  type VendorRef,
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

/**
 * The path in `IS_SPEC_LINK_QUESTION` and `IS_VENDOR_API_LINK_QUESTION` that
 * is replaced by each link's state path.
 */
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

/** Wording of `isVendorName`, a `noul` over `{name, vendor}`. */
export const IS_VENDOR_NAME_QUESTION = {
  instructions:
    "Someone asked for an API by the name in `name`. Does that name refer to the company in `vendor` as a whole, rather than to one of its APIs or products?",
  criteria: {
    true: "The name is the company's own name: it means the company as a whole, which offers several APIs.",
    false:
      "The name means one specific API or product of the company, or a different company or thing altogether.",
  },
};

/** Wording of `isVendorApiLink`, a `noul` per link over `{vendor, links}`. */
export const IS_VENDOR_API_LINK_QUESTION = {
  instructions: `Does the link in \`${LINK_PLACEHOLDER}\`, found on the developer portal of the company in \`vendor\`, name one of that company's distinct APIs?`,
  criteria: {
    true: "The link names one distinct API the company offers, such as its Marketing API or its Transactional API.",
    false:
      "The link is something else: a guide or tutorial, a pricing page, an SDK or client library, a changelog, the portal's own navigation, or a page not about one API.",
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

/**
 * How much of a payload's free text (descriptions, link text and context) a
 * call sends: all of it, shortened by `shortenFreeText`, or none. Cloudflare's
 * WAF in front of TypeSafe blocks some vendor descriptions (shell examples
 * with `curl`), so a blocked call is retried with less.
 */
export type FreeText = "full" | "shortened" | "omitted";

const FREE_TEXT_STEPS: readonly FreeText[] = ["full", "shortened", "omitted"];

/** Longest free-text field a shortened call sends. */
export const SHORTENED_FREE_TEXT_LENGTH = 300;

/**
 * A free-text field cut down for a call Cloudflare blocked: its first
 * paragraph (up to the first blank line or code fence), without any line
 * containing `curl `, then its first 300 characters. `undefined` when
 * nothing is left.
 */
export function shortenFreeText(text: string): string | undefined {
  const [paragraph = ""] = text.split(/\n[ \t]*\n|```/);
  const shortened = paragraph
    .split("\n")
    .filter((line) => !line.includes("curl "))
    .join("\n")
    .trim()
    .slice(0, SHORTENED_FREE_TEXT_LENGTH)
    .trim();
  return shortened || undefined;
}

/** Apply a `FreeText` level to one free-text field. */
function reduceFreeText(
  text: string | null | undefined,
  level: FreeText,
): string | undefined {
  if (!text || level === "omitted") return undefined;
  return level === "shortened" ? shortenFreeText(text) : text;
}

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
    const ids = new Set<string>();
    for (const c of candidates) {
      if (c.id === NONE || ids.has(c.id)) {
        throw new Error(`whichApi: duplicate or reserved Candidate id ${c.id}`);
      }
      ids.add(c.id);
    }

    const answers = await this.#ask((freeText) => {
      const criteria: ChoiceCriteria = {};
      for (const c of candidates) criteria[c.id] = describeApi(c, freeText);
      criteria[NONE] = WHICH_API_QUESTION.none;
      return {
        state: { name },
        questions: { api: choice(WHICH_API_QUESTION.instructions, criteria) },
      };
    });
    const answer = answers.api;
    if (answer?.type !== "choice") throw badResponse("api", answer);
    const probabilities: Record<string, number> = {};
    for (const label of [...ids, NONE]) {
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
    const answers = await this.#ask((freeText) => ({
      state: {
        api: describeApi(api, freeText),
        links: links.map((link) => describeLink(link, freeText)),
      },
      questions,
    }));
    return links.map((_, i) => yesNoFrom(answers, `link${i}`));
  }

  async specDescribesApi(
    api: ApiRef,
    extract: SpecExtract,
  ): Promise<YesNoJudgment> {
    const answers = await this.#ask((freeText) => ({
      state: {
        api: describeApi(api, freeText),
        spec: describeSpecExtract(extract, freeText),
      },
      questions: {
        describes: noul(
          SPEC_DESCRIBES_API_QUESTION.instructions,
          SPEC_DESCRIBES_API_QUESTION.criteria,
        ),
      },
    }));
    return yesNoFrom(answers, "describes");
  }

  async isVendorName(name: string, vendor: VendorRef): Promise<YesNoJudgment> {
    // No free text to reduce: a Vendor is sent as its id and name only.
    const answers = await this.#ask(() => ({
      state: { name, vendor: { id: vendor.id, name: vendor.name } },
      questions: {
        vendor: noul(
          IS_VENDOR_NAME_QUESTION.instructions,
          IS_VENDOR_NAME_QUESTION.criteria,
        ),
      },
    }));
    return yesNoFrom(answers, "vendor");
  }

  async isVendorApiLink(
    vendor: VendorRef,
    link: SpecLink,
  ): Promise<YesNoJudgment> {
    const [judgment] = await this.areVendorApiLinks(vendor, [link]);
    if (!judgment) throw badResponse("link0", undefined);
    return judgment;
  }

  async areVendorApiLinks(
    vendor: VendorRef,
    links: SpecLink[],
  ): Promise<YesNoJudgment[]> {
    if (links.length === 0) return [];
    const questions: Record<string, Question> = {};
    links.forEach((_, i) => {
      questions[`link${i}`] = noul(
        IS_VENDOR_API_LINK_QUESTION.instructions.replace(
          LINK_PLACEHOLDER,
          `links[${i}]`,
        ),
        IS_VENDOR_API_LINK_QUESTION.criteria,
      );
    });
    const answers = await this.#ask((freeText) => ({
      state: {
        vendor: { id: vendor.id, name: vendor.name },
        links: links.map((link) => describeLink(link, freeText)),
      },
      questions,
    }));
    return links.map((_, i) => yesNoFrom(answers, `link${i}`));
  }

  /**
   * One `systemOne` call built at each `FreeText` level in turn: sent in full,
   * and only when Cloudflare's block page answers, again with shortened and
   * then with no free text.
   */
  async #ask(
    build: (freeText: FreeText) => SystemOneRequest,
  ): Promise<Readonly<Record<string, Answer>>> {
    for (const [i, freeText] of FREE_TEXT_STEPS.entries()) {
      try {
        return await this.#askOnce(build(freeText));
      } catch (err) {
        if (!(err instanceof JudgeError) || !isBlockPage(err.cause)) throw err;
        if (i === FREE_TEXT_STEPS.length - 1) {
          throw new JudgeError(
            "http",
            "Jev returned HTTP 403 (Cloudflare block page; also with shortened and without descriptions)",
            { cause: err.cause },
          );
        }
      }
    }
    throw new Error("unreachable");
  }

  /** One `systemOne` request, retried once on 429/5xx. */
  async #askOnce(
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

function describeApi(api: ApiRef, freeText: FreeText) {
  const description = reduceFreeText(api.description, freeText);
  return {
    name: api.name,
    vendor: api.vendor,
    ...(description ? { description } : {}),
  };
}

/**
 * Cut an extract to its limits, whoever built it: never send a whole Spec.
 * Its description is sent at the call's `FreeText` level, and left out when
 * omitted.
 */
function describeSpecExtract(extract: SpecExtract, freeText: FreeText) {
  const { description, ...rest } = extract;
  const clamped = description?.slice(0, SPEC_EXTRACT_LIMITS.description);
  const reduced = reduceFreeText(clamped, freeText);
  return {
    ...rest,
    tags: extract.tags.slice(0, SPEC_EXTRACT_LIMITS.tags),
    samplePaths: extract.samplePaths.slice(0, SPEC_EXTRACT_LIMITS.samplePaths),
    ...(freeText === "full"
      ? { description: clamped ?? null }
      : reduced
        ? { description: reduced }
        : {}),
  };
}

function describeLink(link: SpecLink, freeText: FreeText) {
  const text = reduceFreeText(link.text, freeText);
  const context = reduceFreeText(link.context, freeText);
  return {
    url: link.url,
    ...(text ? { text } : {}),
    ...(context ? { context } : {}),
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

/**
 * A 403 whose body is Cloudflare's block page ("Attention Required! |
 * Cloudflare"): its WAF read the payload as an attack.
 */
function isBlockPage(err: unknown): boolean {
  return (
    err instanceof APIError &&
    err.status === 403 &&
    typeof err.body === "string" &&
    /attention required|cloudflare/i.test(err.body)
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
