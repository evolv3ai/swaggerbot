import { registrableDomain } from "./domain";
import type { WebSearch } from "./web-search";

/** Registrable domains that host content about APIs but are never the Vendor. */
export const NON_VENDOR_DOMAINS: readonly string[] = [
  "github.com",
  "stackoverflow.com",
  "medium.com",
  "apis.guru",
  "rapidapi.com",
  "postman.com",
  "wikipedia.org",
];

export const MAX_PORTAL_CANDIDATES = 5;

/** A page that may belong to the Vendor's Developer Portal. */
export interface PortalCandidate {
  url: string;
  /** Registrable domain of `url`. */
  domain: string;
  title: string;
  snippet: string;
}

/**
 * Searches the web for the Developer Portal of the API called `name`: at most
 * five Candidates, one per registrable domain, in search order, without known
 * non-Vendor hosts. Search errors propagate to the caller.
 */
export async function findPortalCandidates(
  name: string,
  search: WebSearch,
): Promise<PortalCandidate[]> {
  const results = await search.search(
    `${name} API reference developer documentation`,
    { count: 8 },
  );

  const seen = new Set<string>();
  const candidates: PortalCandidate[] = [];
  for (const { url, title, snippet } of results) {
    const domain = registrableDomain(url);
    if (!domain || seen.has(domain) || NON_VENDOR_DOMAINS.includes(domain))
      continue;
    seen.add(domain);
    candidates.push({ url, domain, title, snippet });
    if (candidates.length === MAX_PORTAL_CANDIDATES) break;
  }
  return candidates;
}
