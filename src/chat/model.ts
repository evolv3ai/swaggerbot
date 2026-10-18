/**
 * The seam between the chat and a text model (ADR 0007): one narrow
 * interface met by the Anthropic adapter (`anthropic.ts`, the only file that
 * imports the SDK) and by `FakeModel` (`fake.ts`) in tests, so no test calls
 * a real model and the provider can change in one file.
 */
import type { ChatTurn, GroundingDocument } from "./retrieve";

/** A turn's `max_tokens`: a chat answer over supplied documents is short. */
export const CHAT_MAX_TOKENS = 1_500;

/**
 * A turn's documents and history are retrieval's (`retrieve.ts`): the model
 * reads a document's `kind`, `title` and `text`, and a turn's `role` and
 * `text`; what an answer cited stays with retrieval.
 */
export type { ChatTurn, GroundingDocument };

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
