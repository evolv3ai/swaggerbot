import type { Api, Vendor } from "~/domain/catalog";
import { vendorIdFromDomain } from "~/domain/catalog";
import type { Provenance } from "~/domain/provenance";
import type { Db } from "~/index-store/db";
import { createRepo, normalizeName, type Repo } from "~/index-store/repo";
import type { CurrentFromIndex, IndexedLookup } from "~/lookup/lookup";

/** What `GET /api/vendors/{vendor}/apis` runs on: the Index and its Current Spec rule. */
export type VendorApisApp = {
  db: Db;
  lookup: Pick<IndexedLookup, "currentFromIndex">;
};

/** One API of the Vendor, as `list_vendor_apis` lists it. */
export type VendorApi = {
  api: Api;
  /** null when the Index holds no confirmed Official, Endorsed or Mirror Spec of it. */
  currentSpec: CurrentFromIndex["currentSpec"] | null;
  alternateSpecs: CurrentFromIndex["alternateSpecs"];
  provenance: Provenance | null;
  verifiedAt: string | null;
};

const LOOKUP_HINT =
  "Only APIs already in the Index are listed. A Lookup (`POST /api/lookup` with the name of an API) finds an API and adds it, with its Vendor, to the Index.";

/**
 * `GET /api/vendors/{vendor}/apis`: the Vendor's APIs, from the Index alone,
 * ordered by name, each with its Current Spec and Alternates as a default
 * Lookup answers them (`currentFromIndex`). Runs no Lookup, no Discovery and
 * no Verification.
 *
 * `vendor` is matched, in this order, as a Vendor id (`stripe.com`); as a
 * domain or URL (`https://www.stripe.com/docs`); as a name the Index
 * remembers for an API (`Stripe API`, through `api_names`), answering that
 * API's Vendor; as the first label of Vendor ids, normalized with spaces
 * removed (`Slack` → `slack.com`); as a Vendor name, exactly but ignoring
 * case (`Stripe`). 300 with the candidates when several Vendors match by
 * label or name, 404 with a hint when none matches.
 */
export function vendorApisResponse(
  vendor: string,
  getApp: () => VendorApisApp,
): Response {
  const { db, lookup } = getApp();
  const repo = createRepo(db);
  const matched = matchVendor(repo, vendor);
  if (matched.length > 1)
    return Response.json(
      { vendors: matched.map(({ id, name }) => ({ id, name })) },
      { status: 300 },
    );
  const [found] = matched;
  if (!found)
    return Response.json(
      {
        error: `No Vendor "${vendor.trim()}" in the Index.`,
        hint: LOOKUP_HINT,
      },
      { status: 404 },
    );
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
  return Response.json({ vendor: found, apis });
}

/**
 * The Vendors `vendor` names: one by id, domain or remembered API name, else
 * all by id label, else all by name.
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
  return repo.findVendorsByName(raw);
}
