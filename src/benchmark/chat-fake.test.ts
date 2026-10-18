import { describe, expect, it } from "vitest";
import type { GroundingDocument, ModelEvent } from "~/chat/model";
import type { ChatBenchmark } from "./chat-benchmark";
import {
  createBenchmarkModel,
  FAKE_ACTION,
  FAKE_NOT_IN_SPEC,
  FAKE_OFF_TOPIC,
} from "./chat-fake";
import { parseAskStream, scoreAnswer } from "./chatcheck";

const benchmark: ChatBenchmark = [
  {
    name: "Stripe",
    questions: [
      {
        question: "How do I create a customer?",
        class: "answerable",
        expect: {
          operations: [{ method: "POST", path: "/v1/customers" }],
          schemas: ["customer"],
        },
      },
      { question: "How do I authenticate?", class: "answerable", expect: {} },
      { question: "Uptime?", class: "not-in-spec", expect: {} },
      { question: "A haiku?", class: "off-topic", expect: {} },
      { question: "Refund it for me.", class: "action", expect: {} },
    ],
  },
];

const documents: GroundingDocument[] = [
  { kind: "facts", title: "About this Spec", ref: null, text: "{}" },
  {
    kind: "operation",
    title: "GET /v1/customers (operation)",
    ref: { method: "get", path: "/v1/customers" },
    text: "{}",
  },
  {
    kind: "operation",
    title: "POST /v1/customers (operation)",
    ref: { method: "post", path: "/v1/customers" },
    text: "{}",
  },
  {
    kind: "schema",
    title: "customer (schema)",
    ref: { name: "customer" },
    text: "{}",
  },
];

async function answer(question: string, docs = documents) {
  const events: ModelEvent[] = [];
  const model = createBenchmarkModel(benchmark);
  for await (const event of model.stream({
    system: "",
    documents: docs,
    history: [],
    question,
    maxTokens: 1500,
  }))
    events.push(event);
  return events;
}

/** The events as the ask route would stream them, scored as chatcheck would. */
function asStream(events: ModelEvent[], docs = documents): string {
  return events
    .map((e) => {
      if (e.type === "text") return ["delta", { text: e.text }] as const;
      if (e.type === "citation") {
        const doc = docs[e.documentIndex];
        return [
          "citation",
          {
            index: e.documentIndex,
            kind: doc?.kind,
            ...doc?.ref,
            cited: e.cited,
          },
        ] as const;
      }
      if (e.type === "done")
        return ["done", { stopReason: e.stopReason }] as const;
      return [e.type, e] as const;
    })
    .map(
      ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

describe("createBenchmarkModel", () => {
  it("cites each expected operation and schema the documents hold, and nothing else", async () => {
    const events = await answer("How do I create a customer?");
    expect(
      events.flatMap((e) => (e.type === "citation" ? [e.documentIndex] : [])),
    ).toEqual([2, 3]);
    expect(events.at(-1)).toEqual({ type: "done", stopReason: "end_turn" });
    const q = benchmark[0]?.questions[0];
    if (!q) throw new Error("no question");
    expect(scoreAnswer(q, parseAskStream(asStream(events))).verdict).toBe(
      "hit",
    );
  });

  it("misses what retrieval left out", async () => {
    const without = documents.slice(0, 2);
    const events = await answer("How do I create a customer?", without);
    const q = benchmark[0]?.questions[0];
    if (!q) throw new Error("no question");
    expect(
      scoreAnswer(q, parseAskStream(asStream(events, without))).verdict,
    ).toBe("miss");
  });

  it("cites the Spec's facts when nothing is expected", async () => {
    const events = await answer("How do I authenticate?");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "citation", documentIndex: 0 }),
    );
  });

  it("says the Spec doesn't say, and declines, in the system prompt's words", async () => {
    const text = async (q: string) =>
      (await answer(q))
        .flatMap((e) => (e.type === "text" ? [e.text] : []))
        .join("");
    expect(await text("Uptime?")).toBe(FAKE_NOT_IN_SPEC);
    expect(await text("A haiku?")).toBe(FAKE_OFF_TOPIC);
    expect(await text("Refund it for me.")).toBe(FAKE_ACTION);
    for (const [question, cls] of [
      ["Uptime?", "said-so"],
      ["A haiku?", "declined"],
      ["Refund it for me.", "declined"],
    ] as const) {
      const q = benchmark[0]?.questions.find((x) => x.question === question);
      if (!q) throw new Error(question);
      expect(
        scoreAnswer(q, parseAskStream(asStream(await answer(question))))
          .verdict,
      ).toBe(cls);
    }
  });

  it("gives FakeModel's default answer to a question not in the benchmark", async () => {
    const events = await answer("Something else?");
    expect(events[0]).toEqual({
      type: "text",
      text: "GET /v1/customers (operation) is in this Spec.",
    });
  });
});
