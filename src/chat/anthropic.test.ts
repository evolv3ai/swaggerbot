import { describe, expect, it } from "vitest";
import {
  answerStart,
  citedAnswer,
  refusal,
  uncategorizedRefusal,
} from "./__fixtures__/anthropic-events";
import {
  createAnthropicModel,
  FALLBACK_BETA,
  type MessagesClient,
  type StreamEvent,
  type StreamParams,
} from "./anthropic";
import {
  CHAT_MAX_TOKENS,
  type GroundingDocument,
  type ModelEvent,
  type ModelRequest,
} from "./model";

const FACTS: GroundingDocument = {
  kind: "facts",
  title: "About this Spec",
  ref: null,
  text: "Title: Stripe API\nAPI Version: 2024-06-20",
};
const OPERATION: GroundingDocument = {
  kind: "operation",
  title: "GET /v1/customers (operation)",
  text: "GET /v1/customers\nList all customers.",
  ref: { method: "get", path: "/v1/customers" },
};
const SCHEMA: GroundingDocument = {
  kind: "schema",
  title: "customer (schema)",
  text: "customer: object",
  ref: { name: "customer" },
};

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    system: "Answer only from the documents.",
    // Facts last, to show they are sent first whatever their place.
    documents: [OPERATION, SCHEMA, FACTS],
    history: [
      { role: "user", text: "What is a customer?" },
      { role: "assistant", text: "A customer is an object." },
    ],
    question: "How do I list customers?",
    maxTokens: CHAT_MAX_TOKENS,
    ...overrides,
  };
}

/** A fake `client.beta.messages`: streams `events`, recording each call. */
function fakeMessages(
  stream: (signal?: AbortSignal) => AsyncIterable<StreamEvent>,
) {
  const calls: { params: StreamParams; signal?: AbortSignal }[] = [];
  const messages: MessagesClient = {
    stream(params, options) {
      calls.push({ params, signal: options?.signal });
      return stream(options?.signal);
    },
  };
  return { messages, calls };
}

async function* scripted(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const event of events) yield event;
}

async function collect(stream: AsyncIterable<ModelEvent>) {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function model(messages: MessagesClient, timeoutMs?: number) {
  return createAnthropicModel({
    apiKey: "sk-ant-test",
    model: "claude-opus-5-5",
    effort: "low",
    messages,
    timeoutMs,
  });
}

describe("createAnthropicModel", () => {
  it("builds a request with the system prompt and facts cached and every document cited", async () => {
    const { messages, calls } = fakeMessages(() => scripted(citedAnswer));
    await collect(model(messages).stream(request()));
    const params = calls[0]?.params;
    expect(params).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 1_500,
      output_config: { effort: "low" },
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      system: [
        {
          type: "text",
          text: "Answer only from the documents.",
          cache_control: { type: "ephemeral" },
        },
      ],
    });
    expect(params).not.toHaveProperty("thinking");
    expect(params?.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "text",
              media_type: "text/plain",
              data: FACTS.text,
            },
            title: "About this Spec",
            citations: { enabled: true },
            cache_control: { type: "ephemeral" },
          },
          {
            type: "document",
            source: {
              type: "text",
              media_type: "text/plain",
              data: OPERATION.text,
            },
            title: "GET /v1/customers (operation)",
            citations: { enabled: true },
          },
          {
            type: "document",
            source: {
              type: "text",
              media_type: "text/plain",
              data: SCHEMA.text,
            },
            title: "customer (schema)",
            citations: { enabled: true },
          },
        ],
      },
      { role: "user", content: "What is a customer?" },
      { role: "assistant", content: "A customer is an object." },
      { role: "user", content: "How do I list customers?" },
    ]);
  });

  it("sends the question alone when there are no documents", async () => {
    const { messages, calls } = fakeMessages(() => scripted(citedAnswer));
    await collect(
      model(messages).stream(request({ documents: [], history: [] })),
    );
    expect(calls[0]?.params.messages).toEqual([
      { role: "user", content: "How do I list customers?" },
    ]);
  });

  it("maps text, citations by the request's document order, usage and the stop reason", async () => {
    const { messages } = fakeMessages(() => scripted(citedAnswer));
    const events = await collect(model(messages).stream(request()));
    // Sent document 1 is OPERATION, request.documents[0].
    expect(events).toEqual([
      { type: "citation", documentIndex: 0, cited: "List all customers." },
      { type: "text", text: "GET /v1/customers " },
      { type: "text", text: "lists customers." },
      { type: "text", text: " That is all." },
      {
        type: "usage",
        input: 1200,
        cached: 900,
        cacheWritten: 300,
        output: 42,
      },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("maps a refusal to a refusal event with its category, never to text", async () => {
    const { messages } = fakeMessages(() => scripted(refusal));
    const events = await collect(model(messages).stream(request()));
    expect(events).toEqual([
      { type: "usage", input: 800, cached: 0, cacheWritten: 0, output: 3 },
      { type: "refusal", category: "cyber" },
      { type: "done", stopReason: "refusal" },
    ]);
  });

  it("gives a refusal with no named category no category", async () => {
    const { messages } = fakeMessages(() => scripted(uncategorizedRefusal));
    const events = await collect(model(messages).stream(request()));
    expect(events).toContainEqual({ type: "refusal" });
  });

  it("maps an SDK error to its class name only", async () => {
    class RateLimitError extends Error {}
    const { messages } = fakeMessages(async function* () {
      yield* scripted(answerStart);
      throw new RateLimitError("429 for How do I list customers?");
    });
    const events = await collect(model(messages).stream(request()));
    expect(events).toEqual([
      { type: "text", text: "Partly" },
      { type: "error", kind: "RateLimitError" },
    ]);
  });

  it("cuts a turn off at its timeout", async () => {
    class APIUserAbortError extends Error {}
    const { messages } = fakeMessages(async function* (signal) {
      yield* scripted(answerStart);
      await new Promise((_, reject) =>
        signal?.addEventListener("abort", () =>
          reject(new APIUserAbortError("aborted")),
        ),
      );
    });
    const events = await collect(model(messages, 20).stream(request()));
    expect(events).toEqual([
      { type: "text", text: "Partly" },
      { type: "error", kind: "timeout" },
    ]);
  });

  it("ends a turn when the caller's signal aborts", async () => {
    class APIUserAbortError extends Error {}
    const caller = new AbortController();
    const { messages } = fakeMessages(async function* (signal) {
      yield* scripted(answerStart);
      caller.abort();
      if (signal?.aborted) throw new APIUserAbortError("aborted");
    });
    const events = await collect(
      model(messages).stream(request({ signal: caller.signal })),
    );
    expect(events.at(-1)).toEqual({ type: "error", kind: "APIUserAbortError" });
  });
});
