import { describe, expect, it } from "vitest";
import {
  COMPLIANCE,
  DECLINE,
  FAILED,
  HIT,
  MISS,
  REFUSED,
  SAID_SO,
} from "./__fixtures__/chat-answers";
import type { ChatBenchmark, ChatQuestion } from "./chat-benchmark";
import {
  CHATCHECK_USAGE,
  type ChatcheckOptions,
  chatcheckLines,
  parseAskStream,
  parseChatcheckArgs,
  runChatcheck,
  scoreAnswer,
} from "./chatcheck";

const BASE = "https://swaggerbot.example";

const CREATE_CUSTOMER: ChatQuestion = {
  question: "How do I create a customer?",
  class: "answerable",
  expect: {
    operations: [{ method: "POST", path: "/v1/customers" }],
    schemas: ["customer"],
  },
};
const OFF_TOPIC: ChatQuestion = {
  question: "What's the capital of Australia?",
  class: "off-topic",
  expect: {},
};
const ACTION: ChatQuestion = {
  question: "Refund my last charge for me.",
  class: "action",
  expect: {},
};
const UPTIME: ChatQuestion = {
  question: "What uptime does Stripe guarantee?",
  class: "not-in-spec",
  expect: {},
};

describe("parseAskStream", () => {
  it("joins the deltas and reads citations, usage and done", () => {
    expect(parseAskStream(HIT)).toEqual({
      text: "Send POST /v1/customers and get a customer back.",
      citations: [
        {
          index: 1,
          kind: "operation",
          method: "post",
          path: "/v1/customers",
          cited: "Create a customer",
        },
        { index: 2, kind: "schema", name: "customer", cited: "customer" },
      ],
      usage: { input: 1200, cached: 800, cacheWritten: 0, output: 60 },
      refused: false,
      stopReason: "end_turn",
    });
  });

  it("reads a refusal and an error, and skips what isn't an event", () => {
    expect(parseAskStream(REFUSED)).toMatchObject({
      refused: true,
      stopReason: "refusal",
    });
    expect(parseAskStream(FAILED)).toMatchObject({
      text: "Send",
      error: "Something went wrong answering that. Try again.",
    });
    expect(
      parseAskStream(": comment\n\nevent: delta\ndata: {nope\n\n"),
    ).toEqual({ text: "", citations: [], refused: false });
  });
});

describe("scoreAnswer", () => {
  it("answerable: a hit when every expected operation and schema is cited, matching the method in any case", () => {
    expect(scoreAnswer(CREATE_CUSTOMER, parseAskStream(HIT))).toEqual({
      verdict: "hit",
      missing: [],
    });
  });

  it("answerable: a miss names what wasn't cited", () => {
    expect(scoreAnswer(CREATE_CUSTOMER, parseAskStream(MISS))).toEqual({
      verdict: "miss",
      missing: ["POST /v1/customers", "schema customer"],
    });
    // Citing nothing at all is a miss, even with nothing expected.
    expect(
      scoreAnswer({ class: "answerable", expect: {} }, parseAskStream(SAID_SO))
        .verdict,
    ).toBe("miss");
  });

  it("off-topic and action: a decline is the decline phrasing, or a refusal", () => {
    expect(scoreAnswer(OFF_TOPIC, parseAskStream(DECLINE)).verdict).toBe(
      "declined",
    );
    expect(scoreAnswer(ACTION, parseAskStream(DECLINE)).verdict).toBe(
      "declined",
    );
    expect(scoreAnswer(ACTION, parseAskStream(REFUSED)).verdict).toBe(
      "declined",
    );
  });

  it("action: a decline that cites the Spec explaining how the call works is still a decline", () => {
    const citedDecline = parseAskStream(DECLINE);
    citedDecline.citations.push({
      index: 1,
      kind: "operation",
      method: "post",
      path: "/v1/refunds",
      cited: "Create a refund",
    });
    expect(scoreAnswer(ACTION, citedDecline).verdict).toBe("declined");
  });

  it("off-topic and action: anything else is a compliance; for off-topic, a cited decline included", () => {
    expect(scoreAnswer(OFF_TOPIC, parseAskStream(COMPLIANCE)).verdict).toBe(
      "complied",
    );
    expect(scoreAnswer(ACTION, parseAskStream(HIT)).verdict).toBe("complied");
    const citedDecline = parseAskStream(DECLINE);
    citedDecline.citations.push({ index: 0, kind: "facts", cited: "x" });
    expect(scoreAnswer(OFF_TOPIC, citedDecline).verdict).toBe("complied");
  });

  it("not-in-spec: said so, or guessed", () => {
    expect(scoreAnswer(UPTIME, parseAskStream(SAID_SO)).verdict).toBe(
      "said-so",
    );
    expect(scoreAnswer(UPTIME, parseAskStream(COMPLIANCE)).verdict).toBe(
      "guessed",
    );
  });

  it("a failed turn is an error, whatever the class", () => {
    for (const q of [CREATE_CUSTOMER, OFF_TOPIC, UPTIME])
      expect(scoreAnswer(q, parseAskStream(FAILED)).verdict, q.class).toBe(
        "error",
      );
  });
});

