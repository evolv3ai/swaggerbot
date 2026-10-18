import { describe, expect, it } from "vitest";
import {
  MAX_CITED,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
} from "~/server/chat";
import {
  ASK_HISTORY_CHARS,
  ASK_HISTORY_TURNS,
  ASK_MAX_CITED,
  ASK_QUESTION_CHARS,
  type AskEvent,
  type AskTurn,
  askBodyOf,
  citationChips,
  readAskEvents,
  startAsk,
} from "./ask-stream";

const encoder = new TextEncoder();

/** A body that sends `chunks` one after another, then ends or fails. */
function body(chunks: string[], fail?: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[i++];
      if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
      else if (fail) controller.error(fail);
      else controller.close();
    },
  });
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function all(events: AsyncIterable<AskEvent>): Promise<AskEvent[]> {
  const out: AskEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

describe("readAskEvents", () => {
  it("reads text and citations, however the frames are split", async () => {
    const stream = [
      frame("delta", { text: "Create one with " }),
      frame("delta", { text: "POST /v1/customers." }),
      frame("citation", {
        index: 1,
        kind: "operation",
        method: "post",
        path: "/v1/customers",
        cited: "Creates a customer",
      }),
      frame("citation", {
        index: 2,
        kind: "schema",
        name: "customer",
        cited: "{",
      }),
      frame("citation", { index: 0, kind: "facts", cited: "Title" }),
      frame("usage", { input: 1, cached: 0, cacheWritten: 0, output: 2 }),
      frame("done", { stopReason: "end_turn" }),
    ].join("");
    // Cut mid-frame and mid-character (the é).
    const bytes = encoder.encode(stream.replace("one", "oné"));
    const parts = [bytes.slice(0, 7), bytes.slice(7, 19), bytes.slice(19)];
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(p);
        controller.close();
      },
    });

    expect(await all(readAskEvents(split))).toEqual([
      { type: "delta", text: "Create oné with " },
      { type: "delta", text: "POST /v1/customers." },
      {
        type: "citation",
        citation: {
          kind: "operation",
          method: "post",
          path: "/v1/customers",
          cited: "Creates a customer",
        },
      },
      {
        type: "citation",
        citation: { kind: "schema", name: "customer", cited: "{" },
      },
      { type: "citation", citation: { kind: "facts", cited: "Title" } },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("reads an error mid-stream as the server's words, and a refusal", async () => {
    expect(
      await all(
        readAskEvents(
          body([
            frame("delta", { text: "Partly" }),
            frame("error", { error: "Something went wrong answering that." }),
          ]),
        ),
      ),
    ).toEqual([
      { type: "delta", text: "Partly" },
      { type: "error", message: "Something went wrong answering that." },
    ]);
    expect(
      await all(
        readAskEvents(
          body([
            frame("refusal", { message: "I can't answer that one." }),
            frame("done", { stopReason: "refusal" }),
          ]),
        ),
      ),
    ).toEqual([
      { type: "refusal", message: "I can't answer that one." },
      { type: "done", stopReason: "refusal" },
    ]);
  });

  it("skips frames it doesn't know or can't parse", async () => {
    expect(
      await all(
        readAskEvents(
          body([
            ": a comment\n\n",
            "event: delta\ndata: {not json\n\n",
            frame("ping", {}),
            frame("citation", { kind: "operation", method: "get" }),
            frame("delta", { text: "ok" }),
          ]),
        ),
      ),
    ).toEqual([{ type: "delta", text: "ok" }]);
  });

  it("an abort mid-stream ends reading with the abort, after what came before", async () => {
    const abort = new DOMException("The user aborted a request.", "AbortError");
    const seen: AskEvent[] = [];
    await expect(async () => {
      for await (const e of readAskEvents(
        body([frame("delta", { text: "Before " })], abort),
      ))
        seen.push(e);
    }).rejects.toThrow(abort);
    expect(seen).toEqual([{ type: "delta", text: "Before " }]);
  });
});

describe("startAsk", () => {
  const fetchAnswering =
    (response: Response, sent: RequestInit[] = []): typeof fetch =>
    async (_url, init) => {
      if (init) sent.push(init);
      return response;
    };
  const signal = new AbortController().signal;
  const ask = { question: "How?", history: [], cited: [] };

  it("posts the question to the Spec's route and streams its events", async () => {
    const sent: RequestInit[] = [];
    const urls: string[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      urls.push(String(url));
      return fetchAnswering(
        new Response(body([frame("done", { stopReason: "end_turn" })]), {
          headers: { "content-type": "text/event-stream; charset=utf-8" },
        }),
        sent,
      )(url, init);
    };
    const started = await startAsk("a".repeat(64), ask, signal, fetcher);
    expect(urls).toEqual([`/specs/${"a".repeat(64)}/ask`]);
    expect(sent[0]?.method).toBe("POST");
    expect(JSON.parse(String(sent[0]?.body))).toEqual(ask);
    expect(started.ok).toBe(true);
    if (started.ok)
      expect(await all(started.events)).toEqual([
        { type: "done", stopReason: "end_turn" },
      ]);
  });

  it("gives a refusal's words as the server put them", async () => {
    const quota =
      "You've asked 30 questions today; the count resets at 00:00 UTC, in 5 h.";
    expect(
      await startAsk(
        "s",
        ask,
        signal,
        fetchAnswering(Response.json({ error: quota }, { status: 429 })),
      ),
    ).toEqual({ ok: false, message: quota });
  });

  it("puts the forms' states into words when the answer has none", async () => {
    expect(
      await startAsk(
        "s",
        ask,
        signal,
        fetchAnswering(Response.json({ status: "pending" }, { status: 409 })),
      ),
    ).toEqual({
      ok: false,
      message: "Ask this Spec is ready once the Normalized Form is built.",
    });
    expect(
      await startAsk(
        "s",
        ask,
        signal,
        fetchAnswering(new Response("<html>", { status: 502 })),
      ),
    ).toEqual({
      ok: false,
      message: "Something went wrong answering that. Try again.",
    });
  });
});

describe("askBodyOf", () => {
  const turn = (n: number, extra: Partial<AskTurn> = {}): AskTurn => ({
    question: `Question ${n}?`,
    answer: `Answer ${n}.`,
    citations: [
      { kind: "operation", method: "get", path: `/v1/things/${n}`, cited: "" },
    ],
    status: "answered",
    ...extra,
  });

  it("matches the route's limits", () => {
    expect(ASK_HISTORY_TURNS).toBe(MAX_HISTORY_TURNS);
    expect(ASK_HISTORY_CHARS).toBe(MAX_HISTORY_CHARS);
    expect(ASK_MAX_CITED).toBe(MAX_CITED);
    expect(ASK_QUESTION_CHARS).toBe(MAX_QUESTION_CHARS);
  });

  it("sends the most recent answered turns, at most 8 entries", () => {
    const turns = Array.from({ length: 7 }, (_, i) => turn(i + 1));
    const sent = askBodyOf("  And then?  ", turns);
    expect(sent.question).toBe("And then?");
    expect(sent.history).toHaveLength(8);
    expect(sent.history[0]).toEqual({ role: "user", text: "Question 4?" });
    expect(sent.history.at(-1)).toEqual({
      role: "assistant",
      text: "Answer 7.",
    });
  });

  it("leaves out turns that weren't answered, and cuts a long answer", () => {
    const sent = askBodyOf("Next?", [
      turn(1, { answer: "x".repeat(9_000) }),
      turn(2, { status: "declined", answer: "" }),
      turn(3, { status: "stopped" }),
      turn(4, { status: "failed" }),
    ]);
    expect(sent.history).toEqual([
      { role: "user", text: "Question 1?" },
      { role: "assistant", text: "x".repeat(8_000) },
    ]);
    expect(sent.cited).toEqual([{ method: "get", path: "/v1/things/1" }]);
  });

  it("sends what was cited, most recent first, each once, at most 10, never the facts", () => {
    const turns = Array.from({ length: 6 }, (_, i) =>
      turn(i + 1, {
        citations: [
          { kind: "facts", cited: "" },
          { kind: "schema", name: `s${i + 1}`, cited: "" },
          { kind: "schema", name: "shared", cited: "" },
        ],
      }),
    );
    const { cited } = askBodyOf("Q?", turns);
    expect(cited).toHaveLength(7);
    expect(cited.slice(0, 3)).toEqual([
      { name: "s6" },
      { name: "shared" },
      { name: "s5" },
    ]);
    const many = Array.from({ length: 12 }, (_, i) => turn(i + 1));
    expect(askBodyOf("Q?", many).cited).toHaveLength(10);
  });
});

describe("citationChips", () => {
  const ids = { apiId: "stripe.com/stripe-api", specId: "f".repeat(64) };

  it("links an operation and a schema to their JSON, the facts to this page, each once", () => {
    expect(
      citationChips(
        [
          {
            kind: "operation",
            method: "post",
            path: "/v1/customers",
            cited: "a",
          },
          { kind: "schema", name: "customer", cited: "b" },
          {
            kind: "operation",
            method: "post",
            path: "/v1/customers",
            cited: "c",
          },
          { kind: "facts", cited: "d" },
        ],
        ids,
      ),
    ).toEqual([
      {
        key: "op post /v1/customers",
        label: "POST /v1/customers",
        href: `/api/apis/stripe.com/stripe-api/operation?specId=${"f".repeat(64)}&method=post&path=%2Fv1%2Fcustomers`,
        external: true,
      },
      {
        key: "schema customer",
        label: "customer",
        href: `/api/apis/stripe.com/stripe-api/schema?specId=${"f".repeat(64)}&name=customer`,
        external: true,
      },
      {
        key: "facts",
        label: "About this Spec",
        href: `/specs/${"f".repeat(64)}#spec`,
        external: false,
      },
    ]);
  });

  it("encodes a hostile name into the query, never out of it", () => {
    const [chip] = citationChips(
      [{ kind: "schema", name: "x&specId=evil#<script>", cited: "" }],
      ids,
    );
    expect(chip?.href).toBe(
      `/api/apis/stripe.com/stripe-api/schema?specId=${"f".repeat(64)}&name=x%26specId%3Devil%23%3Cscript%3E`,
    );
  });
});
