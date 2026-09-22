import { registrableDomain } from "./domain";
import type { WebSearch } from "./web-search";

/**
 * Hosts that carry content about APIs but are never the Vendor: code hosts,
 * Q&A sites, API directories and package registries. Each entry matches
 * itself and every subdomain (`mercury-docs.readthedocs.io`).
 */
export const NON_VENDOR_DOMAINS: readonly string[] = [
  "github.com",
  "stackoverflow.com",
  "medium.com",
  "apis.guru",
  "rapidapi.com",
  "postman.com",
  "wikipedia.org",
  "apitracker.io",
  "openbankingtracker.com",
  "npmjs.com",
  "hexdocs.pm",
  "pkg.go.dev",
  "pypi.org",
  "readthedocs.io",
  "readthedocs.org",
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
 * five Candidates, one per registrable domain (its highest-ranked result), in
 * search order, without known non-Vendor hosts. Search errors propagate to
 * the caller.
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
    if (!domain || seen.has(domain) || isNonVendor(url)) continue;
    seen.add(domain);
    candidates.push({ url, domain, title, snippet });
    if (candidates.length === MAX_PORTAL_CANDIDATES) break;
  }
  return candidates;
}

/** Whether `url`'s host is, or is under, one of `NON_VENDOR_DOMAINS`. */
function isNonVendor(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return NON_VENDOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}
