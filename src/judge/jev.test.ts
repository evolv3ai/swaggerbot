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
  IS_VENDOR_API_LINK_QUESTION,
  IS_VENDOR_NAME_QUESTION,
  JevJudge,
  SPEC_DESCRIBES_API_QUESTION,
  type SystemOneClient,
  shortenFreeText,
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

/** The 403 Cloudflare's WAF answers with in front of TypeSafe. */
function blockPage() {
  return APIError.fromResponse(
    403,
    "<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head><body>Sorry, you have been blocked</body></html>",
    new Headers(),
  );
}

/** Like the description of Cisco's PSIRT openVuln API on APIs.guru. */
const ciscoDescription = [
  "The Cisco PSIRT openVuln API is a RESTful API that allows customers to obtain Cisco security vulnerability information.",
  "",
  'curl -s -k -H "Content-Type: application/x-www-form-urlencoded" -X POST -d "client_id=abc" https://id.cisco.com/oauth2/default/v1/token',
].join("\n");

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

describe("JevJudge.isVendorName", () => {
  it("asks one noul over the name and the Vendor and maps it", async () => {
    const { client, requests } = stubClient({
      answers: { vendor: { type: "noul", noul: 0.85 } },
    });
    const result = await new JevJudge(client).isVendorName("mailchimp", {
      id: "mailchimp.com",
      name: "Mailchimp",
    });

    expect(result).toEqual({ probability: 0.85, confidence: 0.85 });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      state: {
        name: "mailchimp",
        vendor: { id: "mailchimp.com", name: "Mailchimp" },
      },
      questions: {
        vendor: {
          type: "noul",
          instructions: IS_VENDOR_NAME_QUESTION.instructions,
          criteria: IS_VENDOR_NAME_QUESTION.criteria,
        },
      },
    });
  });

  it("rejects an answer of the wrong type", async () => {
    const { client } = stubClient({ answers: { vendor: { type: "score" } } });
    const err = await new JevJudge(client)
      .isVendorName("mailchimp", { id: "mailchimp.com", name: "Mailchimp" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(JudgeError);
    expect(err.kind).toBe("bad-response");
  });
});

