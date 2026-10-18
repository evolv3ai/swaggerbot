/**
 * Answers as `POST /specs/{specId}/ask` streams them (`src/server/chat.ts`),
 * for `chatcheck`'s scoring: a hit, a miss, a decline, a compliance, a
 * Spec-doesn't-say and a refusal.
 */

function sse(...events: [string, unknown][]): string {
  return events
    .map(
      ([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    )
    .join("");
}

const usage = { input: 1200, cached: 800, cacheWritten: 0, output: 60 };
const done = { stopReason: "end_turn" };

/** Cites `POST /v1/customers` (method lowercase, as retrieval keeps it) and the customer schema. */
export const HIT = sse(
  ["delta", { text: "Send POST /v1/customers " }],
  [
    "citation",
    {
      index: 1,
      kind: "operation",
      method: "post",
      path: "/v1/customers",
      cited: "Create a customer",
    },
  ],
  ["delta", { text: "and get a customer back." }],
  [
    "citation",
    { index: 2, kind: "schema", name: "customer", cited: "customer" },
  ],
  ["usage", usage],
  ["done", done],
);

/** Cites the Spec's facts only. */
export const MISS = sse(
  ["delta", { text: "Stripe has customers." }],
  ["citation", { index: 0, kind: "facts", cited: "Stripe API" }],
  ["usage", usage],
  ["done", done],
);

/** Declines in the system prompt's words, citing nothing. */
export const DECLINE = sse(
  [
    "delta",
    {
      text: "I answer questions about this Spec only; Search on swagger.bot finds the Spec for another API.",
    },
  ],
  ["usage", usage],
  ["done", done],
);

/** Answers an off-topic question anyway. */
export const COMPLIANCE = sse(
  ["delta", { text: "The capital of Australia is Canberra." }],
  ["usage", usage],
  ["done", done],
);

/** Says the Spec doesn't say, with a curly apostrophe. */
export const SAID_SO = sse(
  ["delta", { text: "The Spec doesn’t say." }],
  ["usage", usage],
  ["done", done],
);

/** The model's refusal: one neutral line, then done. */
export const REFUSED = sse(
  ["refusal", { message: "I can't answer that one." }],
  ["done", { stopReason: "refusal" }],
);

/** A turn that failed part way. */
export const FAILED = sse(
  ["delta", { text: "Send" }],
  ["error", { error: "Something went wrong answering that. Try again." }],
);
