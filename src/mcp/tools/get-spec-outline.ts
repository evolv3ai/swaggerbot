import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  answerOutline,
  type OutlineAnswer,
  PENDING_RETRY_AFTER_SECONDS,
} from "~/spec-forms/http";
import {
  BadCursorError,
  DEFAULT_PAGE_LIMIT,
  type OutlinePage,
  pageOutline,
} from "~/spec-forms/outline-page";
import type { McpTool } from "../server";

/** The most bytes a result may hold: `structuredContent` as JSON plus the text. */
export const MAX_RESULT_BYTES = 30_000;

/** What the page may take, leaving room for the downloads and the text. */
const PAGE_BYTES = 26_000;

const DESCRIPTION = `Find operations in an API's Spec: its Spec Outline (title, servers, security schemes, tags with operation counts, and the operations as method, path, operationId, summary and tags), filtered and paged so it fits in your context.

Give the apiId from lookup_api or list_vendor_apis. Narrow the operations with tag (a tag name, any case) and/or query (a word found in the path, operationId or summary, any case, e.g. "customers"). A large Spec without a filter gives its tag list and only its first ${DEFAULT_PAGE_LIMIT} operations: filter rather than page through it. When there is more, the result's nextCursor is the cursor for the next page.

specId picks one of the API's Specs other than its Current Spec (an Alternate Spec from lookup_api's alternateSpecs).

Next: get_operation(apiId, method, path) for the operation you need, with path exactly as the outline gives it.`;

const GetSpecOutlineInput = z.object({
  apiId: z
    .string()
    .describe('The API\'s id, from lookup_api, e.g. "stripe.com/stripe-api".'),
  specId: z
    .string()
    .optional()
    .describe(
      "One of the API's Specs other than its Current Spec; omit for the Current Spec.",
    ),
  tag: z
    .string()
    .max(200)
    .optional()
    .describe("Only operations with this tag (any case)."),
  query: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Only operations whose path, operationId or summary contains this (any case).",
    ),
  cursor: z
    .string()
    .max(20)
    .optional()
    .describe("A previous result's nextCursor, for the page after it."),
});
type GetSpecOutlineInput = z.infer<typeof GetSpecOutlineInput>;

/**
 * `get_spec_outline`: the outline route's answer (`answerOutline`), one
 * page of at most 100 operations, held to `MAX_RESULT_BYTES` (ADR 0005).
 */