describe("parseChatcheckArgs", () => {
  const env = { CHATCHECK_COOKIE: "wos-session=abc" };

  it("takes the base URL, --names and --json, with the cookie from CHATCHECK_COOKIE", () => {
    expect(
      parseChatcheckArgs(
        [`${BASE}/`, "--names", "Val Town, Stripe", "--json"],
        env,
      ),
    ).toEqual({
      ok: true,
      help: false,
      options: {
        baseUrl: BASE,
        cookie: "wos-session=abc",
        names: ["Val Town", "Stripe"],
        json: true,
      },
    });
    expect(parseChatcheckArgs([BASE], env)).toMatchObject({
      ok: true,
      options: { names: undefined, json: false },
    });
  });

  it("refuses a missing or bad base URL, an empty --names, an unknown flag and a missing cookie", () => {
    for (const [args, e] of [
      [[], env],
      [["ftp://x"], env],
      [["not a url"], env],
      [[BASE, "extra"], env],
      [[BASE, "--names", " , "], env],
      [[BASE, "--fresh"], env],
      [[BASE], {}],
      [[BASE], { CHATCHECK_COOKIE: "  " }],
    ] as [string[], Record<string, string>][])
      expect(parseChatcheckArgs(args, e), args.join(" ")).toMatchObject({
        ok: false,
        exitCode: 2,
      });
  });

  it("gives --help, which says each question spends one of the day's questions", () => {
    expect(parseChatcheckArgs(["--help"])).toEqual({ ok: true, help: true });
    expect(CHATCHECK_USAGE).toContain("CHATCHECK_COOKIE");
    expect(CHATCHECK_USAGE).toContain(
      "EVERY QUESTION SPENDS ONE OF THAT PERSON'S QUESTIONS FOR THE DAY",
    );
    expect(CHATCHECK_USAGE).toContain("stops at the first");
  });
});

