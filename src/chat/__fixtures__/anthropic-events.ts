import type { RefusalCategory, StreamEvent } from "../anthropic";

/**
 * Hand-written streams in the shapes of the Anthropic SDK's raw message
 * stream events, for the adapter's tests. Never recorded from the network.
 */

function messageStart(
  input: number,
  cached: number,
  cacheWritten: number,
): StreamEvent {
  return {
    type: "message_start",
    message: {
      id: "msg_fixture",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: [],
      container: null,
      context_management: null,
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      diagnostics: null,
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: cacheWritten,
        cache_read_input_tokens: cached,
        output_tokens: 1,
        cache_creation: null,
        inference_geo: null,
        iterations: null,
        server_tool_use: null,
        service_tier: null,
        speed: null,
        fallback_credit: null,
        output_tokens_details: null,
      },
    },
  };
}

function messageDelta(
  stopReason: "end_turn" | "refusal",
  output: number,
  input: number,
  cached: number,
  cacheWritten: number,
  category: RefusalCategory = null,
): StreamEvent {
  return {
    type: "message_delta",
    context_management: null,
    delta: {
      stop_reason: stopReason,
      stop_sequence: null,
      stop_details:
        stopReason === "refusal"
          ? {
              type: "refusal",
              category,
              explanation: null,
              fallback_credit_token: null,
              fallback_has_prefill_claim: null,
              recommended_model: null,
            }
          : null,
      container: null,
    },
    usage: {
      input_tokens: input,
      cache_creation_input_tokens: cacheWritten,
      cache_read_input_tokens: cached,
      output_tokens: output,
      server_tool_use: null,
      iterations: null,
      fallback_credit: null,
      output_tokens_details: null,
    },
  };
}

const textStart = (index: number): StreamEvent => ({
  type: "content_block_start",
  index,
  content_block: { type: "text", text: "", citations: null },
});

const textDelta = (index: number, text: string): StreamEvent => ({
  type: "content_block_delta",
  index,
  delta: { type: "text_delta", text },
});

const citationDelta = (
  index: number,
  documentIndex: number,
  cited: string,
): StreamEvent => ({
  type: "content_block_delta",
  index,
  delta: {
    type: "citations_delta",
    citation: {
      type: "char_location",
      cited_text: cited,
      document_index: documentIndex,
      document_title: null,
      start_char_index: 0,
      end_char_index: cited.length,
      file_id: null,
    },
  },
});

const blockStop = (index: number): StreamEvent => ({
  type: "content_block_stop",
  index,
});

/**
 * A cited answer: a sentence citing the second document sent, then an
 * uncited one.
 */
export const citedAnswer: StreamEvent[] = [
  messageStart(1200, 0, 300),
  textStart(0),
  citationDelta(0, 1, "List all customers."),
  textDelta(0, "GET /v1/customers "),
  textDelta(0, "lists customers."),
  blockStop(0),
  textStart(1),
  textDelta(1, " That is all."),
  blockStop(1),
  messageDelta("end_turn", 42, 1200, 900, 300),
  { type: "message_stop" },
];

/** A refusal in the `cyber` category, after no text. */
export const refusal: StreamEvent[] = [
  messageStart(800, 0, 0),
  messageDelta("refusal", 3, 800, 0, 0, "cyber"),
  { type: "message_stop" },
];

/** A refusal with no named category. */
export const uncategorizedRefusal: StreamEvent[] = [
  messageStart(800, 0, 0),
  messageDelta("refusal", 3, 800, 0, 0, null),
  { type: "message_stop" },
];

/** The start of an answer; the stream then stops or fails. */
export const answerStart: StreamEvent[] = [
  messageStart(500, 0, 0),
  textStart(0),
  textDelta(0, "Partly"),
];
