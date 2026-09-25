/** `/vendors`, with the filter and page given, leaving out what's empty. */
export function vendorsHref(query: string, cursor?: string): string {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (cursor) params.set("cursor", cursor);
  const search = params.toString();
  return search ? `/vendors?${search}` : "/vendors";
}

/** `/vendors/{vendorId}`. */
export function vendorHref(vendorId: string): string {
  return `/vendors/${encodeURIComponent(vendorId)}`;
}
