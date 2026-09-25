import { ProvenanceMark } from "~/components/darkroom/provenance-mark";
import { VerifiedStamp } from "~/components/darkroom/stamp";
import { vendorHref } from "~/lib/vendor-hrefs";
import type { VendorPage, VendorPageApi } from "~/server/index-browsing";

/**
 * `/vendors/{vendorId}`: the Vendor and its APIs, each with its Current
 * Spec on a print (Provenance, `verifiedAt`, the Spec id and a link to the
 * Spec viewer); several matching Vendors as links; or a Vendor the Index
 * doesn't hold.
 */
export function VendorApisView({ page }: { page: VendorPage }) {
  return (
    <div className="grid gap-8 px-4 pt-8 pb-10 sm:px-8 lg:gap-10 lg:pt-12">
      <p className="text-sm">
        <a href="/vendors" className="underline">
          All Vendors
        </a>
      </p>
      {page.status === 200 ? <Vendor page={page} /> : null}
      {page.status === 300 ? <Several page={page} /> : null}
      {page.status === 404 ? <NotInIndex page={page} /> : null}
    </div>
  );
}

function Vendor({ page }: { page: Extract<VendorPage, { status: 200 }> }) {
  const { vendor, apis } = page;
  return (
    <>
      <header className="grid gap-2">
        <h1 className="font-caps text-4xl font-bold uppercase leading-tight tracking-wide [overflow-wrap:anywhere] sm:text-5xl">
          {vendor.name}
        </h1>
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div className="flex items-baseline gap-2">
            <dt className="font-caps font-semibold uppercase tracking-[0.12em] text-ink-2">
              Vendor id
            </dt>
            <dd className="font-mono [overflow-wrap:anywhere]">{vendor.id}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="font-caps font-semibold uppercase tracking-[0.12em] text-ink-2">
              Domain
            </dt>
            <dd className="font-mono [overflow-wrap:anywhere]">
              {vendor.domain}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="font-caps font-semibold uppercase tracking-[0.12em] text-ink-2">
              APIs
            </dt>
            <dd className="font-segment text-xl leading-none">{apis.length}</dd>
          </div>
        </dl>
      </header>
      <section aria-labelledby="vendor-apis" className="grid gap-4">
        <h2
          id="vendor-apis"
          className="font-caps text-2xl font-semibold uppercase tracking-wide"
        >
          Its APIs in the Index
        </h2>
        <ul className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {apis.map((api) => (
            <li key={api.id} className="grid">
              {api.currentSpec ? (
                <ApiPrint api={api} spec={api.currentSpec} />
              ) : (
                <NoCurrentSpec api={api} />
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

/** An API with its Current Spec, as a print: the facts on the label. */
function ApiPrint({
  api,
  spec,
}: {
  api: VendorPageApi;
  spec: NonNullable<VendorPageApi["currentSpec"]>;
}) {
  return (
    <article className="grid content-start gap-3 rounded-[3px] bg-print p-4 text-print-ink shadow-[0_6px_18px_-6px_rgb(0_0_0/0.45)]">
      <h3 className="font-caps text-xl font-semibold uppercase leading-tight tracking-wide [overflow-wrap:anywhere]">
        {api.name}
      </h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="font-caps uppercase tracking-wider text-print-ink-2">
          Provenance
        </dt>
        <dd className="text-right">
          {spec.provenance ? (
            <ProvenanceMark provenance={spec.provenance} />
          ) : (
            "None confirmed"
          )}
        </dd>
        <dt className="font-caps uppercase tracking-wider text-print-ink-2">
          Verified
        </dt>
        <dd className="text-right">
          <VerifiedStamp verifiedAt={spec.verifiedAt} stale={spec.stale} />
        </dd>
        <dt className="font-caps uppercase tracking-wider text-print-ink-2">
          Spec
        </dt>
        <dd className="truncate text-right font-mono text-xs leading-5">
          {spec.id.slice(0, 12)}
        </dd>
      </dl>
      <p className="text-sm">
        <a href={`/specs/${encodeURIComponent(spec.id)}`} className="underline">
          View the Spec<span className="sr-only"> of {api.name}</span>
        </a>
      </p>
    </article>
  );
}

/** An API the Index holds no Current Spec of: on the bay, not a print. */
function NoCurrentSpec({ api }: { api: VendorPageApi }) {
  return (
    <article className="grid content-start gap-2 rounded-[3px] border border-dashed border-ink p-4">
      <h3 className="font-caps text-xl font-semibold uppercase leading-tight tracking-wide [overflow-wrap:anywhere]">
        {api.name}
      </h3>
      <p className="text-sm text-ink-2">
        No Current Spec: the Index holds no confirmed Official, Endorsed or
        Mirror Spec of this API.
      </p>
    </article>
  );
}

function Several({ page }: { page: Extract<VendorPage, { status: 300 }> }) {
  return (
    <section aria-labelledby="several" className="grid gap-4">
      <h1
        id="several"
        className="font-caps text-4xl font-bold uppercase leading-tight tracking-wide sm:text-5xl"
      >
        Several Vendors
      </h1>
      <p className="max-w-[34rem]">
        “{page.asked}” matches {page.vendors.length} Vendors in the Index. Pick
        one:
      </p>
      <ul className="grid gap-px overflow-hidden rounded-[3px] border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-3">
        {page.vendors.map((vendor) => (
          <li key={vendor.id} className="grid gap-1 bg-bay p-4">
            <a
              href={vendorHref(vendor.id)}
              className="underline font-caps text-lg font-semibold uppercase leading-tight tracking-wide [overflow-wrap:anywhere]"
            >
              {vendor.name}
            </a>
            <span className="font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">
              {vendor.id}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotInIndex({ page }: { page: Extract<VendorPage, { status: 404 }> }) {
  return (
    <section aria-labelledby="not-in-index" className="grid gap-4">
      <h1
        id="not-in-index"
        className="font-caps text-4xl font-bold uppercase leading-tight tracking-wide sm:text-5xl"
      >
        Not in the Index
      </h1>
      <p className="max-w-[34rem]">
        No Vendor “{page.asked}” in the Index. Only Vendors with an API already
        in the Index are listed. A Lookup finds an API and adds it, with its
        Vendor, to the Index.
      </p>
      <p>
        <a href="/" className="underline">
          Search for an API by name
        </a>
      </p>
    </section>
  );
}