describe("JevJudge.isVendorApiLink", () => {
  const mailchimp = { id: "mailchimp.com", name: "Mailchimp" };

  it("sends several links as one call over the Vendor and answers them in order", async () => {
    const { client, requests } = stubClient({
      answers: {
        link0: { type: "noul", noul: 0.9 },
        link1: { type: "noul", noul: 0.05 },
      },
    });
    const links = [
      {
        url: "https://mailchimp.com/developer/marketing/",
        text: "Marketing API",
        context: "APIs",
      },
      { url: "https://mailchimp.com/pricing/", text: "Pricing" },
    ];
    const result = await new JevJudge(client).areVendorApiLinks(
      mailchimp,
      links,
    );

    expect(result).toEqual([
      { probability: 0.9, confidence: 0.9 },
      { probability: 0.05, confidence: 0.95 },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      state: { vendor: mailchimp, links },
      questions: {
        link0: {
          type: "noul",
          instructions: IS_VENDOR_API_LINK_QUESTION.instructions.replace(
            "{link}",
            "links[0]",
          ),
          criteria: IS_VENDOR_API_LINK_QUESTION.criteria,
        },
        link1: {
          type: "noul",
          instructions: IS_VENDOR_API_LINK_QUESTION.instructions.replace(
            "{link}",
            "links[1]",
          ),
          criteria: IS_VENDOR_API_LINK_QUESTION.criteria,
        },
      },
    });
    expect(requests[0]?.questions.link1?.instructions).toContain("`links[1]`");
  });

  it("answers one link through the batch form", async () => {
    const { client, requests } = stubClient({
      answers: { link0: { type: "noul", noul: 0.7 } },
    });
    const result = await new JevJudge(client).isVendorApiLink(mailchimp, {
      url: "https://mailchimp.com/developer/transactional/",
      text: "Transactional API",
    });
    expect(result.probability).toBe(0.7);
    expect(Object.keys(requests[0]?.questions ?? {})).toEqual(["link0"]);
  });

  it("makes no call for no links", async () => {
    const { client, requests } = stubClient();
    await expect(
      new JevJudge(client).areVendorApiLinks(mailchimp, []),
    ).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("rejects an answer of the wrong type", async () => {
    const { client } = stubClient({ answers: { link0: { type: "score" } } });
    const err = await new JevJudge(client)
      .isVendorApiLink(mailchimp, { url: "https://x.test", text: "x" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(JudgeError);
    expect(err.kind).toBe("bad-response");
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

describe("shortenFreeText", () => {
  it("keeps a Cisco-like description's first paragraph only, without curl", () => {
    expect(shortenFreeText(ciscoDescription)).toBe(
      "The Cisco PSIRT openVuln API is a RESTful API that allows customers to obtain Cisco security vulnerability information.",
    );
  });

  it("stops at a code fence and drops curl lines within the paragraph", () => {
    expect(
      shortenFreeText(
        "Adyen Checkout API.\ncurl -U user:pass https://x.test\nUse it to pay.\n```\ncurl -H x\n```",
      ),
    ).toBe("Adyen Checkout API.\nUse it to pay.");
  });

  it("cuts to 300 characters and gives undefined when nothing is left", () => {
    expect(shortenFreeText("y".repeat(1000))).toHaveLength(300);
    expect(shortenFreeText('curl -H "Content-Type: x"\n\nmore')).toBe(
      undefined,
    );
  });
});

describe("JevJudge on Cloudflare's block page", () => {
  const cisco = {
    id: "cisco.com/psirt-openvuln",
    name: "PSIRT openVuln API",
    vendor: "Cisco",
    description: ciscoDescription,
  };
  const picked = {
    answers: {
      api: {
        type: "choice",
        choice: cisco.id,
        confidence: 0.8,
        probabilities: { [cisco.id]: 0.8, none: 0.2 },
      },
    },
  } as const;
  const expected = {
    probabilities: { [cisco.id]: 0.8, none: 0.2 },
    confidence: 0.8,
  };
  const candidateSent = (request: SystemOneRequest | undefined) => {
    const api = request?.questions.api as
      | { criteria: Record<string, unknown> }
      | undefined;
    return api?.criteria[cisco.id];
  };

  it("retries with shortened descriptions and answers", async () => {
    const { client, requests } = stubClient(blockPage(), picked);
    const result = await new JevJudge(client, { retryDelayMs: 0 }).whichApi(
      "cisco",
      [cisco],
    );

    expect(result).toEqual(expected);
    expect(requests).toHaveLength(2);
    expect(candidateSent(requests[0])).toEqual({
      name: cisco.name,
      vendor: "Cisco",
      description: ciscoDescription,
    });
    expect(candidateSent(requests[1])).toEqual({
      name: cisco.name,
      vendor: "Cisco",
      description: shortenFreeText(ciscoDescription),
    });
    expect(JSON.stringify(requests[1])).not.toContain("curl");
  });

  it("retries without descriptions when the shortened call is blocked too", async () => {
    const { client, requests } = stubClient(blockPage(), blockPage(), picked);
    const result = await new JevJudge(client, { retryDelayMs: 0 }).whichApi(
      "cisco",
      [cisco],
    );

    expect(result).toEqual(expected);
    expect(requests).toHaveLength(3);
    expect(candidateSent(requests[2])).toEqual({
      name: cisco.name,
      vendor: "Cisco",
    });
  });

  it("throws a JudgeError naming the block after three blocked calls", async () => {
    const last = blockPage();
    const { client, requests } = stubClient(blockPage(), blockPage(), last);
    const err = await new JevJudge(client, { retryDelayMs: 0 })
      .whichApi("cisco", [cisco])
      .catch((e) => e);

    expect(err).toBeInstanceOf(JudgeError);
    expect(err.kind).toBe("http");
    expect(err.message).toBe(
      "Jev returned HTTP 403 (Cloudflare block page; also with shortened and without descriptions)",
    );
    expect(err.cause).toBe(last);
    expect(requests).toHaveLength(3);
  });

  it("does not retry a 403 whose body is not the block page", async () => {
    const { client, requests } = stubClient(http(403));
    const err = await new JevJudge(client, { retryDelayMs: 0 })
      .whichApi("cisco", [cisco])
      .catch((e) => e);

    expect(err).toBeInstanceOf(JudgeError);
    expect(err.message).toBe("Jev returned HTTP 403");
    expect(requests).toHaveLength(1);
  });

  it("shortens and then omits link text, context and the extract's description", async () => {
    const yes = { answers: { describes: { type: "noul", noul: 1 } } } as const;
    const { client, requests } = stubClient(blockPage(), blockPage(), yes);
    await new JevJudge(client, { retryDelayMs: 0 }).specDescribesApi(cisco, {
      ...extract,
      description: ciscoDescription,
    });
    const specs = requests.map(
      (r) => (r.state as { spec: Partial<SpecExtract> }).spec,
    );
    expect(specs[1]?.description).toBe(shortenFreeText(ciscoDescription));
    expect(specs[2]).not.toHaveProperty("description");
    expect(specs[2]?.tags).toHaveLength(20);

    const links = stubClient(blockPage(), blockPage(), {
      answers: { link0: { type: "noul", noul: 0.9 } },
    });
    await new JevJudge(links.client, { retryDelayMs: 0 }).areSpecLinks(cisco, [
      { url: "https://x.test/spec", text: "Spec", context: ciscoDescription },
    ]);
    const sent = links.requests.map(
      (r) => (r.state as { links: unknown[] }).links[0],
    );
    expect(sent[1]).toEqual({
      url: "https://x.test/spec",
      text: "Spec",
      context: shortenFreeText(ciscoDescription),
    });
    expect(sent[2]).toEqual({ url: "https://x.test/spec" });
  });
});
