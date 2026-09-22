import { z } from "zod";
import { Provenance } from "./provenance";

/** ISO-8601 timestamp in UTC, e.g. `2026-09-22T10:00:00.000Z`. */
export const Timestamp = z.iso.datetime();

/** A lowercase slug of the Vendor's main domain, e.g. `stripe.com`. */
export const VendorId = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/);

/** `<vendorId>/<api-slug>`, e.g. `stripe.com/stripe-api`. */
export const ApiId = z
  .string()
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}\/[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Lowercase hex sha256 of the Spec's Published Form bytes. */
export const SpecId = z.string().regex(/^[0-9a-f]{64}$/);

export const Vendor = z.object({
  id: VendorId,
  name: z.string().min(1),
  domain: z.string().min(1),
});
export type Vendor = z.infer<typeof Vendor>;

export const Api = z.object({
  id: ApiId,
  vendorId: VendorId,
  name: z.string().min(1),
});
export type Api = z.infer<typeof Api>;

/** OpenAPI/Swagger version of the document: "2.0", "3.0.x" or "3.1.x". */
export const SpecVersion = z.string().regex(/^(2\.0|3\.[01]\.\d+)$/);

export const SpecFormat = z.enum(["json", "yaml"]);
export type SpecFormat = z.infer<typeof SpecFormat>;

export const Spec = z.object({
  id: SpecId,
  apiId: ApiId,
  specVersion: SpecVersion,
  apiVersion: z.string().nullable(),
  format: SpecFormat,
  byteLength: z.number().int().nonnegative(),
});
export type Spec = z.infer<typeof Spec>;

export const Source = z.object({
  id: z.number().int(),
  specId: SpecId,
  url: z.url(),
  provenance: Provenance,
  firstSeenAt: Timestamp,
  lastVerifiedAt: Timestamp,
});
export type Source = z.infer<typeof Source>;

/** A lowercase slug: runs of anything but `[a-z0-9]` become one `-`. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Vendor id from its main domain: `https://www.Stripe.com/` → `stripe.com`. */
export function vendorIdFromDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/:].*$/, "")
    .replace(/^www\./, "");
}

/** API id: `apiId("stripe.com", "Stripe API")` → `stripe.com/stripe-api`. */
export function apiId(vendorId: string, apiName: string): string {
  return `${vendorId}/${slugify(apiName)}`;
}