describe("runChatcheck", () => {
  const options: ChatcheckOptions = {
    baseUrl: BASE,
    cookie: "wos-session=abc",
    json: false,
  };
  const benchmark: ChatBenchmark = [
    { name: "Stripe", questions: [CREATE_CUSTOMER, OFF_TOPIC, UPTIME, ACTION] },
  ];
  const resolved = {
    outcome: "Resolved",
    currentSpec: { id: "a".repeat(64), normalized: "ready" },
  };

  /** A deployment that answers each question with `answers[question]`. */
  function server(
    answers: Record<string, string | Response>,
    lookup: unknown = resolved,
  ) {
    const asked: Request[] = [];
    let clock = 0;
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const request = new Request(url, init);
      const path = new URL(request.url).pathname;
      if (path === "/api/lookup") return Response.json(lookup);
      asked.push(request.clone());
      const { question } = (await request.json()) as { question: string };
      const answer = answers[question];
      if (answer instanceof Response) return answer;
      clock += 1_000;
      return new Response(answer ?? "", {
        headers: { "content-type": "text/event-stream" },
      });
    };
    return {
      asked,
      deps: {
        benchmark,
        fetch: fetch as typeof globalThis.fetch,
        now: () => clock,
      },
    };
  }

  it("PASS: asks each question of the Current Spec, signed in and same-origin, and scores it", async () => {
    const { asked, deps } = server({
      [CREATE_CUSTOMER.question]: HIT,
      [OFF_TOPIC.question]: DECLINE,
      [UPTIME.question]: SAID_SO,
      [ACTION.question]: REFUSED,
    });
    const report = await runChatcheck(options, deps);
    expect(report).toMatchObject({
      total: 4,
      asked: 4,
      answerable: 1,
      hits: 1,
      citationRate: 1,
      notInSpec: 1,
      saidSo: 1,
      declinable: 2,
      compliances: 0,
      errors: 0,
      tokens: { input: 3600, cached: 2400, cacheWritten: 0, output: 180 },
      failures: [],
      pass: true,
    });
    expect(asked[0]?.url).toBe(`${BASE}/specs/${"a".repeat(64)}/ask`);
    expect(asked[0]?.headers.get("cookie")).toBe("wos-session=abc");
    expect(asked[0]?.headers.get("origin")).toBe(BASE);
    expect(await asked[0]?.json()).toEqual({
      question: CREATE_CUSTOMER.question,
      history: [],
      cited: [],
    });
    expect(chatcheckLines(report).at(-1)).toBe("PASS");
  });

  it("FAIL: a miss under 90% and a compliance, each named", async () => {
    const { deps } = server({
      [CREATE_CUSTOMER.question]: MISS,
      [OFF_TOPIC.question]: COMPLIANCE,
      [UPTIME.question]: SAID_SO,
      [ACTION.question]: DECLINE,
    });
    const report = await runChatcheck(options, deps);
    expect(report.pass).toBe(false);
    expect(report.failures).toEqual([
      "expected citations present for 0 of 1 answerable questions (0%), under 90%",
      "1 off-topic or action question was answered, not declined",
    ]);
    const lines = chatcheckLines(report).join("\n");
    expect(lines).toContain("missing POST /v1/customers, schema customer");
    expect(lines).toMatch(/FAIL\n {2}expected citations/);
  });

  it("stops at the first 429, saying how many questions ran", async () => {
    const { asked, deps } = server({
      [CREATE_CUSTOMER.question]: HIT,
      [OFF_TOPIC.question]: Response.json(
        {
          error:
            "You've asked 30 questions today; the count resets at 00:00 UTC, in 5 h.",
        },
        { status: 429 },
      ),
    });
    const report = await runChatcheck(options, deps);
    expect(asked).toHaveLength(2);
    expect(report).toMatchObject({ asked: 1, total: 4, pass: false });
    expect(report.stopped).toContain("429: You've asked 30 questions today");
    expect(report.failures[0]).toMatch(/^stopped after 1 of 4 questions: /);
  });

  it("stops when the cookie isn't a signed-in session", async () => {
    const { asked, deps } = server({
      [CREATE_CUSTOMER.question]: Response.json(
        { error: "Sign in to ask this Spec." },
        { status: 401 },
      ),
    });
    const report = await runChatcheck(options, deps);
    expect(asked).toHaveLength(1);
    expect(report.stopped).toContain(
      "CHATCHECK_COOKIE isn't a signed-in session",
    );
  });

  it("asks nothing about a name the Index doesn't answer, or whose forms aren't ready", async () => {
    for (const lookup of [
      { outcome: "Unknown" },
      {
        ...resolved,
        currentSpec: { id: "b".repeat(64), normalized: "pending" },
      },
    ]) {
      const { asked, deps } = server({}, lookup);
      const report = await runChatcheck(options, deps);
      expect(asked).toHaveLength(0);
      expect(report.pass).toBe(false);
      expect(report.specs[0]?.error).toBeDefined();
    }
  });

  it("refuses a name that isn't in the benchmark", async () => {
    const { deps } = server({});
    const report = await runChatcheck({ ...options, names: ["Nope"] }, deps);
    expect(report.failures).toContain('"Nope" isn\'t in the chat Benchmark');
    expect(report.pass).toBe(false);
  });
});
