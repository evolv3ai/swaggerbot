import { ChevronLeft, ChevronRight } from "lucide-react";
import { useId } from "react";
import { buttonClass } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input, Label } from "~/components/ui/input";
import { cn } from "~/lib/utils";
import { vendorHref } from "~/lib/vendor-hrefs";
import { distinctDomain } from "~/lib/vendor-name";
import type { VendorsPage } from "~/server/index-browsing";
import { H2, LEAD, PAGE, PageTitle } from "./page";

/**
 * `/vendors`, a docs page of the Index: the title and a lead with the live
 * count, the filter (a GET form, so it works without script), the Vendors
 * on this page as a table (name, domain where it differs, API count), and
 * the paging links. A cursor this list didn't make is "No such page" (400).
 */
export function VendorListView({ page }: { page: VendorsPage }) {
  return (
    <div className={PAGE}>
      <PageTitle>Vendors</PageTitle>
      <p className={LEAD}>
        {page.status === 200 && !page.query ? (
          <>
            <strong className="font-semibold text-sb-text">
              {`${page.total} ${page.total === 1 ? "Vendor" : "Vendors"}`}
            </strong>{" "}
            {page.total === 1 ? "has" : "have"} an API in the Index.{" "}
          </>
        ) : (
          "Every Vendor with an API in the Index, by name. "
        )}
        Each one lists its APIs with the Spec a Lookup would answer, its
        Provenance and when it was verified.
      </p>
      <FilterForm query={page.query} />
      {page.status === 400 ? (
        <section aria-labelledby="bad-page">
          <Card className="mt-8 grid gap-2 rounded-[12px] p-5">
            <h2
              id="bad-page"
              className="font-display text-xl font-bold text-sb-text"
            >
              No such page
            </h2>
            <p className="text-sb-text-muted">{page.error}</p>
            <p className="mt-2">
              <a
                href={page.first}
                className={buttonClass({ variant: "secondary", size: "md" })}
              >
                Go to the first page
              </a>
            </p>
          </Card>
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
    <search className="mt-6 block max-w-[34rem]">
      <form action="/vendors" method="get" className="grid gap-2">
        <Label htmlFor={`${id}-query`}>Filter by name or domain</Label>
        <div className="flex gap-2.5">
          <Input
            id={`${id}-query`}
            name="query"
            type="search"
            defaultValue={query}
            autoComplete="off"
            spellCheck={false}
            placeholder="stripe, atlassian.com…"
            className="flex-1"
          />
          <button
            type="submit"
            className={buttonClass({ variant: "secondary", size: "md" })}
          >
            Filter
          </button>
        </div>
        {query ? (
          <p className="text-sm">
            <a href="/vendors" className="text-sb-text">
              Show every Vendor
            </a>
          </p>
        ) : null}
      </form>
    </search>
  );
}

const TH =
  "px-4 py-3 text-left font-display text-[11px] font-bold uppercase tracking-[0.12em] text-sb-text-muted";

function Results({ page }: { page: Extract<VendorsPage, { status: 200 }> }) {
  const noun = page.total === 1 ? "Vendor" : "Vendors";
  const range =
    page.total === 0
      ? "No Vendors"
      : `${page.from}–${page.to} of ${page.total} ${noun}${page.query ? ` matching “${page.query}”` : ""}`;
  return (
    <section aria-labelledby="vendor-results">
      <h2 id="vendor-results" className={H2}>
        {range}
      </h2>
      {page.total === 0 ? (
        <p className="max-w-[40em] text-sb-text-muted">
          {page.query
            ? `No Vendor in the Index has “${page.query}” in its name or domain. `
            : "The Index holds no APIs yet. "}
          A Lookup adds an API, with its Vendor, to the Index:{" "}
          <a href="/" className="text-sb-text">
            search for it by name
          </a>
          .
        </p>
      ) : (
        <Card className="overflow-hidden rounded-[12px]">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">
              Vendors in the Index, {range}, with the number of APIs of each
            </caption>
            <thead className="bg-sb-bg-subtle">
              <tr>
                <th scope="col" className={TH}>
                  Vendor
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  APIs
                </th>
              </tr>
            </thead>
            <tbody>
              {page.vendors.map((vendor) => {
                const domain = distinctDomain(vendor.name, vendor.id);
                return (
                  <tr
                    key={vendor.id}
                    className="relative border-t border-sb-border transition-colors hover:bg-sb-accent-soft"
                  >
                    <th scope="row" className="px-4 py-3 text-left font-normal">
                      {/*
                       * In the table the Vendor's name is plainly the row's
                       * link (bold, the row highlights, the pointer); an
                       * underline on every row reads as noise. It opts out
                       * of uicheck's underlined-link rule with the documented
                       * class (`LINK_OPT_OUT`, `no-underline`), and underlines
                       * on hover and focus. The link covers the whole row
                       * (`after:absolute`), so the row is the target.
                       */}
                      <a
                        href={vendorHref(vendor.id)}
                        className="font-semibold text-sb-text no-underline after:absolute after:inset-0 hover:underline focus-visible:underline [overflow-wrap:anywhere]"
                      >
                        {vendor.name}
                      </a>
                      {domain ? (
                        <span className="mt-0.5 block font-mono text-xs text-sb-text-muted [overflow-wrap:anywhere]">
                          {domain}
                        </span>
                      ) : null}
                    </th>
                    <td className="px-4 py-3 text-right tabular-nums text-sb-text-muted">
                      <span className="font-semibold text-sb-text">
                        {vendor.apiCount}
                      </span>{" "}
                      {vendor.apiCount === 1 ? "API" : "APIs"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
      {page.previous || page.next ? (
        <nav
          aria-label="Pages of Vendors"
          className="mt-4 flex flex-wrap items-center gap-3"
        >
          {page.previous ? (
            <a
              href={page.previous}
              rel="prev"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              <ChevronLeft aria-hidden="true" />
              Previous page
            </a>
          ) : null}
          {page.next ? (
            <a
              href={page.next}
              rel="next"
              className={buttonClass({ variant: "secondary", size: "sm" })}
            >
              Next page
              <ChevronRight aria-hidden="true" />
            </a>
          ) : null}
          <span className="text-[13px] text-sb-text-muted sm:ml-auto">
            {page.from}–{page.to} of {page.total}
          </span>
        </nav>
      ) : null}
    </section>
  );
}