export const registerGetSpecOutline: McpTool = (
  server,
  { getApp, baseUrl },
) => {
  server.registerTool(
    "get_spec_outline",
    {
      title: "Find operations in an API's Spec",
      description: DESCRIPTION,
      inputSchema: GetSpecOutlineInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (input) =>
      outlineResult(
        input,
        answerOutline(input.apiId, input.specId ?? null, getApp, baseUrl),
      ),
  );
};

/** The outline route's answer as a tool result: one page, or the error. */
export function outlineResult(
  input: GetSpecOutlineInput,
  answer: OutlineAnswer,
): CallToolResult {
  if (answer.status !== 200) return errorResult(errorText(input, answer));
  let page: OutlinePage;
  try {
    page = pageOutline(answer.body, {
      tag: input.tag || undefined,
      query: input.query || undefined,
      cursor: input.cursor,
      limit: DEFAULT_PAGE_LIMIT,
      maxBytes: PAGE_BYTES,
    });
  } catch (error) {
    if (error instanceof BadCursorError) return errorResult(error.message);
    throw error;
  }
  return {
    content: [{ type: "text", text: pageText(input, page) }],
    structuredContent: { ...page, downloads: answer.body.downloads },
  };
}

function errorResult(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function errorText(
  input: GetSpecOutlineInput,
  answer: Exclude<OutlineAnswer, { status: 200 }>,
): string {
  const { body } = answer;
  if ("status" in body)
    return body.status === "pending"
      ? `The Normalized Form of this Spec is still being built, so its outline isn't ready: retry in ${PENDING_RETRY_AFTER_SECONDS} s.`
      : `The Normalized Form of this Spec could not be built (${body.error}), so it has no outline. Download the Spec from lookup_api's result instead.`;
  if (answer.status === 404 && input.specId === undefined)
    return `${body.error} Next: lookup_api(name) with the API's name, which gives its apiId.`;
  if (answer.status === 404)
    return `${body.error} Next: get_spec_outline(apiId: "${input.apiId}") without specId for its Current Spec, or lookup_api(name) for the ids of its Specs.`;
  return body.error;
}

/** What the page shows, and the call to make next. */
function pageText(input: GetSpecOutlineInput, page: OutlinePage): string {
  const name = page.title
    ? `${page.title} (apiId "${page.apiId}")`
    : `apiId "${page.apiId}"`;
  const filter = filterText(input);
  const first = Number(input.cursor ?? 0) + 1;
  const last = first + page.operations.length - 1;
  const call = (args: string) =>
    `get_spec_outline(apiId: "${page.apiId}"${input.specId ? `, specId: "${input.specId}"` : ""}${args})`;
  const tagNames = page.tags
    .slice(0, 5)
    .map((t) => `"${t.name}"`)
    .join(", ");

  if (page.matchedOperations === 0)
    return `${name}: no operation matches ${filter} (of ${page.totalOperations} in all).${
      tagNames ? ` Its tags include ${tagNames}; tags lists them all.` : ""
    } Next: ${call(", query: …")} with another word, or a tag from the list.`;

  const sentences: string[] = [];
  if (!filter && page.totalOperations > DEFAULT_PAGE_LIMIT) {
    const largest = [...page.tags].sort(
      (a, b) => b.operationCount - a.operationCount,
    )[0];
    const byQuery = `${call(', query: "…"')} for a word in the path, operationId or summary`;
    sentences.push(
      largest
        ? `${name} has ${page.totalOperations} operations in ${page.tags.length}${page.tagsCut ? " (the largest)" : ""} tags, listed in tags with their counts. These are operations ${first}–${last} only.`
        : `${name} has ${page.totalOperations} operations and no tags. These are operations ${first}–${last} only.`,
      largest
        ? `Filter rather than page through them: ${call(`, tag: ${JSON.stringify(largest.name)}`)} for one tag, or ${byQuery}.`
        : `Filter rather than page through them: ${byQuery}.`,
    );
  } else if (page.operations.length === 0)
    sentences.push(
      `${name}: ${page.matchedOperations} operations match${filter ? ` ${filter}` : ""}, all before this cursor. Next: ${call(filter ? filterArgs(input) : "")} for the first page.`,
    );
  else
    sentences.push(
      `${name}: operations ${first}–${last} of ${page.matchedOperations}${filter ? ` matching ${filter}` : ""}${
        page.matchedOperations < page.totalOperations
          ? ` (of ${page.totalOperations} in all)`
          : ""
      }.`,
    );

  const op = page.operations[0];
  if (op)
    sentences.push(
      `Next: get_operation(apiId: "${page.apiId}", method: "${op.method}", path: "${op.path}"${input.specId ? `, specId: "${input.specId}"` : ""}) for one of these operations${
        page.nextCursor
          ? `, or ${call(`${filterArgs(input)}, cursor: "${page.nextCursor}"`)} for the next page`
          : ""
      }.`,
    );
  return sentences.join(" ");
}

function filterText({ tag, query }: GetSpecOutlineInput): string {
  return [tag ? `tag "${tag}"` : "", query ? `query "${query}"` : ""]
    .filter(Boolean)
    .join(" and ");
}

function filterArgs({ tag, query }: GetSpecOutlineInput): string {
  return `${tag ? `, tag: ${JSON.stringify(tag)}` : ""}${query ? `, query: ${JSON.stringify(query)}` : ""}`;
}
