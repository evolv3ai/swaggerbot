import {
  APIError,
  APITimeoutError,
  type RequestOptions,
  type SystemOneRequest,
} from "@typesafe-ai/sdk";
import { describe, expect, it } from "vitest";
import type { SpecExtract } from "../domain/spec-extract";
import {
  IS_SPEC_LINK_QUESTION,
  JevJudge,
  SPEC_DESCRIBES_API_QUESTION,
  type SystemOneClient,
  WHICH_API_QUESTION,
} from "./jev";
import { JudgeError } from "./judge";

type Reply = Awaited<ReturnType<SystemOneClient["systemOne"]>>;
type Step = Reply | Error | "hang";

/** A stub SDK client answering each call with the next scripted step. */
function stubClient(...steps: Step[]) {
  const requests: SystemOneRequest[] = [];
  const options: (RequestOptions | undefined)[] = [];
  const client: SystemOneClient = {
    systemOne(request, opts) {
      requests.push(request);
      options.push(opts);
      const step = steps.shift();
      if (step === undefined) throw new Error("unexpected systemOne call");
      if (step === "hang") return new Promise(() => {});
      if (step instanceof Error) return Promise.reject(step);
      return Promise.resolve(step);
    },
  };
  return { client, requests, options };
}

const stripe = {
  id: "stripe.com/stripe-api",
  name: "Stripe API",
  vendor: "Stripe",
};
const stripeApps = {
  id: "stripe.com/stripe-apps",
  name: "Stripe Apps",
  vendor: "Stripe",
  description: "Build apps in the Stripe Dashboard",
};
const extract: SpecExtract = {
  title: "Stripe API",
  description: "x".repeat(800),
  serverHosts: ["api.stripe.com"],
  tags: Array.from({ length: 30 }, (_, i) => `tag${i}`),
  samplePaths: ["/v1/charges"],
  pathCount: 412,
};

function http(status: number) {
  return APIError.fromResponse(status, { error: "nope" }, new Headers());
}

describe("JevJudge.whichApi", () => {
  it("asks one choice over the Candidates plus none and maps the answer", async () => {
    const { client, requests } = stubClient({
      answers: {
        api: {
          type: "choice",
          choice: stripe.id,
          confidence: 0.9,
          probabilities: {
            [stripe.id]: 0.9,
            [stripeApps.id]: 0.07,
            none: 0.03,
          },
        },
      },
    });
    const judge = new JevJudge(client);

    const result = await judge.whichApi("stripe", [stripe, stripeApps]);

    expect(result).toEqual({
      probabilities: { [stripe.id]: 0.9, [stripeApps.id]: 0.07, none: 0.03 },
      confidence: 0.9,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      state: { name: "stripe" },
      questions: {
        api: {
          type: "choice",
          instructions: WHICH_API_QUESTION.instructions,
          criteria: {
            [stripe.id]: { name: "Stripe API", vendor: "Stripe" },
            [stripeApps.id]: {
              name: "Stripe Apps",
              vendor: "Stripe",
              description: "Build apps in the Stripe Dashboard",
            },
            none: WHICH_API_QUESTION.none,
          },
        },
      },
    });
  });

  it("answers none without a call when there are no Candidates", async () => {
    const { client, requests } = stubClient();
    const result = await new JevJudge(client).whichApi("stripe", []);
    expect(result).toEqual({ probabilities: { none: 1 }, confidence: 1 });
    expect(requests).toHaveLength(0);
  });
});

