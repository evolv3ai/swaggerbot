import type { SpecOutline } from "~/domain/spec-forms";

/** Operations on a page of a Spec Outline when the Caller asks for no other number. */
export const DEFAULT_PAGE_LIMIT = 100;

/** The most operations `GET /api/apis/{apiId}/outline` puts on one page. */
export const MAX_HTTP_PAGE_LIMIT = 500;

/** Over this many bytes (as JSON), the tag list is cut to its largest tags. */
export const MAX_TAGS_BYTES = 20_000;

/** How many tags are kept, by operation count, when the list is cut. */
export const CUT_TAG_COUNT = 200;

/** The longest summary a page keeps when it is held to `maxBytes`. */
const MAX_SUMMARY_CHARS = 300;

/** What narrows a page of a Spec Outline. Every field is optional. */
export type OutlinePageOptions = {
  /** A tag name, ignoring case. */
  tag?: string;
  /** A substring, ignoring case, of the path, `operationId` or summary. */
  query?: string;
  /** Where the page starts: a previous page's `nextCursor`. */
  cursor?: string;
  /** At most this many operations; `DEFAULT_PAGE_LIMIT` when absent. */
  limit?: number;
  /**
   * Fewer operations, and summaries cut to 300 characters, so that the
   * page as JSON stays within this many bytes.
   */
  maxBytes?: number;
};

type OutlineOperation = SpecOutline["operations"][number];

/** One page of a Spec Outline, and what the whole outline and the filter hold. */
export type OutlinePage = {
  apiId: string;
  specId: string;
  title: string | null;
  apiVersion: string | null;
  servers: string[];
  securitySchemes: SpecOutline["securitySchemes"];
  /** Every tag with its count, unless cut (`tagsCut`). */
  tags: SpecOutline["tags"];
  /** Present when `tags` holds only the largest `CUT_TAG_COUNT` tags. */
  tagsCut?: true;
  operations: OutlineOperation[];
  totalOperations: number;
  matchedOperations: number;
  /** The `cursor` of the next page, or null on the last one. */
  nextCursor: string | null;
};

/** A cursor that is not one this code handed out. */
export class BadCursorError extends Error {}

/**
 * One page of the Spec Outline `outline` (ADR 0005): its operations that
 * match `tag` and `query`, in outline order, from `cursor` on, at most
 * `limit` of them. `tags` is always the whole outline's list with counts,
 * unless that list alone is over `MAX_TAGS_BYTES`; then it is the
 * `CUT_TAG_COUNT` tags with the most operations, and `tagsCut` is set.
 *
 * The cursor is the offset into the matching operations, as a string.
 * Throws `BadCursorError` for a cursor that isn't one.
 */
export function pageOutline(
  {
    apiId,
    specId,
    outline,
  }: { apiId: string; specId: string; outline: SpecOutline },
  options: OutlinePageOptions = {},
): OutlinePage {
  const offset = offsetOf(options.cursor);
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
  const tag = options.tag?.toLowerCase();
  const query = options.query?.toLowerCase();

  const matched = outline.operations.filter(
    (op) =>
      (!tag || op.tags.some((t) => t.toLowerCase() === tag)) &&
      (!query ||
        op.path.toLowerCase().includes(query) ||
        op.operationId?.toLowerCase().includes(query) ||
        op.summary?.toLowerCase().includes(query)),
  );
  let operations = matched.slice(offset, offset + limit);

  const page: OutlinePage = {
    apiId,
    specId,
    title: outline.title,
    apiVersion: outline.apiVersion,
    servers: outline.servers,
    securitySchemes: outline.securitySchemes,
    ...tagsOf(outline.tags),
    operations: [],
    totalOperations: outline.operations.length,
    matchedOperations: matched.length,
    nextCursor: null,
  };

  if (options.maxBytes !== undefined) {
    operations = operations.map(shortened);
    // The page without operations, with the longest cursor it could carry,
    // then each operation and the comma before it until the budget is met.
    let bytes = byteLength({ ...page, nextCursor: String(matched.length) });
    let fits = 0;
    for (const op of operations) {
      bytes += byteLength(op) + (fits > 0 ? 1 : 0);
      if (bytes > options.maxBytes && fits > 0) break;
      fits += 1;
    }
    operations = operations.slice(0, fits);
  }

  const end = offset + operations.length;
  return {
    ...page,
    operations,
    nextCursor: end < matched.length ? String(end) : null,
  };
}

/** The offset a cursor stands for: 0 without one. */
function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(0|[1-9]\d{0,8})$/.test(cursor))
    throw new BadCursorError(
      `"${cursor}" is not a cursor. Pass a page's nextCursor as it was given.`,
    );
  return Number(cursor);
}

function tagsOf(
  tags: SpecOutline["tags"],
): Pick<OutlinePage, "tags" | "tagsCut"> {
  if (byteLength(tags) <= MAX_TAGS_BYTES) return { tags };
  // A stable sort: tags with the same count keep the outline's order.
  const largest = [...tags]
    .sort((a, b) => b.operationCount - a.operationCount)
    .slice(0, CUT_TAG_COUNT);
  return { tags: largest, tagsCut: true };
}

function shortened(op: OutlineOperation): OutlineOperation {
  return op.summary && op.summary.length > MAX_SUMMARY_CHARS
    ? { ...op, summary: `${op.summary.slice(0, MAX_SUMMARY_CHARS - 1)}…` }
    : op;
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
