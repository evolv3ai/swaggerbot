import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { schemaNameOf, truncatedReferences } from "~/spec-forms/operation";
import {
  type FormsRefusal,
  normalizedCache,
  openNormalized,
  PENDING_RETRY_AFTER_SECONDS,
} from "~/spec-forms/operation-http";
import type { McpDeps } from "../server";

/**
 * The most `get_operation`'s and `get_schema`'s answer may weigh, serialized,
 * in bytes: with the text beside it, a result stays under the ~30 kB an
 * agent takes in one result (ADR 0005).
 */
export const MCP_EXPANDED_MAX_BYTES = 24_000;

/** How many of the references an expansion left its text names. */
const NAMED_REFERENCES = 5;

export const ApiIdInput = z
  .string()
  .min(1)
  .describe(
    'The API\'s id, as lookup_api gives it, e.g. "stripe.com/stripe-api".',
  );

export const SpecIdInput = z
  .string()
  .optional()
  .describe(
    "One of the API's Specs (an Alternate Spec, say), as lookup_api gives it. Leave it out for the Current Spec.",
  );

/** A JSON object whose keys are the Spec's own. */
export const JsonObject = z.record(z.string(), z.unknown());

/**
 * The parsed Normalized Form of the API's Current Spec, or of `specId`,
 * with the Index it came from; else the tool error that says why not and
 * what to call instead.
 */
export async function openForTool(
  { getApp, cache = normalizedCache }: McpDeps,
  apiId: string,
  specId: string | undefined,
): Promise<
  | { specId: string; doc: unknown; db: ReturnType<McpDeps["getApp"]>["db"] }
  | { error: CallToolResult }
> {
  const { db, lookup } = getApp();
  const opened = await openNormalized(apiId, specId, { db, lookup, cache });
  if ("status" in opened) return { error: refusalResult(opened, specId) };
  return { ...opened, db };
}

/** A tool error: `isError` with the text that says what went wrong and the call that fixes it. */
export function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

/**
 * What the expansion left for the agent to follow: how many references are
 * `{ $ref, "x-truncated": true }` and the `get_schema` call that follows
 * one, and the schemas listed in `circular`.
 */
export function referencesText(
  expanded: { circular: Record<string, unknown>; truncated: boolean },
  apiId: string,
  specId: string | undefined,
): string {
  const parts: string[] = [];
  const left = truncatedReferences(expanded);
  if (left.length === 0) parts.push("Every reference is inlined.");
  else {
    const schemas = left
      .map((ref) => ({ ref, name: schemaNameOf(ref) }))
      .filter(({ ref, name }) => name !== ref)
      .map(({ name }) => name);
    parts.push(
      `To keep this result small, ${left.length} reference${left.length === 1 ? " was" : "s were"} left as { $ref, "x-truncated": true }.`,
    );
    const [first] = schemas;
    if (first !== undefined)
      parts.push(
        `The schemas left, which get_schema returns: ${schemas
          .slice(0, NAMED_REFERENCES)
          .map((n) => `"${n}"`)
          .join(
            ", ",
          )}${schemas.length > NAMED_REFERENCES ? ` and ${schemas.length - NAMED_REFERENCES} more` : ""}. Next: get_schema(apiId: "${apiId}", name: "${first}"${specId ? `, specId: "${specId}"` : ""}).`,
      );
  }
  const circular = Object.keys(expanded.circular);
  if (circular.length > 0)
    parts.push(
      `${circular.length} schema${circular.length === 1 ? " recurs" : "s recur"} within itself; where it does it is { $ref, "x-circular": true }, and circular holds it once.`,
    );
  return parts.join(" ");
}

function refusalResult(
  refusal: FormsRefusal,
  specId: string | undefined,
): CallToolResult {
  switch (refusal.status) {
    case 404:
      return toolError(
        `${refusal.body.error} ${
          specId
            ? "Leave out specId for the Current Spec; lookup_api lists an API's Specs."
            : "Next: lookup_api(name) gives an API's apiId, adding it to the Index if it isn't there."
        }`,
      );
    case 409:
      return toolError(
        `The Spec's Normalized Form is still being built. Retry in ${PENDING_RETRY_AFTER_SECONDS} s.`,
      );
    case 422:
      return toolError(
        `The Spec's Normalized Form could not be built (${refusal.body.error}), so its operations and schemas can't be expanded. Its Published Form can still be downloaded: lookup_api gives the URL.`,
      );
  }
}