describe("JevJudge.isSpecLink", () => {
  it("maps a noul to probability and confidence", async () => {
    const { client, requests } = stubClient({
      answers: { link0: { type: "noul", noul: 0.2 } },
    });
    const result = await new JevJudge(client).isSpecLink(stripe, {
      url: "https://stripe.com/openapi.json",
      text: "OpenAPI spec",
    });
    expect(result).toEqual({ probability: 0.2, confidence: 0.8 });
    expect(requests[0]?.questions.link0).toEqual({
      type: "noul",
      instructions: IS_SPEC_LINK_QUESTION.instructions.replace(
        "{link}",
        "links[0]",
      ),
      criteria: IS_SPEC_LINK_QUESTION.criteria,
    });
  });

  it("sends several links as one call and answers them in order", async () => {
    const { client, requests } = stubClient({
      answers: {
        link0: { type: "noul", noul: 0.95 },
        link1: { type: "noul", noul: 0.1 },
        link2: { type: "noul", noul: 0.5 },
      },
    });
    const links = [
      { url: "https://a.test/openapi.json", text: "OpenAPI" },
      { url: "https://a.test/docs", text: "Docs", context: "Reference" },
      { url: "https://a.test/sdk", text: "SDK" },
    ];

    const result = await new JevJudge(client).areSpecLinks(stripe, links);

    expect(result.map((r) => r.probability)).toEqual([0.95, 0.1, 0.5]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.state).toEqual({
      api: { name: "Stripe API", vendor: "Stripe" },
      links,
    });
    expect(Object.keys(requests[0]?.questions ?? {})).toEqual([
      "link0",
      "link1",
      "link2",
    ]);
    expect(requests[0]?.questions.link2?.instructions).toContain("`links[2]`");
  });
});

describe("JevJudge.specDescribesApi", () => {
  it("sends only the clamped extract and maps the noul", async () => {
    const { client, requests } = stubClient({
      answers: { describes: { type: "noul", noul: 0.75 } },
    });
    const result = await new JevJudge(client).specDescribesApi(stripe, extract);

    expect(result).toEqual({ probability: 0.75, confidence: 0.75 });
    const state = requests[0]?.state as { spec: SpecExtract };
    expect(state.spec.description).toHaveLength(500);
    expect(state.spec.tags).toHaveLength(20);
    expect(requests[0]?.questions.describes).toEqual({
      type: "noul",
      instructions: SPEC_DESCRIBES_API_QUESTION.instructions,
      criteria: SPEC_DESCRIBES_API_QUESTION.criteria,
    });
  });
});

describe("JevJudge errors", () => {
  const yes = { answers: { describes: { type: "noul", noul: 1 } } } as const;

  it("retries a 429 once", async () => {
    const { client, requests, options } = stubClient(http(429), yes);
    const judge = new JevJudge(client, { retryDelayMs: 0 });
    await expect(judge.specDescribesApi(stripe, extract)).resolves.toEqual({
      probability: 1,
      confidence: 1,
    });
    expect(requests).toHaveLength(2);
    expect(options[0]?.retry).toEqual({ maxRetries: 0 });
  });

  it("retries a 5xx only once, then throws JudgeError with the cause", async () => {
    const second = http(503);
    const { client, requests } = stubClient(http(500), second);
    const judge = new JevJudge(client, { retryDelayMs: 0 });
    const err = await judge.specDescribesApi(stripe, extract).catch((e) => e);
    expect(err).toBeInstanceOf(JudgeError);
    expect(err.kind).toBe("http");
    expect(err.cause).toBe(second);
    expect(requests).toHaveLength(2);
  });

  it("does not retry a 400", async () => {
    const { client, requests } = stubClient(http(400));
    const judge = new JevJudge(client, { retryDelayMs: 0 });
    await expect(judge.specDescribesApi(stripe, extract)).rejects.toThrow(
      JudgeError,
    );
    expect(requests).toHaveLength(1);
  });

  it("throws a timeout JudgeError when Jev does not answer in time", async () => {
    const { client, requests, options } = stubClient("hang");
    const judge = new JevJudge(client, { timeoutMs: 20 });
    const err = await judge.specDescribesApi(stripe, extract).catch((e) => e);
    expect(err).toBeInstanceOf(JudgeError);
    expect(err.kind).toBe("timeout");
    expect(options[0]?.signal?.aborted).toBe(true);
    expect(requests).toHaveLength(1);
  });

  it("maps the SDK's own timeout to a timeout JudgeError", async () => {
    const cause = new APITimeoutError(10_000);
    const { client } = stubClient(cause);
    const err = await new JevJudge(client)
      .specDescribesApi(stripe, extract)
      .catch((e) => e);
    expect(err).toBeInstanceOf(JudgeError);
    expect(err.kind).toBe("timeout");
    expect(err.cause).toBe(cause);
  });

  it("rejects an answer of the wrong type", async () => {
    const { client } = stubClient({
      answers: { describes: { type: "score" } },
    });
    const err = await new JevJudge(client)
      .specDescribesApi(stripe, extract)
      .catch((e) => e);
    expect(err).toBeInstanceOf(JudgeError);
    expect(err.kind).toBe("bad-response");
  });
});
