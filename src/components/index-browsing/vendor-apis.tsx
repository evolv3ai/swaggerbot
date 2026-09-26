import { Badge } from "~/components/ui/badge";
import { buttonClass } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { dayOf } from "~/lib/dates";
import { vendorHref } from "~/lib/vendor-hrefs";
import { distinctDomain } from "~/lib/vendor-name";
import type { VendorPage, VendorPageApi } from "~/server/index-browsing";
import { lookupHref } from "~/server/lookup-search";
import { BackToVendors, H2, LEAD, PAGE, PageTitle } from "./page";

/**
 * `/vendors/{vendorId}`, a docs page of the Index: the Vendor and its APIs,
 * each as a card with its Current Spec's Provenance and `verifiedAt` (Stale
 * said plainly) and the ways on: the Spec viewer and a Lookup; several
 * matching Vendors as links (300); or a Vendor the Index doesn't hold (404).
 */
export function VendorApisView({ page }: { page: VendorPage }) {
  return (
    <div className={PAGE}>
      {page.status === 404 ? null : <BackToVendors />}
      {page.status === 200 ? <Vendor page={page} /> : null}
      {page.status === 300 ? <Several page={page} /> : null}
      {page.status === 404 ? <NotInIndex page={page} /> : null}
    </div>
  );
}

function Vendor({ page }: { page: Extract<VendorPage, { status: 200 }> }) {
  const { vendor, apis } = page;
  // Most Vendors are named by their domain, which is also their id: say it once.
  const domain = distinctDomain(vendor.name, vendor.domain);
  const id =
    distinctDomain(vendor.name, vendor.id) &&
    distinctDomain(vendor.domain, vendor.id)
      ? vendor.id
      : null;
  return (
    <>
      <PageTitle>{vendor.name}</PageTitle>
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        {domain ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-sb-text-muted">Domain</dt>
            <dd className="font-mono text-[13px] [overflow-wrap:anywhere]">
              {domain}
            </dd>
          </div>
        ) : null}
        {id ? (
          <div className="flex items-baseline gap-2">
            <dt className="text-sb-text-muted">Vendor id</dt>
            <dd className="font-mono text-[13px] [overflow-wrap:anywhere]">
              {id}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline gap-2">
          <dt className="text-sb-text-muted">APIs in the Index</dt>
          <dd className="font-semibold tabular-nums">{apis.length}</dd>
        </div>
      </dl>
      <section aria-labelledby="vendor-apis">
        <h2 id="vendor-apis" className={H2}>
          Its APIs
        </h2>
        {apis.length === 0 ? (
          <p className="text-sb-text-muted">
            The Index holds no APIs of this Vendor.
          </p>
        ) : (
          <ul className="grid gap-3">
            {apis.map((api) => (
              <li key={api.id}>
                <ApiCard api={api} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * An API: its name, its Current Spec's Provenance and when it was verified,
 * and the Spec viewer and Lookup links; or that it has no Current Spec.
 */
function ApiCard({ api }: { api: VendorPageApi }) {
  const spec = api.currentSpec;
  return (
    <Card className="grid gap-3 rounded-[12px] p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <h3 className="font-semibold [overflow-wrap:anywhere]">{api.name}</h3>
        {spec?.provenance ? (
          <Badge tone={spec.provenance === "Official" ? "accent" : "neutral"}>
            <span className="sr-only">Provenance: </span>
            {spec.provenance}
          </Badge>
        ) : null}
      </div>
      {spec ? (
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">
          {spec.provenance ? null : (
            <>
              <dt className="text-sb-text-muted">Provenance</dt>
              <dd>None confirmed</dd>
            </>
          )}
          <dt className="text-sb-text-muted">Verified</dt>
          <dd>
            {spec.verifiedAt ? (
              <time dateTime={spec.verifiedAt}>{dayOf(spec.verifiedAt)}</time>
            ) : (
              "Not verified"
            )}
            {spec.stale ? (
              <span className="text-sb-text-muted">
                {" "}
                · Stale: a Lookup still answers with it, and queues a new
                Verification
              </span>
            ) : null}
          </dd>
          <dt className="text-sb-text-muted">Spec</dt>
          <dd className="truncate font-mono text-[13px]">
            {spec.id.slice(0, 12)}
          </dd>
        </dl>
      ) : (
        <p className="text-sm text-sb-text-muted">
          No Current Spec: the Index holds no confirmed Official, Endorsed or
          Mirror Spec of this API.
        </p>
      )}
      <p className="flex flex-wrap gap-2.5">
        {spec ? (
          <a
            href={`/specs/${encodeURIComponent(spec.id)}`}
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            View the Spec<span className="sr-only"> of {api.name}</span>
          </a>
        ) : null}
        <a
          href={lookupHref(api.lookupName)}
          className={buttonClass({ variant: "ghost", size: "sm" })}
        >
          Look it up<span className="sr-only">: {api.name}</span>
        </a>
      </p>
    </Card>
  );
}

function Several({ page }: { page: Extract<VendorPage, { status: 300 }> }) {
  return (
    <section aria-labelledby="several">
      <PageTitle id="several">Several Vendors</PageTitle>
      <p className={LEAD}>
        “{page.asked}” matches {page.vendors.length} Vendors in the Index. Pick
        one:
      </p>
      <Card className="mt-6 overflow-hidden rounded-[12px]">
        <ul>
          {page.vendors.map((vendor, i) => {
            const domain = distinctDomain(vendor.name, vendor.id);
            return (
              <li
                key={vendor.id}
                className={
                  i > 0 ? "border-t border-sb-border px-4 py-3" : "px-4 py-3"
                }
              >
                <a
                  href={vendorHref(vendor.id)}
                  className="font-semibold text-sb-text [overflow-wrap:anywhere]"
                >
                  {vendor.name}
                </a>
                {domain ? (
                  <span className="mt-0.5 block font-mono text-xs text-sb-text-muted [overflow-wrap:anywhere]">
                    {domain}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}

function NotInIndex({ page }: { page: Extract<VendorPage, { status: 404 }> }) {
  return (
    <section aria-labelledby="not-in-index">
      <PageTitle id="not-in-index">Not in the Index</PageTitle>
      <p className={LEAD}>
        No Vendor “{page.asked}” in the Index. Only Vendors with an API already
        in the Index are listed. A Lookup finds an API and adds it, with its
        Vendor, to the Index.
      </p>
      <p className="mt-6 flex flex-wrap gap-3">
        <a href="/" className={buttonClass({ variant: "primary", size: "md" })}>
          Search for an API by name
        </a>
        <a
          href="/vendors"
          className={buttonClass({ variant: "secondary", size: "md" })}
        >
          Browse the Vendors
        </a>
      </p>
    </section>
  );
}
