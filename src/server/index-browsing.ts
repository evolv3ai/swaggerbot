import type { Provenance } from "~/domain/provenance";
import type { Db } from "~/index-store/db";
import { vendorsHref } from "~/lib/vendor-hrefs";
import { answerVendorApis, type VendorApisApp } from "./vendor-apis";
import {
  BadVendorListError,
  DEFAULT_VENDORS_LIMIT,
  listVendors,
  type VendorList,
} from "./vendors";

/** What `/vendors` shows: one page of the Vendor list, or why it can't. */
export type VendorsPage =
  | {
      status: 200;
      /** The filter as given, trimmed; empty for none. */
      query: string;
      vendors: VendorList["vendors"];
      total: number;
      /** Positions of the first and last Vendor on the page, from 1; 0 and 0 on an empty page. */
      from: number;
      to: number;
      /** Links to the pages either side, null where there is none. */
      previous: string | null;
      next: string | null;
    }
  | {
      /** A `cursor` this page didn't make. */
      status: 400;
      query: string;
      error: string;
      /** The first page with the same filter. */
      first: string;
    };

/** One API of the Vendor, as `/vendors/{vendorId}` shows it. */
export type VendorPageApi = {
  id: string;
  name: string;
  /** Its Current Spec, or null when the Index holds none. */
  currentSpec: {
    id: string;
    provenance: Provenance | null;
    verifiedAt: string | null;
    /** Older than the freshness window. */
    stale: boolean;
  } | null;
};

/** What `/vendors/{vendorId}` shows: `answerVendorApis`'s three answers. */
export type VendorPage =
  | {
      status: 200;
      vendor: { id: string; name: string; domain: string };
      apis: VendorPageApi[];
    }
  | { status: 300; asked: string; vendors: { id: string; name: string }[] }
  | { status: 404; asked: string };

/**
 * The `/vendors` page's data: `listVendors` for the filter and cursor as
 * the GET form and the paging links send them, with links to the pages
 * either side. A cursor `listVendors` refuses is a 400 that links back to
 * the first page. The cursor is `listVendors`'s offset, so the previous page
 * starts `limit` before this one (the first page has no cursor).
 */
export function vendorsPage(
  db: Db,
  { query = "", cursor }: { query?: string; cursor?: string },
  { limit = DEFAULT_VENDORS_LIMIT }: { limit?: number } = {},
): VendorsPage {
  const filter = query.trim();
  const at = cursor?.trim() || undefined;
  let list: VendorList;
  try {
    list = listVendors(db, { query: filter || undefined, cursor: at, limit });
  } catch (error) {
    if (!(error instanceof BadVendorListError)) throw error;
    return {
      status: 400,
      query: filter,
      error: "That page link isn't one this list made.",
      first: vendorsHref(filter),
    };
  }
  const offset = at ? Number(at) : 0;
  const before = offset - limit;
  return {
    status: 200,
    query: filter,
    vendors: list.vendors,
    total: list.total,
    from: list.vendors.length > 0 ? offset + 1 : 0,
    to: offset + list.vendors.length,
    previous:
      offset === 0
        ? null
        : vendorsHref(filter, before > 0 ? String(before) : undefined),
    next: list.nextCursor ? vendorsHref(filter, list.nextCursor) : null,
  };
}

/**
 * The `/vendors/{vendorId}` page's data: `answerVendorApis` for the Vendor,
 * each API reduced to what the page shows of its Current Spec, Stale when
 * it was verified more than `freshnessDays` before `now`.
 */
export function vendorPage(
  vendorId: string,
  app: VendorApisApp,
  { now = new Date(), freshnessDays }: { now?: Date; freshnessDays: number },
): VendorPage {
  const answer = answerVendorApis(vendorId, app);
  const asked = vendorId.trim();
  if (answer.status === 404) return { status: 404, asked };
  if (answer.status === 300)
    return { status: 300, asked, vendors: answer.body.vendors };
  const staleAfterMs = freshnessDays * 24 * 60 * 60 * 1000;
  const { id, name, domain } = answer.body.vendor;
  return {
    status: 200,
    vendor: { id, name, domain },
    apis: answer.body.apis.map(
      ({ api, currentSpec, provenance, verifiedAt }): VendorPageApi => {
        if (!currentSpec)
          return { id: api.id, name: api.name, currentSpec: null };
        const age = verifiedAt ? now.getTime() - Date.parse(verifiedAt) : NaN;
        return {
          id: api.id,
          name: api.name,
          currentSpec: {
            id: currentSpec.id,
            provenance,
            verifiedAt,
            stale: !(age <= staleAfterMs),
          },
        };
      },
    ),
  };
}
