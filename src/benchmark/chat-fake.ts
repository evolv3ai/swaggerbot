import { defaultAnswer } from "~/chat/fake";
import type { Model, ModelEvent, ModelRequest } from "~/chat/model";
import type { ChatBenchmark, ChatQuestion } from "./chat-benchmark";

/** What the scripted model says for a question the Spec doesn't answer. */
export const FAKE_NOT_IN_SPEC = "The Spec doesn't say.";
/** For a question not about the Spec. */
export const FAKE_OFF_TOPIC =
  "I answer questions about this Spec only; Search on swagger.bot finds the Spec for another API.";
/** For a request to call the API, fetch a URL or use a credential. */
export const FAKE_ACTION =
  "I can't call the API, fetch a URL or use credentials; I can say what the Spec says about how to do it.";

/**
 * A Model that answers the chat Benchmark's questions as a good model
 * would, for running `chatcheck` against a server with no real model
 * (`CHAT_FAKE=1`). An answerable question cites each expected operation and
 * schema the turn's documents hold (or the Spec's facts, when nothing is
 * expected), so a document retrieval left out shows up as a miss; the other
 * classes say the Spec doesn't say, or decline. A question not in the
 * benchmark gets `FakeModel`'s default answer. It never calls a real model.
 */
export function createBenchmarkModel(benchmark: ChatBenchmark): Model {
  const byQuestion = new Map<string, ChatQuestion>();
  for (const spec of benchmark)
    for (const q of spec.questions) byQuestion.set(q.question, q);

  return {
    async *stream(request) {
      const q = byQuestion.get(request.question.trim());
      const events = q ? answerOf(q, request) : defaultAnswer(request);
      for (const event of events) yield event;
    },
  };
}

function answerOf(q: ChatQuestion, request: ModelRequest): ModelEvent[] {
  const end: ModelEvent[] = [
    { type: "usage", input: 1_000, cached: 0, cacheWritten: 0, output: 40 },
    { type: "done", stopReason: "end_turn" },
  ];
  if (q.class === "not-in-spec")
    return [{ type: "text", text: FAKE_NOT_IN_SPEC }, ...end];
  if (q.class === "off-topic")
    return [{ type: "text", text: FAKE_OFF_TOPIC }, ...end];
  if (q.class === "action")
    return [{ type: "text", text: FAKE_ACTION }, ...end];

  const wanted = new Set([
    ...(q.expect.operations ?? []).map(
      (o) => `${o.method.toLowerCase()} ${o.path}`,
    ),
    ...(q.expect.schemas ?? []).map((name) => `schema ${name}`),
  ]);
  const cited = request.documents.flatMap((doc, index) => {
    const key =
      doc.kind === "operation"
        ? `${doc.ref.method.toLowerCase()} ${doc.ref.path}`
        : doc.kind === "schema"
          ? `schema ${doc.ref.name}`
          : undefined;
    const pick =
      wanted.size === 0 ? doc.kind === "facts" : wanted.has(key ?? "");
    return pick ? [{ doc, index }] : [];
  });
  if (cited.length === 0)
    return [{ type: "text", text: FAKE_NOT_IN_SPEC }, ...end];
  return [
    ...cited.flatMap(({ doc, index }): ModelEvent[] => [
      { type: "text", text: `${doc.title} answers this. ` },
      { type: "citation", documentIndex: index, cited: doc.text.slice(0, 80) },
    ]),
    ...end,
  ];
}
