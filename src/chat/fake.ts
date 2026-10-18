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

/** A question `devFakeModel` declines, to show the declined state. */
export const DEV_DECLINED_QUESTION = /^\s*(call|fetch|run)\b/i;

/**
 * The model `CHAT_FAKE=1` wires in (development only, `chatConfigOf`):
 * `defaultAnswer`'s cited sentence, sent a word at a time `delayMs` apart so
 * the panel can be seen streaming; a question starting "Call", "Fetch" or
 * "Run" is declined, as the real model declines calling the API.
 */
export function devFakeModel({ delayMs = 120 } = {}): Model {
  return {
    async *stream(request) {
      const pause = () =>
        new Promise<void>((resolve, reject) => {
          if (request.signal?.aborted) return reject(request.signal.reason);
          setTimeout(resolve, delayMs);
        });
      if (DEV_DECLINED_QUESTION.test(request.question)) {
        await pause();
        yield { type: "refusal", category: "dev" };
        yield { type: "done", stopReason: "refusal" };
        return;
      }
      for (const event of defaultAnswer(request)) {
        if (event.type !== "text") {
          yield event;
          continue;
        }
        for (const word of event.text.match(/\S+\s*/g) ?? []) {
          await pause();
          yield { type: "text", text: word };
        }
      }
    },
  };
}
