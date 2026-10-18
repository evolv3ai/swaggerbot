/**
 * The seam between the chat and a text model (ADR 0007): one narrow
 * interface met by the Anthropic adapter (`anthropic.ts`, the only file that
 * imports the SDK) and by `FakeModel` (`fake.ts`) in tests, so no test calls
 * a real model and the provider can change in one file.
 */

/** A turn's `max_tokens`: a chat answer over supplied documents is short. */
export const CHAT_MAX_TOKENS = 1_500;

/**
 * One document a turn is grounded in, cut from the Spec's Normalized Form:
 * the Spec's facts, an operation or a schema. The model may cite it.
 *
 * Retrieval (`src/chat/retrieve*`) produces these; this is the minimal shape
 * the model needs, to be reconciled with retrieval's when the two are wired.
 */
export type GroundingDocument = {
  kind: "facts" | "operation" | "schema";
  /** What it is: `GET /v1/customers (operation)`, `customer (schema)`, `About this Spec`. */
  title: string;
  /** Its text, as the model reads it. */
  text: string;
  /** An operation's method, lowercase as in the Spec Outline. */
  method?: string;
  /** An operation's path. */
  path?: string;
  /** A schema's name in `components.schemas`. */
  name?: string;
};

/** An earlier turn of the conversation, sent back by the browser. */
export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
};

export type ModelRequest = {
  /** The system prompt (`systemPrompt` in `prompt.ts`). */
  system: string;
  documents: GroundingDocument[];
  history: ChatTurn[];
  question: string;
  maxTokens: number;
  /** Ends the turn early, e.g. when the Caller goes away. */
  signal?: AbortSignal;
};

export type ModelEvent =
  /** A piece of the answer's text. */
  | { type: "text"; text: string }
  /**
   * A citation of the text before it: `documentIndex` is the cited document's
   * index in `ModelRequest.documents`, `cited` the text it quotes.
   */
  | { type: "citation"; documentIndex: number; cited: string }
  /**
   * Tokens the turn used: uncached input, input read from the cache, input
   * written to the cache, output.
   */
  | {
      type: "usage";
      input: number;
      cached: number;
      cacheWritten: number;
      output: number;
    }
  /** The model declined to answer; never shown as text. */
  | { type: "refusal"; category?: string }
  /** The turn ended, with the model's stop reason. */
  | { type: "done"; stopReason: string }
  /** The turn failed: `kind` names the error's class, never the request. */
  | { type: "error"; kind: string };

export type Model = {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
};
