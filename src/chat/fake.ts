import type { Model, ModelEvent, ModelRequest } from "./model";

export type FakeModelScript = {
  /** Events to emit, keyed by the question asked. */
  answers?: Record<string, ModelEvent[]>;
  /** Events for any question not scripted; unless set, `defaultAnswer`'s. */
  default?: ModelEvent[];
};

/** A Model with scripted answers, for tests. It never calls a real model. */
export class FakeModel implements Model {
  /** Every request sent, in order. */
  readonly requests: ModelRequest[] = [];
  readonly #script: FakeModelScript;

  constructor(script: FakeModelScript = {}) {
    this.#script = script;
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(request);
    const events =
      this.#script.answers?.[request.question] ??
      this.#script.default ??
      defaultAnswer(request);
    for (const event of events) yield event;
  }
}

/**
 * One cited sentence from the request's first operation document, or "The
 * Spec doesn't say." when it has none.
 */
export function defaultAnswer(request: ModelRequest): ModelEvent[] {
  const index = request.documents.findIndex((d) => d.kind === "operation");
  const doc = request.documents[index];
  const usage: ModelEvent = {
    type: "usage",
    input: 100,
    cached: 0,
    cacheWritten: 0,
    output: 20,
  };
  const done: ModelEvent = { type: "done", stopReason: "end_turn" };
  if (!doc)
    return [{ type: "text", text: "The Spec doesn't say." }, usage, done];
  return [
    { type: "text", text: `${doc.title} is in this Spec.` },
    { type: "citation", documentIndex: index, cited: doc.text.slice(0, 80) },
    usage,
    done,
  ];
}
