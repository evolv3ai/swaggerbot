import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaRefusalStopDetails,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type {
  GroundingDocument,
  Model,
  ModelEvent,
  ModelRequest,
} from "./model";
import type { ChatEffort } from "./prompt";

/** A raw event of the SDK's message stream, for hand-written fixtures. */
export type StreamEvent = BetaRawMessageStreamEvent;

/** A refusal's `stop_details.category`. */
export type RefusalCategory = BetaRefusalStopDetails["category"];

/** The request the adapter sends, for tests to inspect. */
export type StreamParams = BetaMessageStreamParams;

/**
 * The part of the SDK client the adapter uses: `client.beta.messages`, since
 * the refusal fallback is a beta parameter. Tests pass a fake.
 */
export type MessagesClient = {
  stream(
    params: StreamParams,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<StreamEvent>;
};

/** The server-side refusal fallback's beta, for `fallbacks: "default"`. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** A turn is cut off after this long. */
export const TURN_TIMEOUT_MS = 60_000;

export type AnthropicModelOptions = {
  apiKey: string;
  model: string;
  effort: ChatEffort;
  /** Replaces the SDK client, for tests. */
  messages?: MessagesClient;
  timeoutMs?: number;
};

/** The chat's model: Claude through the Anthropic SDK, streaming. */
export function createAnthropicModel(opts: AnthropicModelOptions): Model {
  const timeoutMs = opts.timeoutMs ?? TURN_TIMEOUT_MS;
  const messages =
    opts.messages ??
    new Anthropic({ apiKey: opts.apiKey, timeout: timeoutMs }).beta.messages;
  return {
    stream: (request) =>
      streamTurn(messages, anthropicRequest(request, opts), request, timeoutMs),
  };
}

/**
 * The Messages API request for a turn. The system prompt and the Spec's
 * facts come first and carry cache breakpoints, so the turns of one
 * conversation reuse them; the other documents, the history and the question
 * follow. The facts document is sent first whatever its place in
 * `request.documents`; citations are mapped back to that order.
 */
export function anthropicRequest(
  request: ModelRequest,
  opts: Pick<AnthropicModelOptions, "model" | "effort">,
): StreamParams {
  const documents: BetaContentBlockParam[] = sentDocuments(request).map(
    ({ doc }) => ({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: doc.text },
      title: doc.title,
      citations: { enabled: true },
      ...(doc.kind === "facts"
        ? { cache_control: { type: "ephemeral" as const } }
        : {}),
    }),
  );
  const messages: BetaMessageParam[] = [
    ...(documents.length > 0
      ? [{ role: "user" as const, content: documents }]
      : []),
    ...request.history.map((turn) => ({
      role: turn.role,
      content: turn.text,
    })),
    { role: "user", content: request.question },
  ];
  return {
    model: opts.model,
    max_tokens: request.maxTokens,
    system: [
      {
        type: "text",
        text: request.system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
    output_config: { effort: opts.effort },
    betas: [FALLBACK_BETA],
    fallbacks: "default",
  };
}

/**
 * `request.documents` in the order they are sent, facts first, each with its
 * index in `request.documents`.
 */
function sentDocuments(
  request: ModelRequest,
): { doc: GroundingDocument; index: number }[] {
  const all = request.documents.map((doc, index) => ({ doc, index }));
  return [
    ...all.filter(({ doc }) => doc.kind === "facts"),
    ...all.filter(({ doc }) => doc.kind !== "facts"),
  ];
}

async function* streamTurn(
  messages: MessagesClient,
  params: StreamParams,
  request: ModelRequest,
  timeoutMs: number,
): AsyncIterable<ModelEvent> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = request.signal
    ? AbortSignal.any([timeout, request.signal])
    : timeout;
  const order = sentDocuments(request).map(({ index }) => index);
  const usage = { input: 0, cached: 0, cacheWritten: 0, output: 0 };
  let stopReason: string | null = null;
  let refusalCategory: string | null = null;
  try {
    for await (const event of messages.stream(params, { signal })) {
      switch (event.type) {
        case "message_start":
          usage.input = event.message.usage.input_tokens;
          usage.cached = event.message.usage.cache_read_input_tokens ?? 0;
          usage.cacheWritten =
            event.message.usage.cache_creation_input_tokens ?? 0;
          usage.output = event.message.usage.output_tokens;
          break;
        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text", text: delta.text };
          } else if (delta.type === "citations_delta") {
            const citation = delta.citation;
            if (
              citation.type === "char_location" ||
              citation.type === "page_location" ||
              citation.type === "content_block_location"
            ) {
              const documentIndex = order[citation.document_index];
              if (documentIndex !== undefined)
                yield {
                  type: "citation",
                  documentIndex,
                  cited: citation.cited_text,
                };
            }
          }
          break;
        }
        case "message_delta":
          // Cumulative counts: the last delta has the turn's totals.
          usage.input = event.usage.input_tokens ?? usage.input;
          usage.cached = event.usage.cache_read_input_tokens ?? usage.cached;
          usage.cacheWritten =
            event.usage.cache_creation_input_tokens ?? usage.cacheWritten;
          usage.output = event.usage.output_tokens;
          stopReason = event.delta.stop_reason ?? stopReason;
          if (event.delta.stop_details)
            refusalCategory = event.delta.stop_details.category;
          break;
      }
    }
  } catch (error) {
    yield {
      type: "error",
      kind: timeout.aborted ? "timeout" : errorKind(error),
    };
    return;
  }
  yield { type: "usage", ...usage };
  if (stopReason === "refusal")
    yield {
      type: "refusal",
      ...(refusalCategory ? { category: refusalCategory } : {}),
    };
  yield { type: "done", stopReason: stopReason ?? "end_turn" };
}

/** An error's class name, never its message (which may quote the request). */
function errorKind(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "unknown";
}
