import { expect } from "vitest";
import type { z } from "zod";
import { type Guidance, guidanceText } from "../result";

/**
 * Asserts a successful tool result's shape (ADR 0005, amendment):
 * `structuredContent` begins with `summary` and `next` and validates against
 * the tool's `outputSchema`, and the one text block is the summary followed
 * by the next calls. Returns the guidance.
 */
export function expectGuided(
  result: {
    isError?: boolean;
    content: { type: string; text?: string }[];
    structuredContent?: unknown;
  },
  outputSchema: z.ZodType,
): Guidance {
  expect(result.isError).toBeFalsy();
  const structured = result.structuredContent as Guidance;
  expect(Object.keys(structured).slice(0, 2)).toEqual(["summary", "next"]);
  expect(outputSchema.safeParse(structured).error).toBeUndefined();
  expect(result.content).toEqual([
    { type: "text", text: guidanceText(structured) },
  ]);
  return { summary: structured.summary, next: structured.next };
}
