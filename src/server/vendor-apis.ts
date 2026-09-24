import { z } from "zod";
import { Api, Timestamp, Vendor, vendorIdFromDomain } from "~/domain/catalog";
import { SpecAnswer } from "~/domain/outcome";
import { Provenance } from "~/domain/provenance";
import type { Db } from "~/index-store/db";
import { createRepo, normalizeName, type Repo } from "~/index-store/repo";
import type { IndexedLookup } from "~/lookup/lookup";

/** What `GET /api/vendors/{vendor}/apis` runs on: the Index and its Current Spec rule. */
export type VendorApisApp = {
  db: Db;
  lookup: Pick<IndexedLookup, "currentFromIndex">;
};

/** One API of the Vendor, as `list_vendor_apis` lists it. */
export const VendorApi = z.object({
  api: Api,
  /** null when the Index holds no confirmed Official, Endorsed or Mirror Spec of it. */
  currentSpec: SpecAnswer.nullable(),
  alternateSpecs: z.array(SpecAnswer),
  provenance: Provenance.nullable(),
  verifiedAt: Timestamp.nullable(),
});
export type VendorApi = z.infer<typeof VendorApi>;

/** A Vendor and its APIs in the Index: the 200 answer. */
export const VendorApis = z.object({
  vendor: Vendor,
  apis: z.array(VendorApi),
});
export type VendorApis = z.infer<typeof VendorApis>;

/** The listing's answer, for any surface to send (ADR 0005). */
export type VendorApisAnswer =
  | { status: 200; body: VendorApis }
  | { status: 300; body: { vendors: Pick<Vendor, "id" | "name">[] } }
  | { status: 404; body: { error: string; hint: string } };

const LOOKUP_HINT =
  "Only APIs already in the Index are listed. A Lookup (`POST /api/lookup` with the name of an API) finds an API and adds it, with its Vendor, to the Index.";

/** `GET /api/vendors/{vendor}/apis`: `answerVendorApis` as a JSON response. */
export function vendorApisResponse(
  vendor: string,
  getApp: () => VendorApisApp,
): Response {
  const { status, body } = answerVendorApis(vendor, getApp());
  return Response.json(body, { status });
}

/**
 * The listing's rules, shared by `GET /api/vendors/{vendor}/apis` and
 * `list_vendor_apis`: the Vendor's APIs, from the Index alone,
 * ordered by name, each with its Current Spec and Alternates as a default
 * Lookup answers them (`currentFromIndex`). Runs no Lookup, no Discovery and
 * no Verification.
 *
 * `vendor` is matched, in this order, as a Vendor id (`stripe.com`); as a
 * domain or URL (`https://www.stripe.com/docs`); as a name the Index
 * remembers for an API (`Stripe API`, through `api_names`), answering that
 * API's Vendor; as the first label of Vendor ids, normalized with spaces
 * removed (`Slack` → `slack.com`); as a Vendor name, exactly but ignoring
 * case (`Stripe`); as the first word or words of a name the Index remembers
 * for an API (`Jira` → `jira cloud platform rest`), answering those APIs'
 * Vendors. 300 with the candidates when several Vendors match by label, name
 * or name prefix, 404 with a hint when none matches.
 */
export function answerVendorApis(
  vendor: string,
  { db, lookup }: VendorApisApp,
): VendorApisAnswer {
  const repo = createRepo(db);
  const matched = matchVendor(repo, vendor);
  if (matched.length > 1)
    return {
      status: 300,
      body: { vendors: matched.map(({ id, name }) => ({ id, name })) },
    };
  const [found] = matched;
  if (!found)
    return {
      status: 404,
      body: {
        error: `No Vendor "${vendor.trim()}" in the Index.`,
        hint: LOOKUP_HINT,
      },
    };
  const apis = repo.listApisOfVendor(found.id).map((api): VendorApi => {
    const current = lookup.currentFromIndex(api.id);
    if (!current)
      return {
        api,
        currentSpec: null,
        alternateSpecs: [],
        provenance: null,
        verifiedAt: null,
      };
    const { currentSpec, alternateSpecs, provenance, verifiedAt } = current;
    return { api, currentSpec, alternateSpecs, provenance, verifiedAt };
  });
  return { status: 200, body: { vendor: found, apis } };
}

/**
 * The Vendors `vendor` names: one by id, domain or remembered API name, else
 * all by id label, else all by name, else all of the APIs whose remembered
 * name starts with it as whole words.
 */
function matchVendor(repo: Repo, vendor: string): Vendor[] {
  const raw = vendor.trim();
  if (!raw) return [];
  const byId = repo.getVendor(raw) ?? repo.getVendor(vendorIdFromDomain(raw));
  if (byId) return [byId];
  const api = repo.findApiByName(raw);
  const byApiName = api && repo.getVendor(api.vendorId);
  if (byApiName) return [byApiName];
  const label = normalizeName(raw).replace(/ /g, "");
  const byLabel = label ? repo.findVendorsByLabel(label) : [];
  if (byLabel.length > 0) return byLabel;
  const byName = repo.findVendorsByName(raw);
  if (byName.length > 0) return byName;
  return repo.findVendorsByApiNamePrefix(raw);
}
