/**
 * A Vendor's domain (or Vendor id) to show beside its name, or null when it
 * would only repeat the name: most Vendors are named by their domain, so
 * "stripe.com (stripe.com)" says nothing twice.
 */
export function distinctDomain(name: string, domain: string): string | null {
  return name.trim().toLowerCase() === domain.trim().toLowerCase()
    ? null
    : domain;
}
