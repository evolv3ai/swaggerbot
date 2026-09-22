import { getDomain } from "tldts";

/**
 * The registrable domain of `url` (a URL or bare hostname), e.g.
 * `https://www.twilio.com/docs` → `twilio.com`. Private suffixes count, so
 * `acme.github.io` stays `acme.github.io` rather than collapsing into
 * `github.io` with every other tenant. `null` for IPs and unparseable input.
 */
export function registrableDomain(url: string): string | null {
  return getDomain(url, { allowPrivateDomains: true });
}
