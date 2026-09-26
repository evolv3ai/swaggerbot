import { z } from "zod";
import type { LookupRequest } from "~/lookup/lookup";

/**
 * A query value, as the router parses it: each value is read as JSON when
 * it can be (`?apiVersion=3` is the number 3, `?allowCommunity=1` the
 * number 1). The values are kept as parsed, so the router writes the same
 * URL back, and read as text by `lookupRequestOf`. Anything else is dropped.
 */
const value = z
  .union([z.string(), z.number(), z.boolean()])
  .optional()
  .catch(undefined);

/**
 * The query of `/lookup?name=…[&apiVersion=…][&allowCommunity=1]`, as sent
 * by the Search form. Loose on purpose: a page answers any query, and a
 * missing or blank `name` has its own view.
 */
export const LookupSearch = z.object({
  name: value,
  apiVersion: value,
  allowCommunity: value,
});
export type LookupSearch = z.infer<typeof LookupSearch>;

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
