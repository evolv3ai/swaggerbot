import type { LookupRequest } from "~/lookup/lookup";

/**
 * A query value, as the router parses it: each value is read as JSON when
 * it can be (`?apiVersion=3` is the number 3, `?allowCommunity=1` the
 * number 1). The values are kept as parsed, so the router writes the same
 * URL back, and read as text by `lookupRequestOf`. Anything else is dropped.
 */
type Value = string | number | boolean | undefined;

function scalarOf(v: unknown): Value {
  return typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
    ? v
    : undefined;
}

/**
 * The query of `/lookup?name=…[&apiVersion=…][&allowCommunity=1]`, as sent
 * by the Search form. Loose on purpose: a page answers any query, and a
 * missing or blank `name` has its own view.
 */
export type LookupSearch = {
  name?: Value;
  apiVersion?: Value;
  allowCommunity?: Value;
};

/**
 * Reads a `/lookup` query; it never throws. Hand-written rather than a zod
 * schema: the `/lookup` route validates its search in the browser too, and
 * zod would be most of the client's JavaScript.
 */
export const LookupSearch = {
  parse(search: unknown): LookupSearch {
    const q =
      typeof search === "object" && search !== null
        ? (search as Record<string, unknown>)
        : {};
    const out: LookupSearch = {};
    for (const key of ["name", "apiVersion", "allowCommunity"] as const) {
      const v = scalarOf(q[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  },
};

/** A query value as the text that was sent. */
function textOf(v: LookupSearch[keyof LookupSearch]): string {
  return v === undefined ? "" : String(v).trim();
}

/**
 * The Lookup a `/lookup` query asks for, or null without a name. A blank
 * `apiVersion` means none (the Search form always sends the field);
 * `allowCommunity` is on for `1`, `true` or `on`. There is no `fresh`: the
 * page answers from the Index only (Slice 6 backlog, D5).
 */
export function lookupRequestOf(search: LookupSearch): LookupRequest | null {
  const name = textOf(search.name).slice(0, 200);
  if (!name) return null;
  const apiVersion = textOf(search.apiVersion) || undefined;
  const allowCommunity = ["1", "true", "on"].includes(
    textOf(search.allowCommunity).toLowerCase(),
  );
  return {
    name,
    ...(apiVersion ? { apiVersion } : {}),
    ...(allowCommunity ? { allowCommunity } : {}),
  };
}

/**
 * The `/lookup` query for a Lookup, to link to it (an Ambiguous candidate
 * retries with its name, keeping the rest of the request).
 */
export function lookupSearchOf(request: LookupRequest): LookupSearch {
  return {
    name: request.name,
    ...(request.apiVersion ? { apiVersion: request.apiVersion } : {}),
    ...(request.allowCommunity ? { allowCommunity: 1 } : {}),
  };
}

/**
 * `/lookup?name=…`: a default Lookup of `name`, as a plain link. Encoded as
 * the router writes a query, so following it doesn't redirect.
 */
export function lookupHref(name: string): string {
  return `/lookup?${new URLSearchParams({ name })}`;
}
