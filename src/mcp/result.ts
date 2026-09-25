import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

/**
 * What every successful tool result begins with (ADR 0005, amendment): the
 * sentences for the agent, and the calls to make next.
 */
export const Guidance = z.object({
  summary: z
    .string()
    .describe("What was found and what was left out, for the agent."),
  next: z
    .array(z.string())
    .describe(
      'The calls to make next, e.g. get_spec_outline(apiId: "stripe.com/stripe-api"); empty when there is nothing to call.',
    ),
});
export type Guidance = z.infer<typeof Guidance>;

/** A tool's `outputSchema`: its answer's schema, with `summary` and `next` first. */
export function withGuidance<T extends z.ZodObject>(answer: T) {
  return Guidance.extend(answer.shape);
}

/**
 * A successful tool result. `structuredContent` is `{ summary, next, ...data }`,
 * with `summary` and `next` its first keys, because Claude Code shows the
 * model only `structuredContent`; the text block, for clients that show it,
 * is the summary followed by the next calls.
 */
export function toolResult<D extends object>({
  summary,
  next,
  data,
}: Guidance & {
  data: D & { summary?: never; next?: never };
}): CallToolResult {
  return {
    content: [{ type: "text", text: guidanceText({ summary, next }) }],
    structuredContent: { summary, next, ...data },
  };
}

/** The summary, then `Next: ` and the next calls joined with "; or ". */
export function guidanceText({ summary, next }: Guidance): string {
  return next.length > 0 ? `${summary} Next: ${next.join("; or ")}.` : summary;
}
