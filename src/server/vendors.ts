import type { Db } from "~/index-store/db";
import { createRepo } from "~/index-store/repo";

/** Vendors per page when no `limit` is given. */
export const DEFAULT_VENDORS_LIMIT = 50;
/** The most Vendors one page holds. */
export const MAX_VENDORS_LIMIT = 200;

export type ListVendorsOptions = {
  /** A substring of the Vendor's id or name, ignoring case. */
  query?: string;
  /** A page's `nextCursor`, as it was given; the first page without one. */
  cursor?: string;
  /** From 1 to `MAX_VENDORS_LIMIT`; default `DEFAULT_VENDORS_LIMIT`. */
  limit?: number;
};

/** One page of the Vendor list. */
export type VendorList = {
  vendors: { id: string; name: string; apiCount: number }[];
  /** How many Vendors match `query`, on every page. */
  total: number;
  /** The `cursor` of the next page, or null on the last one. */
  nextCursor: string | null;
};

/** A `cursor` or `limit` that `listVendors` doesn't take. */
export class BadVendorListError extends Error {}

/**
 * The Vendor list, shared by `GET /api/vendors` and the `/vendors` page: the
 * Vendors with at least one API in the Index, each with its API count, whose
 * id or name contains `query` ignoring case, ordered by name ignoring case,
 * then id, one page at a time. The cursor is the offset into that list, as a
 * string. Throws `BadVendorListError` for a cursor that isn't one or a
 * `limit` out of range.
 */
export function listVendors(
  db: Db,
  { query, cursor, limit = DEFAULT_VENDORS_LIMIT }: ListVendorsOptions = {},
): VendorList {
  if (!(Number.isInteger(limit) && limit >= 1 && limit <= MAX_VENDORS_LIMIT))
    throw new BadVendorListError(
      `limit is a whole number from 1 to ${MAX_VENDORS_LIMIT}.`,
    );
  const offset = offsetOf(cursor);
  const { vendors, total } = createRepo(db).pageVendorsWithApis({
    query,
    offset,
    limit,
  });
  const end = offset + vendors.length;
  return {
    vendors,
    total,
    nextCursor: vendors.length > 0 && end < total ? String(end) : null,
  };
}

/** `GET /api/vendors[?query=&cursor=&limit=]`: `listVendors` as JSON, 400 for a bad `limit` or `cursor`. */
export function vendorsResponse(request: Request, getDb: () => Db): Response {
  const params = new URL(request.url).searchParams;
  const limitParam = params.get("limit");
  try {
    return Response.json(
      listVendors(getDb(), {
        query: params.get("query") ?? undefined,
        cursor: params.get("cursor") ?? undefined,
        limit: limitParam === null ? undefined : Number(limitParam),
      }),
    );
  } catch (error) {
    if (error instanceof BadVendorListError)
      return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}

/** The offset a cursor stands for: 0 without one. */
function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined) return 0;
  if (!/^(0|[1-9]\d{0,8})$/.test(cursor))
    throw new BadVendorListError(
      `"${cursor}" is not a cursor. Pass a page's nextCursor as it was given.`,
    );
  return Number(cursor);
}
