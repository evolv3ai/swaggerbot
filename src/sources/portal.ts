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
  "apis.io",
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

/**
 * Shared hosting: every subdomain is a separate tenant, and a tenant is
 * anyone's site, not the Vendor's own domain (`steamwebapi.azurewebsites.net`
 * is a third-party app, not Valve). A result on a tenant is not a portal
 * Candidate; the suffix itself is not matched. Only web-search portal
 * Candidates are affected: a Spec at `<org>.github.io` can still be Official.
 */
export const SHARED_HOSTING_SUFFIXES: readonly string[] = [
  "azurewebsites.net",
  "herokuapp.com",
  "github.io",
  "gitlab.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "onrender.com",
  "fly.dev",
  "web.app",
  "firebaseapp.com",
  "appspot.com",
  "glitch.me",
  "replit.app",
  "repl.co",
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
 * search order, without known non-Vendor hosts or shared-hosting tenants.
 * Search errors propagate to the caller.
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
    if (
      !domain ||
      seen.has(domain) ||
      isNonVendor(url) ||
      isSharedHostingTenant(url)
    )
      continue;
    seen.add(domain);
    candidates.push({ url, domain, title, snippet });
    if (candidates.length === MAX_PORTAL_CANDIDATES) break;
  }
  return candidates;
}

/** Whether `url`'s host is, or is under, one of `NON_VENDOR_DOMAINS`. */
function isNonVendor(url: string): boolean {
  const host = hostOf(url);
  return (
    host !== null &&
    NON_VENDOR_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))
  );
}

/** Whether `url`'s host is under (not equal to) one of `SHARED_HOSTING_SUFFIXES`. */
export function isSharedHostingTenant(url: string): boolean {
  const host = hostOf(url);
  return (
    host !== null && SHARED_HOSTING_SUFFIXES.some((s) => host.endsWith(`.${s}`))
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}
