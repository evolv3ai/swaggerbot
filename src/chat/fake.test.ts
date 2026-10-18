import { describe, expect, it } from "vitest";
import { FakeModel } from "./fake";
import {
  CHAT_MAX_TOKENS,
  type GroundingDocument,
  type ModelEvent,
  type ModelRequest,
} from "./model";

const FACTS: GroundingDocument = {
  kind: "facts",
  title: "About this Spec",
  text: "Title: Val Town API",
};
const OPERATION: GroundingDocument = {
  kind: "operation",
  title: "GET /v1/me (operation)",
  text: "GET /v1/me\nGet profile information for the current user.",
  method: "get",
  path: "/v1/me",
};

function request(question: string, documents = [FACTS, OPERATION]) {
  return {
    system: "system",
    documents,
    history: [],
    question,
    maxTokens: CHAT_MAX_TOKENS,
  } satisfies ModelRequest;
}

async function collect(stream: AsyncIterable<ModelEvent>) {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("FakeModel", () => {
  it("records every request", async () => {
    const fake = new FakeModel();
    await collect(fake.stream(request("one")));
    await collect(fake.stream(request("two")));
    expect(fake.requests.map((r) => r.question)).toEqual(["one", "two"]);
  });

  it("emits the events scripted for a question", async () => {
    const scripted: ModelEvent[] = [
      { type: "refusal", category: "cyber" },
      { type: "done", stopReason: "refusal" },
    ];
    const fake = new FakeModel({ answers: { "Hack it": scripted } });
    expect(await collect(fake.stream(request("Hack it")))).toEqual(scripted);
  });

  it("emits the scripted default for any other question", async () => {
    const fallback: ModelEvent[] = [{ type: "error", kind: "timeout" }];
    const fake = new FakeModel({ default: fallback });
    expect(await collect(fake.stream(request("anything")))).toEqual(fallback);
  });

  it("answers one cited sentence from the first operation by default", async () => {
    const events = await collect(new FakeModel().stream(request("Who am I?")));
    expect(events).toEqual([
      { type: "text", text: "GET /v1/me (operation) is in this Spec." },
      {
        type: "citation",
        documentIndex: 1,
        cited: OPERATION.text.slice(0, 80),
      },
      { type: "usage", input: 100, cached: 0, output: 20 },
      { type: "done", stopReason: "end_turn" },
    ]);
  });

  it("says the Spec doesn't say when there is no operation", async () => {
    const events = await collect(
      new FakeModel().stream(request("Who am I?", [FACTS])),
    );
    expect(events[0]).toEqual({ type: "text", text: "The Spec doesn't say." });
    expect(events.some((e) => e.type === "citation")).toBe(false);
  });
});
