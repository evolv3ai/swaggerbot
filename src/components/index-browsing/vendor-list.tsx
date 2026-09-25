import { useId } from "react";
import { vendorHref } from "~/lib/vendor-hrefs";
import type { VendorsPage } from "~/server/index-browsing";

/**
 * `/vendors`: the filter (a GET form, so it works without script), the
 * Vendors on this page with their API counts in a rule-gapped grid, and
 * the paging links.
 */
export function VendorListView({ page }: { page: VendorsPage }) {
  return (
    <div className="grid gap-8 px-4 pt-8 pb-10 sm:px-8 lg:gap-10 lg:pt-12">
      <header className="grid gap-4">
        <h1 className="font-pencil text-[clamp(3.25rem,8.5vw,6rem)] uppercase leading-[0.95]">
          Vendors
        </h1>
        <p className="max-w-[34rem] text-lg leading-relaxed text-ink-2 sm:text-xl">
          Every Vendor the Index holds an API of, by name. Each one lists its
          APIs with the Spec a Lookup would answer.
        </p>
      </header>
      <FilterForm query={page.query} />
      {page.status === 400 ? (
        <section aria-labelledby="bad-page" className="grid gap-2">
          <h2
            id="bad-page"
            className="font-caps text-2xl font-semibold uppercase tracking-wide"
          >
            No such page
          </h2>
          <p className="text-destructive">{page.error}</p>
          <p>
            <a href={page.first} className="underline">
              Go to the first page
            </a>
          </p>
        </section>
      ) : (
        <Results page={page} />
      )}
    </div>
  );
}

function FilterForm({ query }: { query: string }) {
  const id = useId();
  return (
    <search className="max-w-[40rem]">
      <form action="/vendors" method="get" className="grid gap-2">
        <label
          htmlFor={`${id}-query`}
          className="font-caps text-sm font-semibold uppercase tracking-[0.14em]"
        >
          Filter by name or domain
        </label>
        <div className="flex flex-wrap gap-3">
          <input
            id={`${id}-query`}
            name="query"
            type="search"
            defaultValue={query}
            autoComplete="off"
            spellCheck={false}
            placeholder="stripe, atlassian.com…"
            className="min-h-10 min-w-0 flex-1 basis-56 rounded-[3px] border border-ink bg-print px-3 text-print-ink placeholder:text-print-ink-2"
          />
          <button
            type="submit"
            className="min-h-10 rounded-[3px] border border-ink bg-[#0e0e0e] px-4 font-caps text-sm font-semibold uppercase tracking-[0.12em] text-lamp hover:brightness-125"
          >
            Filter
          </button>
        </div>
        {query ? (
          <p className="text-sm">
            <a href="/vendors" className="underline">
              Show every Vendor
            </a>
          </p>
        ) : null}
      </form>
    </search>
  );
}

function Results({ page }: { page: Extract<VendorsPage, { status: 200 }> }) {
  const noun = page.total === 1 ? "Vendor" : "Vendors";
  return (
    <section aria-labelledby="vendor-results" className="grid gap-4">
      <h2
        id="vendor-results"
        className="font-caps text-sm font-semibold uppercase tracking-[0.14em] text-ink-2"
      >
        {page.total === 0
          ? "No Vendors"
          : `${page.from}–${page.to} of ${page.total} ${noun}${page.query ? ` matching “${page.query}”` : ""}`}
      </h2>
      {page.total === 0 ? (
        <p className="max-w-[34rem]">
          {page.query
            ? `No Vendor in the Index has “${page.query}” in its name or domain. `
            : "The Index holds no APIs yet. "}
          A Lookup adds an API, with its Vendor, to the Index:{" "}
          <a href="/" className="underline">
            search for it by name
          </a>
          .
        </p>
      ) : (
        <ul className="grid gap-px overflow-hidden rounded-[3px] border border-rule bg-rule sm:grid-cols-2 xl:grid-cols-3">
          {page.vendors.map((vendor) => (
            <li
              key={vendor.id}
              className="flex items-end justify-between gap-4 bg-bay p-4"
            >
              <span className="grid min-w-0 gap-1">
                <a
                  href={vendorHref(vendor.id)}
                  className="underline font-caps text-lg font-semibold uppercase leading-tight tracking-wide [overflow-wrap:anywhere]"
                >
                  {vendor.name}
                </a>
                <span className="font-mono text-xs text-ink-2 [overflow-wrap:anywhere]">
                  {vendor.id}
                </span>
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5">
                <span className="font-segment text-2xl leading-none">
                  {vendor.apiCount}
                </span>
                <span className="font-caps text-xs font-semibold uppercase tracking-[0.12em]">
                  {vendor.apiCount === 1 ? "API" : "APIs"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {page.previous || page.next ? (
        <nav aria-label="Pages of Vendors">
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {page.previous ? (
              <li>
                <a href={page.previous} rel="prev" className="underline">
                  Previous page
                </a>
              </li>
            ) : null}
            {page.next ? (
              <li>
                <a href={page.next} rel="next" className="underline">
                  Next page
                </a>
              </li>
            ) : null}
          </ul>
        </nav>
      ) : null}
    </section>
  );
}
